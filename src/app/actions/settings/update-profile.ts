'use server';
import 'server-only';

import { z } from 'zod';
import { validatedAction } from '@/lib/validation/action';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

/**
 * Settings — update the caller's own display name.
 *
 * AUTHZ (AD1): server-side authz here is requireUser(), NOT requirePermission(...).
 * This is the self-service identity path: any authenticated member may edit their own
 * profile. There is no 'profile.edit' in the permission catalog — requirePermission()
 * would wrongly deny members who have no such permission (and shouldn't need one).
 * Identity is verified server-side via requireUser() (AD1). The DB UPDATE is implicitly
 * self-scoped because createClient() preserves the user JWT → auth.uid() resolves →
 * RLS profiles_update_own policy (UPDATE ... USING id = auth.uid()) enforces ownership.
 */
const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(100),
});

export const updateProfile = validatedAction(
  UpdateProfileSchema,
  async (input) => {
    // Server-side authz for the self-service identity path: identity must be verified (AD1).
    const user = await requireUser();

    const supabase = await createClient();
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: input.displayName })
      .eq('id', user.id);

    if (error) throw new Error(error.message);

    return { ok: true };
  },
);
