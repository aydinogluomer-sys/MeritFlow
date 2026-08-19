'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { MarkPaidSchema } from '@/lib/validation/schemas/payroll';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { commandFrom, COMMAND_OPERATIONS } from '@/lib/commands/command-meta';
import { logInfo } from '@/lib/logger';
import { markPaid as markPaidModule, ExportsRepository } from '@/modules/exports';

/**
 * Thin server-action wrapper (ENGINEERING-02F). Enforces payout.mark_paid, then delegates to the
 * exports module. ENGINEERING-15: mark-paid is a status transition (exported→paid) — idempotent by
 * the status machine (a second call finds no exported row to transition), so commandId is minted
 * for correlation/telemetry only.
 */
export const markPaid = validatedAction(MarkPaidSchema, async (input) => {
  await requirePermission('payout.mark_paid');
  const org = await getActiveOrg();
  const user = await getUser();

  const { commandId, correlationId } = commandFrom(input.commandId);
  logInfo('command', {
    action: 'markPaid',
    operationType: COMMAND_OPERATIONS.markPaid,
    commandId,
    correlationId,
  });

  const repo = new ExportsRepository(createAdminClient());
  return markPaidModule(
    { periodId: input.periodId, exportId: input.exportId },
    { organizationId: org!.organization_id, userId: user!.id },
    repo,
  );
});
