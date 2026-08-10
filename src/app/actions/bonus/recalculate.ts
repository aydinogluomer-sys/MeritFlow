'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { RecalculateSchema } from '@/lib/validation/schemas/bonus';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Recalculate a bonus period after a dispute adjustment. SECURITY DEFINER RPC → admin client.
 */
export const recalculate = validatedAction(RecalculateSchema, async (input) => {
  await requirePermission('period.manage');
  const org = await getActiveOrg();
  const user = await getUser();

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('recalculate_bonus_after_dispute', {
    p_organization_id: org!.organization_id,
    p_bonus_period_id: input.periodId,
    p_triggered_by: user!.id,
  });

  if (error) throw new Error(error.message);

  return data;
});
