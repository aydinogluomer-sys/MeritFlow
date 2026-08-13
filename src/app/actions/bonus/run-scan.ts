'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { RunScanSchema } from '@/lib/validation/schemas/bonus';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createAdminClient } from '@/lib/supabase/admin';
import { runScan as runScanModule, AntiGamingRepository } from '@/modules/anti-gaming';

/**
 * Thin server-action wrapper (ENGINEERING-02E). Enforces period.manage, then delegates to the
 * anti-gaming module. The admin client (for the SECURITY DEFINER RPC) is created HERE and injected
 * into the repository. Behavior (RPC params — no p_triggered_by — and flagCount) unchanged.
 */
export const runScan = validatedAction(RunScanSchema, async (input) => {
  await requirePermission('period.manage');
  const org = await getActiveOrg();

  const repo = new AntiGamingRepository(createAdminClient());
  return runScanModule(
    { periodId: input.periodId ?? undefined },
    { organizationId: org!.organization_id },
    repo,
  );
});
