'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { CreatePeriodSchema } from '@/lib/validation/schemas/bonus';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createPeriod as createPeriodModule } from '@/modules/bonus-periods';

/**
 * Thin server-action wrapper (ENGINEERING-02D). Enforces period.manage, then delegates to the
 * bonus-periods module (RLS user client). Behavior unchanged (insert shape, audit via trigger).
 */
export const createPeriod = validatedAction(CreatePeriodSchema, async (input) => {
  await requirePermission('period.manage');
  const org = await getActiveOrg();
  const user = await getUser();
  return createPeriodModule(input, { organizationId: org!.organization_id, userId: user!.id });
});
