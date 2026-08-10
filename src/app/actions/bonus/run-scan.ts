'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { RunScanSchema } from '@/lib/validation/schemas/bonus';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Run the deterministic anti-gaming scan. SECURITY DEFINER RPC → admin client.
 * This RPC takes NO actor/triggered_by argument; it returns the flag count.
 */
export const runScan = validatedAction(RunScanSchema, async (input) => {
  await requirePermission('period.manage');
  const org = await getActiveOrg();

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('run_anti_gaming_scan', {
    p_organization_id: org!.organization_id,
    p_bonus_period_id: input.periodId ?? null,
  });

  if (error) throw new Error(error.message);

  return { flagCount: data };
});
