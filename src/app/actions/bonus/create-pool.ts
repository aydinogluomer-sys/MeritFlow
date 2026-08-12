'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { CreatePoolSchema } from '@/lib/validation/schemas/bonus';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

/**
 * Create a bonus pool for a period (starts 'draft'). Inserts into `bonus_pools` via the
 * RLS user client — bonus_pools_insert enforces org + pool.create server-side (AD1). The
 * pool's AFTER-INSERT audit trigger (0011 trg_audit_bonus_pools) writes the audit row, so
 * no manual audit log here. status/version_no default in the DB ('draft'/1); t_org is set
 * only at lock time (a later slice), so it is left null here.
 */
export const createPool = validatedAction(CreatePoolSchema, async (input) => {
  await requirePermission('pool.create');

  const org = await getActiveOrg();
  const user = await getUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bonus_pools')
    .insert({
      organization_id: org!.organization_id,
      bonus_period_id: input.bonusPeriodId,
      amount_minor: input.amountMinor,
      currency: input.currency,
      created_by: user!.id,
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);

  return { poolId: (data as { id: string }).id };
});
