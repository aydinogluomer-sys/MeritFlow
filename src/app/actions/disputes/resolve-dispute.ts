'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { ResolveDisputeSchema } from '@/lib/validation/schemas/disputes';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { rateLimiter, RateLimitExceededError } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { commandFrom, COMMAND_OPERATIONS } from '@/lib/commands/command-meta';
import { logInfo } from '@/lib/logger';
import { resolveDispute as resolveDisputeModule, DisputeAdjustmentRepository } from '@/modules/disputes';

/**
 * Thin server-action wrapper (ENGINEERING-02E). Enforces dispute.resolve, then delegates to the
 * disputes module. A SINGLE admin client (for the two SECURITY DEFINER RPCs) is created HERE and
 * injected. ENGINEERING-15: resolving a dispute is a status transition (open→resolved), idempotent
 * by the dispute status machine (a resolved dispute cannot be re-resolved), so commandId is minted
 * for correlation/telemetry only.
 */
export const resolveDispute = validatedAction(ResolveDisputeSchema, async (input) => {
  await requirePermission('dispute.resolve');
  const org = await getActiveOrg();
  const user = await getUser();

  // ENGINEERING-19 (8.4): sensitive-mutation rate limit (per org, 60s window).
  if (!(await rateLimiter.check('resolve_dispute', org!.organization_id, 10, 60))) {
    throw new RateLimitExceededError('resolve_dispute');
  }

  const { commandId, correlationId } = commandFrom(input.commandId);
  logInfo('command', {
    action: 'resolveDispute',
    operationType: COMMAND_OPERATIONS.resolveDispute,
    commandId,
    correlationId,
  });

  const adjRepo = new DisputeAdjustmentRepository(createAdminClient());
  return resolveDisputeModule(
    input,
    { organizationId: org!.organization_id, userId: user!.id },
    adjRepo,
  );
});
