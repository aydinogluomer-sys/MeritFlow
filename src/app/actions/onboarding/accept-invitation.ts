'use server';
import { toDomainError } from '@/lib/errors';
import 'server-only';

import { z } from 'zod';
import { validatedAction } from '@/lib/validation/action';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

/**
 * Onboarding-B: the invitee accepts a token and joins the org. The heavy lifting is the
 * SECURITY DEFINER RPC accept_invitation (migration 0034) which atomically validates the
 * token, creates/updates the profile, creates the membership, marks the invite accepted,
 * and writes an audit row (a brand-new user has no membership yet, so RLS alone cannot
 * bootstrap them). We call it via the normal user client (NOT admin) — it is granted to
 * `authenticated` and reads auth.uid().
 *
 * AUTHZ (AD1): server-side authz here is requireUser(), NOT requirePermission(...). This
 * is the pre-membership onboarding path: the invitee has no primary_role/role_permissions
 * to resolve a permission against — requirePermission() would resolve against an empty
 * permission set and always deny. The invariant is instead: authenticated identity
 * (verified server-side via auth.getUser()) + the RPC's `authenticated`-only EXECUTE grant
 * + its `auth.uid() is null` guard + its token validation.
 *
 * Does NOT call redirect() — returns the result; the client redirects (consistent with A).
 */
export const acceptInvitation = validatedAction(
  z.object({
    token: z.string().uuid(),
    displayName: z.string().min(1).max(100),
  }),
  async (input) => {
    // Server-side authz for the pre-membership onboarding path: identity must be verified (AD1).
    await requireUser();

    const supabase = await createClient();
    const { data, error } = await supabase.rpc('accept_invitation', {
      p_token: input.token,
      p_display_name: input.displayName,
    });

    if (error) {
      // 23514: token not found / expired -> friendly domain error.
      if (error.code === '23514') throw new Error('invitation_invalid');
      // 23505: memberships_org_profile_uq -> already a member of this org.
      if (error.code === '23505') throw new Error('already_member');
      throw toDomainError(error);
    }

    return { organizationId: data as string };
  },
);
