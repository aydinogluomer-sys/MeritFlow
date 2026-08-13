'use server';
import 'server-only';

import { z } from 'zod';
import { validatedAction } from '@/lib/validation/action';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { inviteMember as inviteMemberModule } from '@/modules/admin';

/**
 * Thin server-action wrapper (ENGINEERING-02F). Onboarding-B: mint a pending member invitation.
 * Enforces user.invite; the 'owner' role is excluded at the schema boundary AND in the DB RPC
 * (defense in depth). getActiveOrg() guards that an active org exists. Behavior unchanged.
 */
export const inviteMember = validatedAction(
  z.object({
    email: z.string().email(),
    role: z.enum(['employee', 'manager', 'hr', 'finance', 'auditor']),
  }),
  async (input) => {
    await requirePermission('user.invite');
    await getActiveOrg();
    return inviteMemberModule(input);
  },
);
