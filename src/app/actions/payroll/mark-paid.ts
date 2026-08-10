'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { MarkPaidSchema } from '@/lib/validation/schemas/payroll';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Mark a payout export as paid. SECURITY DEFINER RPC → admin client.
 */
export const markPaid = validatedAction(MarkPaidSchema, async (input) => {
  await requirePermission('payout.mark_paid');
  const org = await getActiveOrg();
  const user = await getUser();

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('mark_payout_paid', {
    p_organization_id: org!.organization_id,
    p_bonus_period_id: input.periodId,
    p_export_id: input.exportId,
    p_actor: user!.id,
  });

  if (error) throw new Error(error.message);

  return data;
});
