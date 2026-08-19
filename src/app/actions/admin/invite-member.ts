'use server';
import 'server-only';

import { z } from 'zod';
import { validatedAction } from '@/lib/validation/action';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { commandFrom, COMMAND_OPERATIONS } from '@/lib/commands/command-meta';
import { logInfo } from '@/lib/logger';
import { inviteMember as inviteMemberModule } from '@/modules/admin';

/**
 * Thin server-action wrapper (ENGINEERING-02F). Onboarding-B: mint a pending member invitation.
 * Enforces user.invite; the 'owner' role is excluded at the schema boundary AND in the DB RPC
 * (defense in depth). getActiveOrg() guards that an active org exists.
 *
 * ENGINEERING-15: invite is NON-FINANCIAL and low-duplicate-harm (a repeat invite creates a second
 * pending token that simply expires). commandId is minted for correlation/telemetry; it is
 * intentionally NOT command_log-guarded here because that would change the action's return type
 * (adding { alreadyProcessed }) and break the invite-form UI consumer — out of this slice's file
 * scope. The commandId is plumbed so a command_log upgrade (with the matching UI narrowing) is a
 * one-line follow-up.
 */
export const inviteMember = validatedAction(
  z.object({
    email: z.string().email(),
    role: z.enum(['employee', 'manager', 'hr', 'finance', 'auditor']),
    commandId: z.string().uuid().optional(), // ENGINEERING-15
  }),
  async (input) => {
    await requirePermission('user.invite');
    await getActiveOrg();

    const { commandId, correlationId } = commandFrom(input.commandId);
    logInfo('command', {
      action: 'inviteMember',
      operationType: COMMAND_OPERATIONS.inviteMember,
      commandId,
      correlationId,
    });

    return inviteMemberModule({ email: input.email, role: input.role });
  },
);
