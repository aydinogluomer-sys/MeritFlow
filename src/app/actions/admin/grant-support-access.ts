'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { GrantSupportAccessSchema } from '@/lib/validation/schemas/support';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { grantSupportAccess as grantSupportAccessModule } from '@/modules/admin';

/**
 * Thin server-action wrapper (ENGINEERING-02F). Enforces support.grant, then delegates to the
 * admin module. The 0005 trigger audits the insert automatically. Behavior unchanged.
 */
export const grantSupportAccess = validatedAction(GrantSupportAccessSchema, async (input) => {
  await requirePermission('support.grant');
  const org = await getActiveOrg();
  const user = await getUser();
  return grantSupportAccessModule(input, {
    organizationId: org!.organization_id,
    userId: user!.id,
  });
});
