'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { evaluatePolicyHealth } from '@/modules/incentive-health';
import { EvaluatePolicyHealthSchema } from '@/lib/validation/schemas/policy-health';

/**
 * Evaluate/refresh a policy version's incentive health (Module 1-C). Enforces policy.manage
 * server-side, then delegates to the incentive-health module (feature-flag 'health_engine' gated
 * inside). The service_role admin client is created HERE and injected (SI-11 — never imported in a
 * module/client component) because policy_health_evaluations is server-only-write. Idempotent: reuses
 * the existing (version, rule_set_version) evaluation. Reads only — NO policy/ledger mutation; no LLM.
 */
export const evaluatePolicyHealthAction = validatedAction(EvaluatePolicyHealthSchema, async (input) => {
  await requirePermission('policy.manage');
  const org = await getActiveOrg();
  const user = await getUser();
  const result = await evaluatePolicyHealth(
    input.policyVersionId,
    { organizationId: org!.organization_id, userId: user!.id },
    createAdminClient(),
  );
  return {
    evaluationId: result.evaluation.id,
    overallScore: result.evaluation.overallScore,
    created: result.created,
  };
});
