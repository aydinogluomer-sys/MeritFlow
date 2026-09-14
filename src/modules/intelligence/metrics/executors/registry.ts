// Phase P4 — Module 8-A1 · executor registry. Maps each EXECUTABLE MetricId to its deterministic
// executor + the closed set of group-by/filter dimensions it can serve. Metrics with NO 8-A1 executor
// (cap_hit_rate, dispute_rate — see the pre-flight audit) are DELIBERATELY ABSENT so the service
// rejects them with metric_not_executable until 8-A2. Units are sourced from the P0 registry (SSOT)
// so an executor can never emit a unit that disagrees with the metric contract.
import type { MetricId } from '../metric-id';
import type { DimensionId } from '../../dimensions/dimension-catalog';
import { metricRegistry } from '../registry';
import type { ExecutorEntry } from './types';
import {
  opportunityIndexExecutor,
  OPPORTUNITY_INDEX_SERVABLE,
  policyComplexityExecutor,
  POLICY_COMPLEXITY_SERVABLE,
} from './precomputed';
import {
  payoutTotalExecutor,
  PAYOUT_TOTAL_SERVABLE,
  payoutConcentrationExecutor,
  PAYOUT_CONCENTRATION_SERVABLE,
  budgetVarianceExecutor,
  BUDGET_VARIANCE_SERVABLE,
} from './finance';
import {
  cycleCompletionRateExecutor,
  CYCLE_COMPLETION_SERVABLE,
  approvalLatencyExecutor,
  APPROVAL_LATENCY_SERVABLE,
} from './tasks';
import {
  manualOverrideRateExecutor,
  MANUAL_OVERRIDE_SERVABLE,
  gamingFlagRateExecutor,
  GAMING_FLAG_SERVABLE,
} from './activity';
import {
  capHitRateExecutor,
  CAP_HIT_RATE_SERVABLE,
  CAP_HIT_ALLOCATION_ROLES,
  disputeRateExecutor,
  DISPUTE_RATE_SERVABLE,
} from './cap-dispute';
import {
  capMoneyImpactExecutor,
  CAP_MONEY_IMPACT_SERVABLE,
  teamCostExecutor,
  TEAM_COST_SERVABLE,
  costPerEmployeeExecutor,
  COST_PER_EMPLOYEE_SERVABLE,
} from './money-delta';
import type { MetricExecutor } from './types';

// 8-B3: the finance money-delta views (0050) are self-gated to these roles; a source-excluded role must
// get metric_not_available_for_role (never a silent 0). Mirrors CAP_HIT_ALLOCATION_ROLES.
const FINANCE_MONEY_ROLES: ReadonlySet<string> = new Set(['hr', 'finance', 'auditor']);

function entry(
  id: MetricId,
  servable: DimensionId[],
  execute: MetricExecutor,
  availableRoles?: ReadonlySet<string>,
): [MetricId, ExecutorEntry] {
  const def = metricRegistry.get(id);
  if (!def) throw new Error(`executor references unknown metric: ${id}`);
  // Every servable dimension MUST be catalog-allowed for the metric (defense against author drift).
  for (const dim of servable) {
    if (dim !== 'organization' && !def.allowedDimensions.includes(dim)) {
      throw new Error(`executor for ${id} declares servable dimension ${dim} not allowed by the registry`);
    }
  }
  const value: ExecutorEntry = { unit: def.unit, servableDimensions: new Set(servable), execute };
  return [id, availableRoles ? { ...value, availableRoles } : value];
}

/** The executable metrics — all 11 as of 8-A2 (cap_hit_rate + dispute_rate complete the layer). */
export const executorRegistry: ReadonlyMap<MetricId, ExecutorEntry> = new Map<MetricId, ExecutorEntry>([
  entry('opportunity_index', OPPORTUNITY_INDEX_SERVABLE, opportunityIndexExecutor),
  entry('policy_complexity', POLICY_COMPLEXITY_SERVABLE, policyComplexityExecutor),
  entry('payout_total', PAYOUT_TOTAL_SERVABLE, payoutTotalExecutor),
  entry('payout_concentration', PAYOUT_CONCENTRATION_SERVABLE, payoutConcentrationExecutor),
  entry('budget_variance', BUDGET_VARIANCE_SERVABLE, budgetVarianceExecutor),
  entry('cycle_completion_rate', CYCLE_COMPLETION_SERVABLE, cycleCompletionRateExecutor),
  entry('approval_latency', APPROVAL_LATENCY_SERVABLE, approvalLatencyExecutor),
  entry('manual_override_rate', MANUAL_OVERRIDE_SERVABLE, manualOverrideRateExecutor),
  entry('gaming_flag_rate', GAMING_FLAG_SERVABLE, gamingFlagRateExecutor),
  // 8-A2: cap_hit_rate is HR/Auditor-only (bonus_allocations RLS, SI-12); other roles → typed reject.
  entry('cap_hit_rate', CAP_HIT_RATE_SERVABLE, capHitRateExecutor, CAP_HIT_ALLOCATION_ROLES),
  entry('dispute_rate', DISPUTE_RATE_SERVABLE, disputeRateExecutor),
  // 8-B3: finance money-delta metrics via the 0050 SI-12-safe definer-rights views (hr/finance/auditor).
  entry('cap_money_impact', CAP_MONEY_IMPACT_SERVABLE, capMoneyImpactExecutor, FINANCE_MONEY_ROLES),
  entry('team_cost', TEAM_COST_SERVABLE, teamCostExecutor, FINANCE_MONEY_ROLES),
  entry('cost_per_employee', COST_PER_EMPLOYEE_SERVABLE, costPerEmployeeExecutor, FINANCE_MONEY_ROLES),
]);

/** True when 8-A1 has a deterministic executor for the metric. */
export function isMetricExecutable(id: MetricId): boolean {
  return executorRegistry.has(id);
}

/** The dimensions an executable metric can serve as group-by/filter (empty set if not executable). */
export function servableDimensions(id: MetricId): ReadonlySet<DimensionId> {
  return executorRegistry.get(id)?.servableDimensions ?? new Set<DimensionId>();
}
