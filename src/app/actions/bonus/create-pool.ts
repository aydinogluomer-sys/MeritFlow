'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { CreatePoolSchema } from '@/lib/validation/schemas/bonus';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createPool as createPoolModule } from '@/modules/bonus-periods';

/**
 * Thin server-action wrapper (ENGINEERING-02D). Enforces pool.create, then delegates to the
 * bonus-periods module (RLS user client). Behavior unchanged.
 */
export const createPool = validatedAction(CreatePoolSchema, async (input) => {
  await requirePermission('pool.create');
  const org = await getActiveOrg();
  const user = await getUser();
  return createPoolModule(input, { organizationId: org!.organization_id, userId: user!.id });
});
