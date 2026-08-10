'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { ManualOverrideSchema } from '@/lib/validation/schemas/points';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Apply a manual point adjustment (reversal/adjustment entry — the ledger is never
 * mutated in place). Requires a second approver. SECURITY DEFINER RPC → admin client.
 * Returns the new ledger entry id.
 */
export const manualOverride = validatedAction(ManualOverrideSchema, async (input) => {
  await requirePermission('point.override');
  const org = await getActiveOrg();
  const user = await getUser();

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('apply_manual_point_adjustment', {
    p_organization_id: org!.organization_id,
    p_employee_id: input.employeeId,
    p_points_delta: input.pointsDelta,
    p_reason: input.reason,
    p_actor: user!.id,
    p_second_approver: input.secondApproverId,
    p_task_id: input.taskId ?? null,
  });

  if (error) throw new Error(error.message);

  return { ledgerId: data };
});
