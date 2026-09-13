// Phase P4 — Module 8-A1 · deterministic metric-executor layer (plan §10.11/§10.20/§26).
// An executor turns a VALIDATED, RESOLVED plan (metric + bounded period + servable group-by/filters)
// into one or more MetricResult rows via the RLS user client. It runs ONLY parameterized deterministic
// queries — never raw SQL, never NL, never an LLM (§26). The P0 validator (validateSemanticQuery) has
// already checked permission + catalog; the executor layer additionally checks EXECUTABILITY (does an
// 8-A1 executor exist for this metric, and can it serve the requested dimensions) and rejects the rest
// with a typed error (no silent subset, no misleading 0 — coordinator decision 2).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import type { MetricId, MetricUnit } from '../metric-id';
import type { DimensionId } from '../../dimensions/dimension-catalog';
import type { MetricResult } from '../metric-result';

/**
 * Version of the deterministic metric-execution ruleset (reproducibility, §1 pt.9). Every MetricResult
 * this layer produces is stamped with it. Bumping it is a deliberate, reviewed formula change.
 */
export const METRICS_RULESET_VERSION = 'metrics-v1' as const;

/** A period selection resolved to concrete bonus_period ids + a bounded [start, end] date window. */
export interface ResolvedPeriod {
  /** The bonus_period ids in scope (period-keyed metrics filter by these). */
  bonusPeriodIds: string[];
  /** Inclusive start date (ISO date, 'YYYY-MM-DD') for date-windowed metrics. */
  start: string;
  /** Inclusive end date (ISO date). Date-windowed queries use a half-open [start, end+1day). */
  end: string;
}

/** A filter resolved to a servable, categorical predicate (only eq/in in 8-A1). */
export interface ResolvedFilter {
  dimension: DimensionId;
  operator: 'eq' | 'in';
  values: string[];
}

/** The fully-resolved, executable plan handed to a single-metric executor. */
export interface ResolvedPlan {
  metricId: MetricId;
  organizationId: string;
  period: ResolvedPeriod;
  /** Servable group-by dimensions (never includes 'organization'; empty = org-level). */
  groupBy: DimensionId[];
  filters: ResolvedFilter[];
  /** Injected once by the service so every result of one query shares an identical, testable stamp. */
  computedAt: string;
}

export type SupabaseUserClient = SupabaseClient<Database>;

/** A deterministic executor: validated+resolved plan → zero or more MetricResults (one per slice). */
export type MetricExecutor = (client: SupabaseUserClient, plan: ResolvedPlan) => Promise<MetricResult[]>;

/** Registry entry: the executor, the unit it emits, and the CLOSED set of dimensions it can serve. */
export interface ExecutorEntry {
  unit: MetricUnit;
  /** Group-by / filter dimensions this executor can actually serve (⊆ registry allowedDimensions). */
  servableDimensions: ReadonlySet<DimensionId>;
  /**
   * OPTIONAL role gate (SI-12): the primary_role set that can read this metric's source at all. When
   * set, a caller whose role is not in it is rejected with `metric_not_available_for_role` — so a
   * source-excluded role (e.g. Finance on bonus_allocations) gets an explicit denial, never a silent
   * empty/0%. Absent = available to any intelligence.read holder (RLS scopes the visible rows).
   */
  availableRoles?: ReadonlySet<string>;
  execute: MetricExecutor;
}

/** Round to a fixed number of decimals (stable golden values; avoids float noise). */
export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Coerce a possibly-string numeric (Postgres bigint/numeric arrive as string) to a finite number. */
export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Build a MetricResult with the layer's stamp; `dimensions` is the realized slice for this row. */
export function makeResult(
  plan: ResolvedPlan,
  unit: MetricUnit,
  value: number | string,
  dimensions: Record<string, string>,
): MetricResult {
  return {
    metricId: plan.metricId,
    value,
    unit,
    period: { start: plan.period.start, end: plan.period.end },
    organizationId: plan.organizationId,
    dimensions,
    computedAt: plan.computedAt,
    sourceVersion: METRICS_RULESET_VERSION,
  };
}

/** End of a half-open date window: the day AFTER the inclusive end date, as an ISO datetime. */
export function endExclusiveIso(endDate: string): string {
  const DAY_MS = 86_400_000;
  return new Date(Date.parse(endDate) + DAY_MS).toISOString();
}

/** The values of an eq/in filter on `dimension`, or null when no such filter is present. */
export function filterValuesFor(plan: ResolvedPlan, dimension: DimensionId): string[] | null {
  const f = plan.filters.find((x) => x.dimension === dimension);
  return f ? f.values : null;
}

/**
 * The in-scope bonus_period ids after applying any `bonus_period` filter — the intersection of the
 * period-resolved set with the filter's values. Empty result means the filter excluded everything.
 */
export function narrowedPeriodIds(plan: ResolvedPlan): string[] {
  const filterValues = filterValuesFor(plan, 'bonus_period');
  if (!filterValues) return plan.period.bonusPeriodIds;
  const allow = new Set(filterValues);
  return plan.period.bonusPeriodIds.filter((id) => allow.has(id));
}
