'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { evaluatePolicyDebt } from '@/modules/policy-complexity';
import { EvaluatePolicyDebtSchema } from '@/lib/validation/schemas/policy-debt';

/**
 * Evaluate/refresh a policy version's debt (Module 4-C). Enforces policy.manage server-side, then
 * delegates to the policy-complexity module (feature-flag gated inside). The service_role admin
 * client is created HERE and injected (SI-11 boundary — never imported in a module/client component);
 * the module READS the config + operational data and writes the append-only evaluation + advisory
 * insight. Idempotent: reuses the existing (version, rule_set_version) evaluation. NO policy mutation.
 */
export const evaluatePolicyDebtAction = validatedAction(EvaluatePolicyDebtSchema, async (input) => {
  await requirePermission('policy.manage');
  const org = await getActiveOrg();
  const user = await getUser();
  const result = await evaluatePolicyDebt(
    input.policyVersionId,
    { organizationId: org!.organization_id, userId: user!.id },
    createAdminClient(),
  );
  return {
    evaluationId: result.evaluation.id,
    totalScore: result.evaluation.totalScore,
    candidateCount: result.candidates.length,
  };
});
