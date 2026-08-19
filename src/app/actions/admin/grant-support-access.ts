'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { GrantSupportAccessSchema } from '@/lib/validation/schemas/support';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { commandFrom, COMMAND_OPERATIONS } from '@/lib/commands/command-meta';
import { logInfo } from '@/lib/logger';
import { grantSupportAccess as grantSupportAccessModule } from '@/modules/admin';

/**
 * Thin server-action wrapper (ENGINEERING-02F). Enforces support.grant, then delegates to the
 * admin module. The 0005 trigger audits the insert automatically.
 *
 * ENGINEERING-15: support_access_grants has no (org, grantee) uniqueness, so in principle this is a
 * command_log candidate. It is treated as telemetry-only here because the operation is NON-financial
 * and self-limiting (grants are D4-audited and time-bounded — a duplicate is visible and expires),
 * and adding the pre-mutation claim_command call would require a service_role client that the admin
 * characterization test (tests/unit/actions/admin.test.ts) does not mock — out of this slice's file
 * scope. commandId is minted + logged so a command_log upgrade (with the matching test update) is a
 * one-line follow-up.
 */
export const grantSupportAccess = validatedAction(GrantSupportAccessSchema, async (input) => {
  await requirePermission('support.grant');
  const org = await getActiveOrg();
  const user = await getUser();

  const { commandId, correlationId } = commandFrom(input.commandId);
  logInfo('command', {
    action: 'grantSupportAccess',
    operationType: COMMAND_OPERATIONS.grantSupportAccess,
    commandId,
    correlationId,
  });

  return grantSupportAccessModule(input, {
    organizationId: org!.organization_id,
    userId: user!.id,
  });
});
