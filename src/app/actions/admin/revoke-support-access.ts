'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { RevokeSupportAccessSchema } from '@/lib/validation/schemas/support';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { revokeSupportAccess as revokeSupportAccessModule } from '@/modules/admin';

/**
 * Thin server-action wrapper (ENGINEERING-02F). Enforces support.grant, then delegates to the
 * admin module. The 0005 trigger audits the update automatically. Behavior unchanged.
 */
export const revokeSupportAccess = validatedAction(RevokeSupportAccessSchema, async (input) => {
  await requirePermission('support.grant');
  const org = await getActiveOrg();
  return revokeSupportAccessModule(input, { organizationId: org!.organization_id });
});
