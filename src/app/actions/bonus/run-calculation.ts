'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { RunCalculationSchema } from '@/lib/validation/schemas/bonus';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { rateLimiter, RateLimitExceededError } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { commandFrom, COMMAND_OPERATIONS } from '@/lib/commands/command-meta';
import { logInfo } from '@/lib/logger';
import { runCalculation as runCalculationModule, BonusCalculationRepository } from '@/modules/bonus-calculation';

/**
 * Thin server-action wrapper (ENGINEERING-02D). Enforces period.manage, then delegates to the
 * bonus-calculation module. ENGINEERING-15: the STABLE commandId is the idempotency key —
 * bonus_calculation_runs has unique(org, idempotency_key), so a retry that resends the same
 * commandId returns the first run's result instead of creating a second run. (Was
 * `ui-calc-${periodId}-${Date.now()}`, which minted a fresh key on every request → a retry
 * created a duplicate calculation run.)
 */
export const runCalculation = validatedAction(RunCalculationSchema, async (input) => {
  await requirePermission('period.manage');
  const org = await getActiveOrg();
  const user = await getUser();

  // ENGINEERING-19 (8.4): sensitive-mutation rate limit (per org, 60s window).
  if (!(await rateLimiter.check('run_calculation', org!.organization_id, 5, 60))) {
    throw new RateLimitExceededError('run_calculation');
  }

  const { commandId, correlationId } = commandFrom(input.commandId);
  logInfo('command', {
    action: 'runCalculation',
    operationType: COMMAND_OPERATIONS.runCalculation,
    commandId,
    correlationId,
  });

  const repo = new BonusCalculationRepository(createAdminClient());
  return runCalculationModule(
    { periodId: input.periodId, poolId: input.poolId, idempotencyKey: commandId },
    { organizationId: org!.organization_id, userId: user!.id },
    repo,
  );
});
