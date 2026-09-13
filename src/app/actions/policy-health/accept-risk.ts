'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { acceptHealthRisk } from '@/modules/incentive-health';
import { AcceptHealthRiskSchema } from '@/lib/validation/schemas/policy-health';

/**
 * Accept (waive) a specific surfaced health risk driver (Module 1-C → the 1-B workflow). A risk is
 * NEVER silently dismissed (§3.8): reason is mandatory (schema), the acceptance is append-only and
 * AUDITED (§2.7). Enforces policy.manage server-side (defense-in-depth); the WRITE uses the RLS USER
 * client (NOT admin) so the authenticated INSERT policy runs — its WITH CHECK ties accepted_by to
 * auth.uid() and log_audit records the acting owner as the audit actor. Using the admin/service_role
 * client would bypass that WITH CHECK and null the audit actor. Accepting NEVER changes the computed
 * health score and mutates no policy/ledger. The module validates the driver against the evaluation.
 */
export const acceptHealthRiskAction = validatedAction(AcceptHealthRiskSchema, async (input) => {
  await requirePermission('policy.manage');
  const org = await getActiveOrg();
  const user = await getUser();
  const supabase = await createClient();
  const acceptance = await acceptHealthRisk(
    {
      healthEvaluationId: input.healthEvaluationId,
      dimension: input.dimension,
      driverCode: input.driverCode,
      reason: input.reason,
      expiresAt: input.expiresAt ?? null,
    },
    { organizationId: org!.organization_id, userId: user!.id },
    supabase,
  );
  return { acceptanceId: acceptance.id };
});
