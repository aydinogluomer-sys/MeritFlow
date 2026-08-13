'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { OpenDisputeSchema } from '@/lib/validation/schemas/disputes';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { openDispute as openDisputeModule } from '@/modules/disputes';

/**
 * Thin server-action wrapper (ENGINEERING-02E). Enforces dispute.open, then delegates to the
 * disputes module. Behavior (insert shape, returned id) unchanged.
 */
export const openDispute = validatedAction(OpenDisputeSchema, async (input) => {
  await requirePermission('dispute.open');
  const org = await getActiveOrg();
  const user = await getUser();
  return openDisputeModule(input, { organizationId: org!.organization_id, userId: user!.id });
});
