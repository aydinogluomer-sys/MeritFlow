// Phase P4 — Module 8-A1 · drill scaffolding (plan §10.10). Turns a metric + a drill LEVEL (company →
// team → employee) into a SemanticQuery that executeSemanticQuery can run. It is permission-aware by
// CONSTRUCTION: it only offers levels a metric's executor can serve, and the person-level (employee)
// level maps to a sensitive dimension whose permission the P0 validator enforces at execution — plus
// RLS scopes the rows. This module builds the plan; the service enforces authz. (The drill UI is 8-B/8-C.)
import type { MetricId } from '../metrics/metric-id';
import type { DimensionId } from '../dimensions/dimension-catalog';
import type { SemanticQuery, PeriodSelector, Filter, Comparison } from '../metrics/semantic-query';
import { isMetricExecutable, servableDimensions } from '../metrics/executors/registry';
import { executionError, type ExecutionError } from '../metrics/executors/errors';

/** The drill hierarchy levels 8-A1 exposes (component-level is 8-B/8-C). */
export const DRILL_LEVELS = ['company', 'team', 'employee'] as const;
export type DrillLevel = (typeof DRILL_LEVELS)[number];

/** The group-by dimension a level maps to; company = org-level (no grouping). */
const LEVEL_DIMENSION: Record<DrillLevel, DimensionId | null> = {
  company: null,
  team: 'team',
  employee: 'employee',
};

export interface DrillRequest {
  metric: MetricId;
  level: DrillLevel;
  period: PeriodSelector;
  /** Optional narrowing (e.g. drill company→team→employee within one team). */
  filters?: Filter[];
  comparison?: Comparison;
}

export type BuildDrillResult =
  | { ok: true; query: SemanticQuery }
  | { ok: false; error: ExecutionError };

/** The drill levels a metric can actually serve now (for a UI to enable/disable drill affordances). */
export function availableDrillLevels(metric: MetricId): DrillLevel[] {
  if (!isMetricExecutable(metric)) return [];
  const servable = servableDimensions(metric);
  return DRILL_LEVELS.filter((level) => {
    const dim = LEVEL_DIMENSION[level];
    return dim === null || servable.has(dim);
  });
}

/**
 * Build the SemanticQuery for a metric at a drill level. Rejects (typed) when the metric has no 8-A1
 * executor or cannot serve the level's dimension — so a caller never composes a query the service would
 * only reject later. Permission for the sensitive (employee) level is enforced when the query executes.
 */
export function buildDrillQuery(req: DrillRequest): BuildDrillResult {
  if (!isMetricExecutable(req.metric)) {
    return { ok: false, error: executionError('metric_not_executable', `metric ${req.metric} has no 8-A1 executor`) };
  }
  const dim = LEVEL_DIMENSION[req.level];
  if (dim !== null && !servableDimensions(req.metric).has(dim)) {
    return {
      ok: false,
      error: executionError('dimension_not_executable', `metric ${req.metric} cannot drill to ${req.level} in 8-A1`),
    };
  }
  const query: SemanticQuery = {
    metrics: [req.metric],
    dimensions: dim ? [dim] : [],
    filters: req.filters ?? [],
    period: req.period,
    ...(req.comparison ? { comparison: req.comparison } : {}),
  };
  return { ok: true, query };
}
