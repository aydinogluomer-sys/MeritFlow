'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { submitPolicyChangeRequest } from '@/modules/policy-change-impact';
import { ChangeRequestIdSchema } from '@/lib/validation/schemas/policy-impact';

/** Submit a draft change request for approval (draft → submitted). Enforces policy.manage. */
export const submitChangeRequest = validatedAction(ChangeRequestIdSchema, async (input) => {
  await requirePermission('policy.manage');
  const org = await getActiveOrg();
  const user = await getUser();
  return submitPolicyChangeRequest(input.changeRequestId, {
    organizationId: org!.organization_id,
    userId: user!.id,
  });
});
