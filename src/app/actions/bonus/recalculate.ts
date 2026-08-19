'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { RecalculateSchema } from '@/lib/validation/schemas/bonus';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { toDomainError } from '@/lib/errors';
import { commandFrom, COMMAND_OPERATIONS } from '@/lib/commands/command-meta';
import { logInfo } from '@/lib/logger';
import { recalculate as recalculateModule, BonusCalculationRepository } from '@/modules/bonus-calculation';

/**
 * Thin server-action wrapper (ENGINEERING-02D). Enforces period.manage, then delegates to the
 * bonus-calculation module. ENGINEERING-15: recalculate_bonus_after_dispute (0026) takes NO
 * idempotency-key parameter, so a retry would start a second recalculation run. We claim the
 * stable commandId in command_log FIRST; a duplicate returns idempotent success without re-running.
 */
export const recalculate = validatedAction(RecalculateSchema, async (input) => {
  await requirePermission('period.manage');
  const org = await getActiveOrg();
  const user = await getUser();

  const { commandId, correlationId } = commandFrom(input.commandId);
  const admin = createAdminClient();
  const { data: firstRun, error: claimError } = await admin.rpc('claim_command', {
    p_organization_id: org!.organization_id,
    p_operation_type: COMMAND_OPERATIONS.recalculate,
    p_command_id: commandId,
    p_actor_id: user!.id,
  });
  if (claimError) throw toDomainError(claimError);
  logInfo('command', {
    action: 'recalculate',
    operationType: COMMAND_OPERATIONS.recalculate,
    commandId,
    correlationId,
    firstRun,
  });
  if (firstRun === false) return { alreadyProcessed: true as const };

  const repo = new BonusCalculationRepository(admin);
  return recalculateModule(
    { periodId: input.periodId },
    { organizationId: org!.organization_id, userId: user!.id },
    repo,
  );
});
