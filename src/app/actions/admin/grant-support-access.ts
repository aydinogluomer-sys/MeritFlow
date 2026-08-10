'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { GrantSupportAccessSchema } from '@/lib/validation/schemas/support';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

/**
 * Grant time-bounded, scoped support access (D4). RLS enforces support.grant on
 * INSERT; the 0005 trigger (trg_audit_support_access_grants → log_audit) audits the
 * insert automatically, so no explicit log_audit() call here. `.select('id').single()`
 * is required to return the new grant id (a bare insert returns data: null).
 */
export const grantSupportAccess = validatedAction(GrantSupportAccessSchema, async (input) => {
  await requirePermission('support.grant');
  const org = await getActiveOrg();
  const user = await getUser();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('support_access_grants')
    .insert({
      organization_id: org!.organization_id,
      grantee_id: input.granteeId,
      scope: input.scope,
      reason: input.reason,
      granted_by: user!.id,
      expires_at: input.expiresAt,
      status: 'active',
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);

  return { grantId: (data as { id: string }).id };
});
