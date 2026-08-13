'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { RecalculateSchema } from '@/lib/validation/schemas/bonus';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { recalculate as recalculateModule, BonusCalculationRepository } from '@/modules/bonus-calculation';

/**
 * Thin server-action wrapper (ENGINEERING-02D). Enforces period.manage, then delegates to the
 * bonus-calculation module. The admin client (for the SECURITY DEFINER RPC) is created HERE and
 * injected into the repository. Behavior (RPC params, raw return) unchanged.
 */
export const recalculate = validatedAction(RecalculateSchema, async (input) => {
  await requirePermission('period.manage');
  const org = await getActiveOrg();
  const user = await getUser();

  const repo = new BonusCalculationRepository(createAdminClient());
  return recalculateModule(
    { periodId: input.periodId },
    { organizationId: org!.organization_id, userId: user!.id },
    repo,
  );
});
