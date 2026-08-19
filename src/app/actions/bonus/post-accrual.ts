'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { PostAccrualSchema } from '@/lib/validation/schemas/bonus';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { commandFrom, COMMAND_OPERATIONS } from '@/lib/commands/command-meta';
import { logInfo } from '@/lib/logger';
import { postAccrual as postAccrualModule, BonusLedgerRepository } from '@/modules/bonus-ledger';

/**
 * Thin server-action wrapper (ENGINEERING-02D). Enforces calculation.approve, then delegates to the
 * bonus-ledger module. ENGINEERING-15: accrual is idempotent per (snapshot, employee, account) via
 * bonus_ledger's unique index (0014) — a retry is absorbed by that constraint, so commandId is
 * minted for correlation/telemetry only (no command_log row needed).
 */
export const postAccrual = validatedAction(PostAccrualSchema, async (input) => {
  await requirePermission('calculation.approve');
  const org = await getActiveOrg();
  const user = await getUser();

  const { commandId, correlationId } = commandFrom(input.commandId);
  logInfo('command', {
    action: 'postAccrual',
    operationType: COMMAND_OPERATIONS.postAccrual,
    commandId,
    correlationId,
  });

  const repo = new BonusLedgerRepository(createAdminClient());
  return postAccrualModule(
    { periodId: input.periodId },
    { organizationId: org!.organization_id, userId: user!.id },
    repo,
  );
});
