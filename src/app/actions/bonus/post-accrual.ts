'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { PostAccrualSchema } from '@/lib/validation/schemas/bonus';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { postAccrual as postAccrualModule, BonusLedgerRepository } from '@/modules/bonus-ledger';

/**
 * Thin server-action wrapper (ENGINEERING-02D). Enforces calculation.approve, then delegates to
 * the bonus-ledger module. The admin client (for the SECURITY DEFINER RPC) is created HERE and
 * injected into the repository. Behavior (RPC params, raw return) unchanged.
 */
export const postAccrual = validatedAction(PostAccrualSchema, async (input) => {
  await requirePermission('calculation.approve');
  const org = await getActiveOrg();
  const user = await getUser();

  const repo = new BonusLedgerRepository(createAdminClient());
  return postAccrualModule(
    { periodId: input.periodId },
    { organizationId: org!.organization_id, userId: user!.id },
    repo,
  );
});
