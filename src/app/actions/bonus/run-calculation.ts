'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { RunCalculationSchema } from '@/lib/validation/schemas/bonus';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { runCalculation as runCalculationModule, BonusCalculationRepository } from '@/modules/bonus-calculation';

/**
 * Thin server-action wrapper (ENGINEERING-02D). Enforces period.manage, mints the UI-layer
 * idempotency key, then delegates to the bonus-calculation module. The admin client (for the
 * SECURITY DEFINER RPC) is created HERE and injected into the repository. Behavior unchanged.
 */
export const runCalculation = validatedAction(RunCalculationSchema, async (input) => {
  await requirePermission('period.manage');
  const org = await getActiveOrg();
  const user = await getUser();

  const repo = new BonusCalculationRepository(createAdminClient());
  return runCalculationModule(
    { ...input, idempotencyKey: `ui-calc-${input.periodId}-${Date.now()}` },
    { organizationId: org!.organization_id, userId: user!.id },
    repo,
  );
});
