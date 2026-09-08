'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { generatePolicyChangeImpact } from '@/modules/policy-change-impact';
import { RunSimulationSchema } from '@/lib/validation/schemas/policy-impact';

/**
 * Run (or re-run) the impact backtest for a change request over a chosen locked reference period
 * (§8.10 "Run another simulation"). Enforces policy.manage; the service_role admin client is created
 * HERE and injected (SI-11 boundary — the module never imports it). The engine reuses the pure
 * allocateBonus, writes the append-only artifact, and emits the advisory insight. NO ledger write,
 * NO run_bonus_calculation, NO published-version mutation.
 */
export const runSimulation = validatedAction(RunSimulationSchema, async (input) => {
  await requirePermission('policy.manage');
  const org = await getActiveOrg();
  const user = await getUser();
  return generatePolicyChangeImpact(
    { changeRequestId: input.changeRequestId, referencePeriodId: input.referencePeriodId },
    { organizationId: org!.organization_id, userId: user!.id },
    createAdminClient(),
  );
});
