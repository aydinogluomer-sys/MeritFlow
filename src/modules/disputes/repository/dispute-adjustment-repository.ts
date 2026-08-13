import type { DisputeContext, ResolveDisputeInput } from '../domain/types';

type AdminClient = Awaited<ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>>;

/**
 * SECURITY DEFINER RPC touchpoints for dispute resolution (ENGINEERING-02E). Both RPCs live
 * on ONE injected admin instance so a single `createAdminClient()` in the action drives both
 * calls (parity constraint: resolveDispute test counts both on the same rpc mock). Point-ledger
 * append-only and post-dispute recalculation invariants stay in the DB functions.
 */
export class DisputeAdjustmentRepository {
  constructor(private readonly admin: AdminClient) {}

  async applyPointAdjustment(input: ResolveDisputeInput, ctx: DisputeContext): Promise<void> {
    const { error } = await this.admin.rpc('apply_dispute_point_adjustment', {
      p_dispute_id: input.disputeId,
      p_points_delta: input.pointsDelta,
      p_reason: input.decisionNote,
      p_actor: ctx.userId,
      p_bonus_period_id: input.bonusPeriodId ?? null,
    });
    if (error) throw new Error(error.message);
  }

  async recalculateAfterDispute(input: ResolveDisputeInput, ctx: DisputeContext): Promise<void> {
    const { error } = await this.admin.rpc('recalculate_bonus_after_dispute', {
      p_organization_id: ctx.organizationId,
      p_bonus_period_id: input.bonusPeriodId,
      p_triggered_by: ctx.userId,
    });
    if (error) throw new Error(error.message);
  }
}
