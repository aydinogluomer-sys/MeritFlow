'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { ExportPayoutSchema } from '@/lib/validation/schemas/payroll';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { toDomainError } from '@/lib/errors';
import { commandFrom, COMMAND_OPERATIONS } from '@/lib/commands/command-meta';
import { logInfo } from '@/lib/logger';
import { exportPayout as exportPayoutModule, ExportsRepository } from '@/modules/exports';

/**
 * Thin server-action wrapper (ENGINEERING-02F). Enforces payout.export, then delegates to the
 * exports module. ENGINEERING-15: exports has no business-key uniqueness — a retry could create a
 * second export record. We claim the stable commandId in command_log FIRST; a duplicate returns
 * idempotent success.
 */
export const exportPayout = validatedAction(ExportPayoutSchema, async (input) => {
  await requirePermission('payout.export');
  const org = await getActiveOrg();
  const user = await getUser();

  const { commandId, correlationId } = commandFrom(input.commandId);
  const admin = createAdminClient();
  const { data: firstRun, error: claimError } = await admin.rpc('claim_command', {
    p_organization_id: org!.organization_id,
    p_operation_type: COMMAND_OPERATIONS.exportPayout,
    p_command_id: commandId,
    p_actor_id: user!.id,
  });
  if (claimError) throw toDomainError(claimError);
  logInfo('command', {
    action: 'exportPayout',
    operationType: COMMAND_OPERATIONS.exportPayout,
    commandId,
    correlationId,
    firstRun,
  });
  if (firstRun === false) return { alreadyProcessed: true as const };

  const repo = new ExportsRepository(admin);
  return exportPayoutModule(
    { periodId: input.periodId, snapshotId: input.snapshotId, format: input.format },
    { organizationId: org!.organization_id, userId: user!.id },
    repo,
  );
});
