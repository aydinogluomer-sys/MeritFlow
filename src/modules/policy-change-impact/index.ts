// Public API for the `policy-change-impact` domain module (Module 6 — Phase P1, plan §8).
// Slices 6-A + 6-B: the structural diff engine + governance change-request surface (state machine,
// dual HR/Finance approval), PLUS the deterministic scoring mirror, the impact backtest (reuses the
// pure allocateBonus engine), and the append-only IMMUTABLE impact artifact + advisory insight
// emission. Consumers import ONLY from `@/modules/policy-change-impact` — never a deep internal path
// (ESLint no-restricted-imports boundary). Nothing mutates a published policy version or any ledger,
// and run_bonus_calculation is never called; the diff / scoring mirror / backtest are deterministic
// truth, the impact artifact + insight are advisory. UI is slice 6-C (deferred).

// --- Structural diff engine (deterministic, order-independent) ---
export { diffPolicyVersions, configFromVersionRow } from './domain/diff';
export type {
  JsonValue,
  JsonObject,
  PolicyVersionConfig,
  PolicyDiff,
  PolicyDiffEntry,
  PolicyDiffCategory,
  PolicyDiffChangeType,
  ChangeRequestStatus,
} from './domain/types';
export { CHANGE_REQUEST_STATUSES } from './domain/types';

// --- Change-request lifecycle state machine (mirror of the DB trigger) ---
export { canTransition, assertTransition, isTerminalStatus } from './domain/change-request-status';

// --- Governance repository (RLS reads / RLS+trigger-gated writes) ---
export {
  PolicyChangeRequestRepository,
  type PolicyChangeRequest,
} from './repository/policy-change-request-repository';

// --- Application (feature-flag gated governance actions + diff) ---
export { computePolicyDiff } from './application/compute-diff';
export {
  createPolicyChangeRequest,
  submitPolicyChangeRequest,
  approvePolicyChangeRequestAsHr,
  approvePolicyChangeRequestAsFinance,
  rejectPolicyChangeRequest,
  requestChangesOnPolicyChangeRequest,
} from './application/change-requests';
export type { PolicyChangeImpactContext } from './application/feature-gate';

// --- Input contracts ---
export {
  NewChangeRequestInputSchema,
  DecisionInputSchema,
  type NewChangeRequestInput,
  type DecisionInput,
} from './schemas/change-request';

// --- 6-B: scoring mirror (pure, reproduces the 0020 DB engine) ---
export { scoreTask } from './domain/scoring-mirror';
export type { ScoringInputs, ScoringPolicy } from './domain/scoring-mirror';

// --- 6-B: impact backtest (deterministic, advisory; reuses allocateBonus) ---
export { runBacktest } from './domain/backtest';
export type {
  ReferenceTask,
  ReferenceEmployee,
  ReferenceDataset,
  EmployeeImpact,
  ImpactSummary,
  BacktestResult,
} from './domain/backtest';

// --- 6-B: impact artifact repository + generation (writes artifact + emits P0 insight) ---
export {
  PolicyChangeImpactRepository,
  type PolicyChangeImpact,
} from './repository/policy-change-impact-repository';
export { generatePolicyChangeImpact, type GenerateImpactInput } from './application/generate-impact';
