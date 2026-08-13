'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { MarkPaidSchema } from '@/lib/validation/schemas/payroll';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { markPaid as markPaidModule, ExportsRepository } from '@/modules/exports';

/**
 * Thin server-action wrapper (ENGINEERING-02F). Enforces payout.mark_paid, then delegates to the
 * exports module. The admin client (for the SECURITY DEFINER RPC) is created HERE and injected.
 * Behavior (RPC params, raw return) unchanged.
 */
export const markPaid = validatedAction(MarkPaidSchema, async (input) => {
  await requirePermission('payout.mark_paid');
  const org = await getActiveOrg();
  const user = await getUser();

  const repo = new ExportsRepository(createAdminClient());
  return markPaidModule(input, { organizationId: org!.organization_id, userId: user!.id }, repo);
});
