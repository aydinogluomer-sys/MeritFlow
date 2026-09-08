// Public API for the `policy-change-impact` domain module (Module 6 — Phase P1, plan §8).
// Slice 6-A: the pure structural diff engine + the governance change-request surface (state machine,
// dual HR/Finance approval). Consumers import ONLY from `@/modules/policy-change-impact` — never a
// deep internal path (ESLint no-restricted-imports boundary). NO backtest, NO impact ledger, NO
// insight emission, NO UI here — those are slices 6-B / 6-C. Nothing here mutates a published policy
// version or any ledger; the structural diff is deterministic truth, read-only.

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
