'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { RevokeSupportAccessSchema } from '@/lib/validation/schemas/support';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { commandFrom, COMMAND_OPERATIONS } from '@/lib/commands/command-meta';
import { logInfo } from '@/lib/logger';
import { revokeSupportAccess as revokeSupportAccessModule } from '@/modules/admin';

/**
 * Thin server-action wrapper (ENGINEERING-02F). Enforces support.grant, then delegates to the
 * admin module. The 0005 trigger audits the update automatically. ENGINEERING-15: revoke is a
 * status transition (active→revoked), idempotent by the grant status machine (the update targets
 * status='active' only), so commandId is minted for correlation/telemetry only.
 */
export const revokeSupportAccess = validatedAction(RevokeSupportAccessSchema, async (input) => {
  await requirePermission('support.grant');
  const org = await getActiveOrg();

  const { commandId, correlationId } = commandFrom(input.commandId);
  logInfo('command', {
    action: 'revokeSupportAccess',
    operationType: COMMAND_OPERATIONS.revokeSupportAccess,
    commandId,
    correlationId,
  });

  return revokeSupportAccessModule(input, { organizationId: org!.organization_id });
});
