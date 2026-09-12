import { z } from 'zod';

// Phase P1 / slice 4-C — action schema for the Policy Debt UI. The evaluate/refresh action targets
// one scoring_policy_version; commandId is optional (correlation only).
export const EvaluatePolicyDebtSchema = z.object({
  policyVersionId: z.string().uuid(),
  commandId: z.string().uuid().optional(),
});

export type EvaluatePolicyDebtInput = z.infer<typeof EvaluatePolicyDebtSchema>;
