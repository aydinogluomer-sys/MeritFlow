'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { PostAccrualSchema } from '@/lib/validation/schemas/bonus';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Post the bonus accrual (double-entry ledger) from an approved snapshot.
 * SECURITY DEFINER RPC → admin client.
 */
export const postAccrual = validatedAction(PostAccrualSchema, async (input) => {
  await requirePermission('calculation.approve');
  const org = await getActiveOrg();
  const user = await getUser();

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('post_bonus_accrual', {
    p_organization_id: org!.organization_id,
    p_bonus_period_id: input.periodId,
    p_triggered_by: user!.id,
  });

  if (error) throw new Error(error.message);

  return data;
});
