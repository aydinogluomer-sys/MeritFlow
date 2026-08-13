'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { ManualOverrideSchema } from '@/lib/validation/schemas/points';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { manualOverride as manualOverrideModule, PointLedgerRepository } from '@/modules/point-ledger';

/**
 * Thin server-action wrapper (ENGINEERING-02C). Enforces point.override, then delegates to the
 * point-ledger module. The admin client (for the SECURITY DEFINER RPC) is created HERE and
 * injected into the repository, so the module never imports the admin client. Behavior (permission,
 * RPC params, return/error shape) is unchanged from before the refactor.
 */
export const manualOverride = validatedAction(ManualOverrideSchema, async (input) => {
  await requirePermission('point.override');
  const org = await getActiveOrg();
  const user = await getUser();

  const repo = new PointLedgerRepository(createAdminClient());
  return manualOverrideModule(
    input,
    { organizationId: org!.organization_id, userId: user!.id },
    repo,
  );
});
