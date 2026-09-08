'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { requirePermission, PermissionError } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import {
  approvePolicyChangeRequestAsHr,
  approvePolicyChangeRequestAsFinance,
} from '@/modules/policy-change-impact';
import { ChangeRequestIdSchema } from '@/lib/validation/schemas/policy-impact';

/**
 * Stamp the caller's dual-approval slot. ROLE-gated (§8.7): an HR actor stamps the HR slot, a Finance
 * actor the Finance slot; both present auto-promotes the request to approved (DB trigger). Anyone
 * else is rejected here AND by RLS + the validate trigger (defense-in-depth; DB is the ultimate guard).
 */
export const approveChangeRequest = validatedAction(ChangeRequestIdSchema, async (input) => {
  // Authz floor (AD1, server-side): only policy.impact.read holders (owner/admin/hr/finance/auditor)
  // may act; the role check below then routes HR→HR slot / Finance→Finance slot (auditor/owner have
  // the read floor but not an approval role → rejected here and by RLS + the validate trigger).
  await requirePermission('policy.impact.read');
  const org = await getActiveOrg();
  const user = await getUser();
  const ctx = { organizationId: org!.organization_id, userId: user!.id };
  const role = org!.primary_role;

  if (role === 'hr') return approvePolicyChangeRequestAsHr(input.changeRequestId, ctx);
  if (role === 'finance') return approvePolicyChangeRequestAsFinance(input.changeRequestId, ctx);
  throw new PermissionError('policy.change.approve (hr|finance)');
});
