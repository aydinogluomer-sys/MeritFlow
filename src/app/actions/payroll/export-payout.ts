'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { ExportPayoutSchema } from '@/lib/validation/schemas/payroll';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Produce a payout export from an immutable bonus snapshot. SECURITY DEFINER RPC → admin client.
 * Returns the produced export id.
 */
export const exportPayout = validatedAction(ExportPayoutSchema, async (input) => {
  await requirePermission('payout.export');
  const org = await getActiveOrg();
  const user = await getUser();

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('produce_payout_export', {
    p_organization_id: org!.organization_id,
    p_bonus_period_id: input.periodId,
    p_snapshot_id: input.snapshotId,
    p_format: input.format,
    p_actor: user!.id,
  });

  if (error) throw new Error(error.message);

  return { exportId: data };
});
