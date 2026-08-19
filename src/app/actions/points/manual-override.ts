'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { ManualOverrideSchema } from '@/lib/validation/schemas/points';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { toDomainError } from '@/lib/errors';
import { commandFrom, COMMAND_OPERATIONS } from '@/lib/commands/command-meta';
import { logInfo } from '@/lib/logger';
import { manualOverride as manualOverrideModule, PointLedgerRepository } from '@/modules/point-ledger';

/**
 * Thin server-action wrapper (ENGINEERING-02C). Enforces point.override, then delegates to the
 * point-ledger module. ENGINEERING-15: point_ledger is append-only (no natural DB dedup), so a
 * retry would insert a second manual_adjustment row. We claim the stable commandId in command_log
 * FIRST; a duplicate returns idempotent success. NOTE: the claim and the mutation are not one
 * transaction — if the mutation fails after a successful claim, a retry sees the claim and skips
 * (accepted claim-before-act tradeoff; see command-meta.ts catalog).
 */
export const manualOverride = validatedAction(ManualOverrideSchema, async (input) => {
  await requirePermission('point.override');
  const org = await getActiveOrg();
  const user = await getUser();

  const { commandId, correlationId } = commandFrom(input.commandId);
  const admin = createAdminClient();
  const { data: firstRun, error: claimError } = await admin.rpc('claim_command', {
    p_organization_id: org!.organization_id,
    p_operation_type: COMMAND_OPERATIONS.manualOverride,
    p_command_id: commandId,
    p_actor_id: user!.id,
  });
  if (claimError) throw toDomainError(claimError);
  logInfo('command', {
    action: 'manualOverride',
    operationType: COMMAND_OPERATIONS.manualOverride,
    commandId,
    correlationId,
    firstRun,
  });
  if (firstRun === false) return { alreadyProcessed: true as const };

  const repo = new PointLedgerRepository(admin);
  return manualOverrideModule(
    input,
    { organizationId: org!.organization_id, userId: user!.id },
    repo,
  );
});
