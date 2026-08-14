'use server';
import { toDomainError } from '@/lib/errors';
import 'server-only';

import { z } from 'zod';
import { validatedAction } from '@/lib/validation/action';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

/**
 * Onboarding-A: create the caller's first (or another) organization.
 * Decision (a): multi-org allowed, NO double-join guard. The heavy lifting is the
 * SECURITY DEFINER RPC create_organization (migration 0033) which atomically creates
 * the org + owner membership + profile + audit row and bypasses RLS (a brand-new user
 * has no membership yet, so RLS alone cannot bootstrap them). We call it via the normal
 * user client (NOT admin) — it is granted to `authenticated` and reads auth.uid().
 *
 * AUTHZ (AD1): server-side authz here is `requireUser()`, NOT `requirePermission(...)`.
 * This is the pre-org bootstrap: the caller has no membership yet, so there is no
 * `primary_role`/`role_permissions` to resolve a permission against — requirePermission()
 * would resolve against an empty permission set and always deny. The authorization
 * invariant is instead: authenticated identity (verified server-side via auth.getUser())
 * + the DB function's `authenticated`-only EXECUTE grant + its `auth.uid() is null` guard.
 */
const CreateOrganizationSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/),
  displayName: z.string().min(1).max(100),
});

export const createOrganization = validatedAction(
  CreateOrganizationSchema,
  async (input) => {
    // Server-side authz for the pre-org bootstrap: identity must be verified (AD1).
    await requireUser();

    const supabase = await createClient();
    const { data, error } = await supabase.rpc('create_organization', {
      p_name: input.name,
      p_slug: input.slug,
      p_display_name: input.displayName,
    });

    if (error) {
      // Postgres unique_violation on organizations_slug_key -> friendly domain error.
      if (error.code === '23505') throw new Error('slug_taken');
      throw toDomainError(error);
    }

    return { organizationId: data as string };
  },
);
