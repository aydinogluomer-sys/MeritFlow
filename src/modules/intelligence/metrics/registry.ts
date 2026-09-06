// Phase P0 — Metric REGISTRY (plan §2.1 / §24 intelligence-metric-author: "one definition, unit,
// dimensions, permissions"). A single source that maps each MetricId to its unit, the dimensions it
// may be sliced by, and the permission required to read it. NO deterministic SQL lives here — that is
// authored per-module in later phases; the registry is the contract the validator enforces against.
import type { MetricId } from './metric-id';
import type { MetricUnit } from './metric-id';
import type { DimensionId } from '../dimensions/dimension-catalog';

/** The read permission every intelligence metric requires by default (plan §2.6). */
export const METRIC_READ_PERMISSION = 'intelligence.read' as const;

/**
 * A metric's contract. `allowedDimensions` is the closed set a SemanticQuery may group/filter this
 * metric by; `requiredPermission` is checked server-side against the caller's DB-sourced permissions
 * (AD1 — never JWT). `sql` is intentionally ABSENT in P0 (contract-only; §13 gate).
 */
export interface MetricDefinition {
  id: MetricId;
  unit: MetricUnit;
  allowedDimensions: readonly DimensionId[];
  requiredPermission: string;
}

export interface MetricRegistry {
  get(id: MetricId): MetricDefinition | undefined;
  has(id: MetricId): boolean;
  all(): readonly MetricDefinition[];
}

/** Build an immutable registry keyed by metric id. Duplicate ids are rejected (author error). */
export function createMetricRegistry(defs: readonly MetricDefinition[]): MetricRegistry {
  const byId = new Map<MetricId, MetricDefinition>();
  for (const def of defs) {
    if (byId.has(def.id)) throw new Error(`duplicate metric definition: ${def.id}`);
    byId.set(def.id, def);
  }
  return {
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    all: () => Array.from(byId.values()),
  };
}

// The approved P0 metric contracts. Every metric is read-gated by `intelligence.read`; person-level
// dimensions (employee/manager) additionally require the elevated sensitive-dimension permission,
// enforced by the validator — see dimensions/dimension-catalog.ts.
const DEFINITIONS: readonly MetricDefinition[] = [
  { id: 'cycle_completion_rate', unit: 'percent', requiredPermission: METRIC_READ_PERMISSION,
    allowedDimensions: ['organization', 'team', 'bonus_period', 'cycle'] },
  { id: 'payout_total', unit: 'minor_currency', requiredPermission: METRIC_READ_PERMISSION,
    allowedDimensions: ['organization', 'team', 'bonus_period', 'role', 'employee', 'manager'] },
  { id: 'budget_variance', unit: 'percent', requiredPermission: METRIC_READ_PERMISSION,
    allowedDimensions: ['organization', 'team', 'bonus_period'] },
  { id: 'dispute_rate', unit: 'percent', requiredPermission: METRIC_READ_PERMISSION,
    allowedDimensions: ['organization', 'team', 'bonus_period', 'dispute_type', 'policy_version'] },
  { id: 'manual_override_rate', unit: 'percent', requiredPermission: METRIC_READ_PERMISSION,
    allowedDimensions: ['organization', 'team', 'bonus_period', 'policy_version', 'manager'] },
  { id: 'cap_hit_rate', unit: 'percent', requiredPermission: METRIC_READ_PERMISSION,
    allowedDimensions: ['organization', 'team', 'bonus_period', 'role'] },
  { id: 'approval_latency', unit: 'duration_ms', requiredPermission: METRIC_READ_PERMISSION,
    allowedDimensions: ['organization', 'team', 'bonus_period', 'manager', 'task_type'] },
  { id: 'gaming_flag_rate', unit: 'percent', requiredPermission: METRIC_READ_PERMISSION,
    allowedDimensions: ['organization', 'team', 'bonus_period', 'employee'] },
  { id: 'opportunity_index', unit: 'score', requiredPermission: METRIC_READ_PERMISSION,
    allowedDimensions: ['organization', 'team', 'bonus_period', 'role', 'employee'] },
  { id: 'policy_complexity', unit: 'score', requiredPermission: METRIC_READ_PERMISSION,
    allowedDimensions: ['organization', 'policy_version'] },
  { id: 'payout_concentration', unit: 'score', requiredPermission: METRIC_READ_PERMISSION,
    allowedDimensions: ['organization', 'team', 'bonus_period'] },
];

/** The default P0 metric registry (all 11 approved metrics, contract-only). */
export const metricRegistry: MetricRegistry = createMetricRegistry(DEFINITIONS);
