'use server';
import 'server-only';

import { z } from 'zod';
import { validatedAction } from '@/lib/validation/action';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';

/**
 * Onboarding-B: mint a pending member invitation (no email in MVP — the returned token
 * builds a /join?token=<uuid> link the admin shares out-of-band). The SECURITY DEFINER
 * RPC create_invitation (migration 0034) validates user.invite + role<>'owner' + active
 * org and writes the audit row; RLS also enforces user.invite on any read of the row.
 *
 * AUTHZ (AD1): server-side authz is requirePermission('user.invite') — the caller is an
 * existing org admin (has a membership/role), so the permission resolves normally. The
 * 'owner' role is excluded at the schema boundary AND in the DB (defense in depth).
 */
export const inviteMember = validatedAction(
  z.object({
    email: z.string().email(),
    role: z.enum(['employee', 'manager', 'hr', 'finance', 'auditor']),
  }),
  async (input) => {
    await requirePermission('user.invite');
    await getActiveOrg();

    const supabase = await createClient();
    const { data, error } = await supabase.rpc('create_invitation', {
      p_email: input.email,
      p_role: input.role,
    });

    if (error) throw new Error(error.message);

    return { token: data as string };
  },
);
