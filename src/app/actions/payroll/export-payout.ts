'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { ExportPayoutSchema } from '@/lib/validation/schemas/payroll';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { exportPayout as exportPayoutModule, ExportsRepository } from '@/modules/exports';

/**
 * Thin server-action wrapper (ENGINEERING-02F). Enforces payout.export, then delegates to the
 * exports module. The admin client (for the SECURITY DEFINER RPC) is created HERE and injected.
 * Behavior (RPC params, { exportId }) unchanged.
 */
export const exportPayout = validatedAction(ExportPayoutSchema, async (input) => {
  await requirePermission('payout.export');
  const org = await getActiveOrg();
  const user = await getUser();

  const repo = new ExportsRepository(createAdminClient());
  return exportPayoutModule(input, { organizationId: org!.organization_id, userId: user!.id }, repo);
});
