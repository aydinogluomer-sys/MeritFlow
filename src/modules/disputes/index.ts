// Public API for the `disputes` domain module (ENGINEERING-02A boundary).
// Consumers import only from `@/modules/disputes` — never deep internal paths.
export { openDispute } from './application/open-dispute';
export { assignReviewer } from './application/assign-reviewer';
export { resolveDispute } from './application/resolve-dispute';
export { DisputeRepository } from './repository/dispute-repository';
export { DisputeAdjustmentRepository } from './repository/dispute-adjustment-repository';
export type {
  OpenDisputeInput,
  AssignReviewerInput,
  ResolveDisputeInput,
  DisputeContext,
  ReviewerContext,
  DisputeType,
  DisputeResolution,
} from './domain/types';
