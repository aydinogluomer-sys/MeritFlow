import { createClient } from '@/lib/supabase/server';
import { DisputeRepository } from '../repository/dispute-repository';
import type { DisputeAdjustmentRepository } from '../repository/dispute-adjustment-repository';
import type { DisputeContext, ResolveDisputeInput } from '../domain/types';

/**
 * Resolve a dispute (under_review → resolved). When accepted with a points delta, apply the
 * point adjustment (SECURITY DEFINER RPC) and, if tied to a bonus period, recalculate it.
 * The admin-backed adjRepo is injected by the action so both RPCs run on one admin instance.
 * Order preserved: markResolved → applyPointAdjustment → recalculateAfterDispute (each throws
 * on error before the next step).
 */
export async function resolveDispute(
  input: ResolveDisputeInput,
  ctx: DisputeContext,
  adjRepo: DisputeAdjustmentRepository,
): Promise<{ disputeId: string }> {
  const supabase = await createClient();
  const repo = new DisputeRepository(supabase);

  await repo.markResolved(input, ctx);

  if (input.resolution === 'accepted' && input.pointsDelta) {
    await adjRepo.applyPointAdjustment(input, ctx);
    if (input.bonusPeriodId) {
      await adjRepo.recalculateAfterDispute(input, ctx);
    }
  }

  return { disputeId: input.disputeId };
}
