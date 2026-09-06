// Phase P0 — Semantic metric SSOT (plan §2.1). The CLOSED set of metric ids every intelligence
// surface (UI, Assist, dashboards, forecast) shares, so a KPI is defined ONCE and never recomputed
// with divergent SQL. P0 delivers the CONTRACT only — the deterministic business SQL for each metric
// lands per-module in later phases. No LLM, no financial calculation here.
import { z } from 'zod';

/** The approved metric catalog (plan §2.1). Extending it is a deliberate, reviewed change. */
export const METRIC_IDS = [
  'cycle_completion_rate',
  'payout_total',
  'budget_variance',
  'dispute_rate',
  'manual_override_rate',
  'cap_hit_rate',
  'approval_latency',
  'gaming_flag_rate',
  'opportunity_index',
  'policy_complexity',
  'payout_concentration',
] as const;

export type MetricId = (typeof METRIC_IDS)[number];

/** Zod enum mirroring the union — the single runtime guard for an untrusted metric id. */
export const MetricIdSchema = z.enum(METRIC_IDS);

/** Units a metric value can carry (plan §2.1). */
export const METRIC_UNITS = ['count', 'percent', 'minor_currency', 'duration_ms', 'score'] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];
export const MetricUnitSchema = z.enum(METRIC_UNITS);
