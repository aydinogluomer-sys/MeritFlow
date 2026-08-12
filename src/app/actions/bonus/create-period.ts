'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { CreatePeriodSchema } from '@/lib/validation/schemas/bonus';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

/**
 * Create a bonus period (starts 'open'). Inserts into `bonus_periods` via the RLS user
 * client — bonus_periods_insert enforces org + period.manage server-side (AD1). The
 * period's AFTER-INSERT audit trigger (0011 trg_audit_bonus_periods) writes the audit
 * row, so no manual audit log here. status is left to the DB default ('open'; the
 * state machine requires INSERT status = open).
 */
export const createPeriod = validatedAction(CreatePeriodSchema, async (input) => {
  await requirePermission('period.manage');

  const org = await getActiveOrg();
  const user = await getUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bonus_periods')
    .insert({
      organization_id: org!.organization_id,
      period_type: input.periodType,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      created_by: user!.id,
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);

  return { periodId: (data as { id: string }).id };
});
