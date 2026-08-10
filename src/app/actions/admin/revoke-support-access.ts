'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { RevokeSupportAccessSchema } from '@/lib/validation/schemas/support';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';

/**
 * Revoke an active support access grant. RLS enforces support.grant on UPDATE and the
 * 0005 trigger audits the update automatically. Scoped to the active org and to
 * status='active' so re-revoking a revoked/expired grant is a no-op.
 */
export const revokeSupportAccess = validatedAction(RevokeSupportAccessSchema, async (input) => {
  await requirePermission('support.grant');
  const org = await getActiveOrg();

  const supabase = await createClient();
  const { error } = await supabase
    .from('support_access_grants')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('id', input.grantId)
    .eq('organization_id', org!.organization_id)
    .eq('status', 'active');

  if (error) throw new Error(error.message);

  return { grantId: input.grantId };
});
