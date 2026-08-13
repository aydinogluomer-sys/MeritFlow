'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { ResolveDisputeSchema } from '@/lib/validation/schemas/disputes';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveDispute as resolveDisputeModule, DisputeAdjustmentRepository } from '@/modules/disputes';

/**
 * Thin server-action wrapper (ENGINEERING-02E). Enforces dispute.resolve, then delegates to the
 * disputes module. A SINGLE admin client (for the two SECURITY DEFINER RPCs) is created HERE and
 * injected via DisputeAdjustmentRepository, so both RPCs run on one instance. Behavior unchanged.
 */
export const resolveDispute = validatedAction(ResolveDisputeSchema, async (input) => {
  await requirePermission('dispute.resolve');
  const org = await getActiveOrg();
  const user = await getUser();

  const adjRepo = new DisputeAdjustmentRepository(createAdminClient());
  return resolveDisputeModule(
    input,
    { organizationId: org!.organization_id, userId: user!.id },
    adjRepo,
  );
});
