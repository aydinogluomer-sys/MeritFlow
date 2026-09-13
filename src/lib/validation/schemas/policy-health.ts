import { z } from 'zod';

// Phase P2 / slice 1-C — action schemas for the Policy Health UI.

// Evaluate/refresh one scoring_policy_version's health (idempotent). commandId is correlation-only.
export const EvaluatePolicyHealthSchema = z.object({
  policyVersionId: z.string().uuid(),
  commandId: z.string().uuid().optional(),
});
export type EvaluatePolicyHealthInput = z.infer<typeof EvaluatePolicyHealthSchema>;

// Accept a specific surfaced risk driver of a health evaluation (§3.8): reason is MANDATORY, expiry
// optional. dimension + driverCode identify the waived driver; they are validated against the
// referenced evaluation server-side (the module fn). A risk is never dismissed without a reason.
export const AcceptHealthRiskSchema = z.object({
  healthEvaluationId: z.string().uuid(),
  dimension: z.string().min(1),
  driverCode: z.string().min(1),
  reason: z.string().trim().min(1, 'Gerekçe zorunludur'),
  expiresAt: z.string().datetime().optional(),
  commandId: z.string().uuid().optional(),
});
export type AcceptHealthRiskFormInput = z.infer<typeof AcceptHealthRiskSchema>;
