'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { RunCalculationSchema } from '@/lib/validation/schemas/bonus';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Run a bonus calculation for a period/pool. SECURITY DEFINER RPC → admin client.
 * Returns the newly produced snapshot id.
 */
export const runCalculation = validatedAction(RunCalculationSchema, async (input) => {
  await requirePermission('period.manage');
  const org = await getActiveOrg();
  const user = await getUser();

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('run_bonus_calculation', {
    p_organization_id: org!.organization_id,
    p_bonus_period_id: input.periodId,
    p_bonus_pool_id: input.poolId,
    p_idempotency_key: `ui-calc-${input.periodId}-${Date.now()}`,
    p_triggered_by: user!.id,
  });

  if (error) throw new Error(error.message);

  return { snapshotId: data };
});
