'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { requirePermission, PermissionError } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import {
  rejectPolicyChangeRequest,
  requestChangesOnPolicyChangeRequest,
} from '@/modules/policy-change-impact';
import { DecideChangeRequestSchema } from '@/lib/validation/schemas/policy-impact';

/**
 * Reject or request changes on a submitted change request (§8.10 CTAs). ROLE-gated to HR/Finance
 * (the approvers); a decision_note is required (DB trigger). RLS + the validate trigger are the
 * ultimate guards.
 */
export const decideChangeRequest = validatedAction(DecideChangeRequestSchema, async (input) => {
  // Authz floor (AD1): policy.impact.read holders only; the role check then restricts the actual
  // decision to HR/Finance (RLS + the validate trigger are the ultimate guards).
  await requirePermission('policy.impact.read');
  const org = await getActiveOrg();
  const user = await getUser();
  const ctx = { organizationId: org!.organization_id, userId: user!.id };
  const role = org!.primary_role;
  if (role !== 'hr' && role !== 'finance') {
    throw new PermissionError('policy.change.decide (hr|finance)');
  }

  return input.decision === 'reject'
    ? rejectPolicyChangeRequest(input.changeRequestId, input.note, ctx)
    : requestChangesOnPolicyChangeRequest(input.changeRequestId, input.note, ctx);
});
