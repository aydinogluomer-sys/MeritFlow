// Phase P4 — Module 8-A1 · semantic query SERVICE (plan §10.11; hard gate §26). The single entry point
// that turns a proposed SemanticQuery into deterministic MetricResults. It NEVER runs raw SQL and NEVER
// touches an LLM: it (1) VALIDATES the query against the P0 permission + dimension catalog, (2) checks
// EXECUTABILITY (an 8-A1 executor exists + can serve the requested dimensions; unsupported → typed
// reject, no silent subset), (3) resolves the bounded period, then (4) runs whitelisted, parameterized
// executors under the RLS user client. Behind the 'intelligence' feature flag (fail-closed).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { validateSemanticQuery, type ValidationError } from '../metrics/validator';
import type { MetricResult } from '../metrics/metric-result';
import type { MetricId } from '../metrics/metric-id';
import type { SemanticQuery, Comparison } from '../metrics/semantic-query';
import type { DimensionId } from '../dimensions/dimension-catalog';
import { FeatureFlagResolver } from '../feature-flags/resolver';
import { executorRegistry, isMetricExecutable, servableDimensions } from '../metrics/executors/registry';
import { resolvePeriod, resolveComparisonPeriod } from '../metrics/executors/period-resolver';
import { executionError, type ExecutionError } from '../metrics/executors/errors';
import { round, type ResolvedFilter, type ResolvedPeriod, type ResolvedPlan } from '../metrics/executors/types';

export interface SemanticQueryContext {
  organizationId: string;
  /** The caller's DB-sourced permissions (AD1 — resolved via getPermissions(), never a JWT claim). */
  permissions: Iterable<string>;
  /**
   * The caller's active-org primary_role (from getActiveOrg()). Used only for the source-readability
   * gate on role-restricted metrics (cap_hit_rate → hr/auditor, SI-12). Absent ⇒ such a metric is
   * rejected (fail-closed) with metric_not_available_for_role; role-unrestricted metrics ignore it.
   */
  role?: string;
}

export interface MetricComparison {
  basis: Comparison['basis'];
  /** The comparison-period results (same slices as `results`). */
  results: MetricResult[];
  /** current − comparison per matching dimension slice (numeric values only). */
  deltas: Array<{ dimensions: Record<string, string>; delta: number }>;
}

export interface MetricQueryResult {
  metricId: MetricId;
  results: MetricResult[];
  comparison?: MetricComparison;
}

export type SemanticQueryOutcome =
  | { ok: true; metrics: MetricQueryResult[] }
  | { ok: false; validationErrors?: ValidationError[]; executionErrors?: ExecutionError[] };

export interface ExecuteOptions {
  /** Fixed timestamp for reproducible results (tests); defaults to now(). */
  computedAt?: string;
}

const SUPPORTED_OPERATORS = new Set(['eq', 'in']);

/** Dimensions that actually GROUP the result — 'organization' is implicit scope, not a grouping. */
function effectiveGroupBy(dimensions: DimensionId[]): DimensionId[] {
  return dimensions.filter((d) => d !== 'organization');
}

/** Stable key for matching a current result to its comparison result by realized dimension slice. */
function dimKey(dimensions: Record<string, string>): string {
  return JSON.stringify(Object.entries(dimensions).sort());
}

/** Execution-feasibility checks beyond the P0 validator (returns [] when the query is executable). */
function checkExecutable(query: SemanticQuery, role: string | undefined): ExecutionError[] {
  const errors: ExecutionError[] = [];
  const grouping = effectiveGroupBy(query.dimensions);
  if (grouping.length > 1) {
    errors.push(
      executionError(
        'dimension_not_executable',
        `serves at most one group-by dimension per query (got ${grouping.join(', ')})`,
      ),
    );
  }
  for (const f of query.filters) {
    if (!SUPPORTED_OPERATORS.has(f.operator)) {
      errors.push(
        executionError('filter_not_executable', `filter operator ${f.operator} is not executable (use eq/in)`),
      );
    }
  }
  const usedDimensions = [...query.dimensions, ...query.filters.map((f) => f.dimension)];
  for (const id of query.metrics) {
    if (!isMetricExecutable(id)) {
      errors.push(executionError('metric_not_executable', `metric ${id} has no executor`));
      continue;
    }
    // SI-12 source-readability gate: a role-restricted metric (e.g. cap_hit_rate → hr/auditor) is
    // rejected for a source-excluded role BEFORE any query — an explicit denial, never a silent 0%.
    const roles = executorRegistry.get(id)?.availableRoles;
    if (roles && (role === undefined || !roles.has(role))) {
      errors.push(
        executionError(
          'metric_not_available_for_role',
          `metric ${id} is not readable by role ${role ?? '(none)'} — its source is role-restricted (SI-12)`,
        ),
      );
    }
    const servable = servableDimensions(id);
    for (const dim of usedDimensions) {
      if (!servable.has(dim)) {
        errors.push(executionError('dimension_not_executable', `metric ${id} cannot serve dimension ${dim}`));
      }
    }
  }
  return errors;
}

/** Map the validated (eq/in) filters to resolved string-value predicates. */
function resolveFilters(query: SemanticQuery): ResolvedFilter[] {
  return query.filters
    .filter((f) => f.operator === 'eq' || f.operator === 'in')
    .map((f) => ({
      dimension: f.dimension,
      operator: f.operator as 'eq' | 'in',
      values: Array.isArray(f.value) ? f.value.map((v) => String(v)) : [String(f.value)],
    }));
}

function buildPlan(
  metricId: MetricId,
  organizationId: string,
  period: ResolvedPeriod,
  query: SemanticQuery,
  filters: ResolvedFilter[],
  computedAt: string,
): ResolvedPlan {
  return { metricId, organizationId, period, groupBy: effectiveGroupBy(query.dimensions), filters, computedAt };
}

function computeDeltas(current: MetricResult[], previous: MetricResult[]): MetricComparison['deltas'] {
  const prevByKey = new Map(previous.map((r) => [dimKey(r.dimensions), r] as const));
  const deltas: MetricComparison['deltas'] = [];
  for (const cur of current) {
    if (typeof cur.value !== 'number') continue;
    const prev = prevByKey.get(dimKey(cur.dimensions));
    if (!prev || typeof prev.value !== 'number') continue;
    deltas.push({ dimensions: cur.dimensions, delta: round(cur.value - prev.value, 4) });
  }
  return deltas;
}

/**
 * Execute a semantic query. Returns validated deterministic MetricResults (+ optional comparison), or a
 * typed failure (validation and/or execution errors). Reads run under the passed RLS user client, so
 * Finance/employee visibility is enforced by RLS + the finance views (SI-12) — the service adds no
 * privileged read path.
 */
export async function executeSemanticQuery(
  client: SupabaseClient<Database>,
  ctx: SemanticQueryContext,
  input: unknown,
  opts: ExecuteOptions = {},
): Promise<SemanticQueryOutcome> {
  // 0) Feature gate (fail-closed).
  const flags = new FeatureFlagResolver(client, ctx.organizationId);
  if (!(await flags.isEnabled('intelligence'))) {
    return { ok: false, executionErrors: [executionError('feature_disabled', "the 'intelligence' feature flag is off")] };
  }

  // 1) Validate against permission + dimension catalog (P0).
  const validation = validateSemanticQuery(input, { permissions: ctx.permissions });
  if (!validation.valid) return { ok: false, validationErrors: validation.errors };
  const query = validation.query;

  // 2) Executability (metric has an executor; role can read its source; dimensions servable; operators).
  const execErrors = checkExecutable(query, ctx.role);
  if (execErrors.length > 0) return { ok: false, executionErrors: execErrors };

  // 3) Resolve the bounded period (+ optional comparison window).
  const period = await resolvePeriod(client, ctx.organizationId, query.period);
  if ('code' in period) return { ok: false, executionErrors: [period] };

  let comparisonPeriod: ResolvedPeriod | null = null;
  if (query.comparison) {
    const cmp = await resolveComparisonPeriod(client, ctx.organizationId, query.period, query.comparison);
    if (cmp && 'code' in cmp) return { ok: false, executionErrors: [cmp] };
    comparisonPeriod = cmp;
  }

  // 4) Execute each metric (and its comparison) under the RLS user client.
  const computedAt = opts.computedAt ?? new Date().toISOString();
  const filters = resolveFilters(query);
  const metrics: MetricQueryResult[] = [];
  for (const metricId of query.metrics) {
    const entry = executorRegistry.get(metricId)!; // guaranteed by checkExecutable
    const results = await entry.execute(client, buildPlan(metricId, ctx.organizationId, period, query, filters, computedAt));

    let comparison: MetricComparison | undefined;
    if (query.comparison && comparisonPeriod) {
      const prev = await entry.execute(
        client,
        buildPlan(metricId, ctx.organizationId, comparisonPeriod, query, filters, computedAt),
      );
      comparison = { basis: query.comparison.basis, results: prev, deltas: computeDeltas(results, prev) };
    }
    metrics.push({ metricId, results, comparison });
  }
  return { ok: true, metrics };
}
