'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import {
  createPolicyChangeRequest,
  NewChangeRequestInputSchema,
} from '@/modules/policy-change-impact';

/**
 * Thin server-action wrapper (Module 6-C). Enforces policy.manage, then delegates to the
 * policy-change-impact module (RLS user client + validate trigger enforce version relationship,
 * self-stamp, and §8.2 published-immutability). Never mutates a published version.
 */
export const createChangeRequest = validatedAction(NewChangeRequestInputSchema, async (input) => {
  await requirePermission('policy.manage');
  const org = await getActiveOrg();
  const user = await getUser();
  return createPolicyChangeRequest(input, {
    organizationId: org!.organization_id,
    userId: user!.id,
  });
});
