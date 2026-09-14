import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { executeSemanticQuery, type SemanticQueryOutcome } from './semantic-query-service';
import { METRIC_READ_PERMISSION } from '../metrics/registry';
import { IntelligenceRepository } from '../repository/intelligence-repository';
import { runRules, RULE_METRICS, INSIGHT_RULE_SET_VERSION, type MetricSnapshot } from '../domain/insight-rules';

// Phase P4 — Module 8-C3 · DETERMINISTIC insight engine (§10.12). Reads the org's aggregate metrics via
// the semantic metric SSOT (executeSemanticQuery — NO raw SQL/§26), runs the versioned deterministic rule
// catalog, and emits each fired insight into the shared store IDEMPOTENTLY (recordRecurring → re-run
// touches, never duplicates). SERVER-ONLY: the injected service_role client bypasses per-user RLS for
// ORG-WIDE detection (executors still scope every read to organizationId → tenant-safe); emitted insights
// are RLS-gated on READ. NO statistical anomaly/forecast (P8); NO LLM (§26); model_payload stays null.

/** Build the pure metric snapshot (value + previous-period delta) from a semantic-query outcome. */
export function snapshotFrom(outcome: SemanticQueryOutcome): MetricSnapshot {
  const snap: MetricSnapshot = {};
  if (!outcome.ok) return snap;
  for (const m of outcome.metrics) {
    const orgResult = m.results.find((r) => Object.keys(r.dimensions).length === 0);
    if (!orgResult || typeof orgResult.value !== 'number' || !Number.isFinite(orgResult.value)) continue;
    const delta = m.comparison?.deltas.find((d) => Object.keys(d.dimensions).length === 0)?.delta ?? null;
    const value = orgResult.value;
    snap[m.metricId] = { value, delta, previous: delta === null ? null : value - delta };
  }
  return snap;
}

async function resolveCurrentPeriod(admin: SupabaseClient<Database>, organizationId: string): Promise<string | null> {
  const { data } = await admin
    .from('bonus_periods')
    .select('id')
    .eq('organization_id', organizationId)
    .order('starts_on', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export interface InsightEngineResult {
  ruleSetVersion: string;
  bonusPeriodId: string | null;
  detected: number; // fired candidate insights
  inserted: number; // newly created rows
  recurred: number; // existing non-terminal rows touched (no duplicate)
  status: 'ok' | 'no_period' | 'metrics_unavailable';
}

/**
 * Run the deterministic insight engine for an org [+ period]. Reads the rule metrics anchored to the
 * current bonus_period (with previous-period comparison, so delta rules are executable), runs the pure
 * rule catalog, and emits each fired insight idempotently. Returns per-run counts. Emits nothing when
 * there is no period yet, or when the metric read is unavailable (e.g. the 'intelligence' flag is off).
 */
export async function runInsightEngine(
  params: { organizationId: string; bonusPeriodId?: string | null },
  admin: SupabaseClient<Database>,
  // The metric read is injectable for tests (defaults to the real semantic-query service) so the engine's
  // orchestration + idempotency can be exercised without a live DB — the boundary stays executeSemanticQuery.
  deps: { readMetrics?: typeof executeSemanticQuery } = {},
): Promise<InsightEngineResult> {
  const readMetrics = deps.readMetrics ?? executeSemanticQuery;
  const bonusPeriodId = params.bonusPeriodId ?? (await resolveCurrentPeriod(admin, params.organizationId));
  const base = { ruleSetVersion: INSIGHT_RULE_SET_VERSION, bonusPeriodId };
  if (!bonusPeriodId) return { ...base, detected: 0, inserted: 0, recurred: 0, status: 'no_period' };

  const outcome = await readMetrics(
    admin,
    { organizationId: params.organizationId, permissions: [METRIC_READ_PERMISSION] },
    {
      metrics: [...RULE_METRICS],
      dimensions: [],
      filters: [],
      period: { kind: 'bonus_period', bonusPeriodId },
      comparison: { basis: 'previous_period' },
    },
  );
  if (!outcome.ok) return { ...base, detected: 0, inserted: 0, recurred: 0, status: 'metrics_unavailable' };

  const candidates = runRules(snapshotFrom(outcome));
  const repo = new IntelligenceRepository(admin);
  let inserted = 0;
  let recurred = 0;
  for (const c of candidates) {
    const result = await repo.recordRecurring({
      organizationId: params.organizationId,
      insightType: c.insightType,
      subjectType: c.subjectType,
      subjectId: c.subjectId,
      bonusPeriodId,
      severity: c.severity,
      headline: c.headline,
      deterministicFacts: c.deterministicFacts,
      evidence: c.evidence,
      suggestedActions: c.suggestedActions,
    });
    if (result.recurred) recurred += 1;
    else inserted += 1;
  }
  return { ...base, detected: candidates.length, inserted, recurred, status: 'ok' };
}
