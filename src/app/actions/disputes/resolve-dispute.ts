'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { ResolveDisputeSchema } from '@/lib/validation/schemas/disputes';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Resolve a dispute (under_review → resolved). When accepted with a points delta,
 * apply the point adjustment (SECURITY DEFINER RPC) and, if tied to a bonus period,
 * recalculate that period.
 */
export const resolveDispute = validatedAction(ResolveDisputeSchema, async (input) => {
  await requirePermission('dispute.resolve');
  const org = await getActiveOrg();
  const user = await getUser();

  const supabase = await createClient();
  const { error } = await supabase
    .from('disputes')
    .update({
      status: 'resolved',
      resolution: input.resolution,
      decision_note: input.decisionNote,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', input.disputeId)
    .eq('organization_id', org!.organization_id)
    .eq('status', 'under_review');

  if (error) throw new Error(error.message);

  if (input.resolution === 'accepted' && input.pointsDelta) {
    const admin = createAdminClient();
    const { error: adjError } = await admin.rpc('apply_dispute_point_adjustment', {
      p_dispute_id: input.disputeId,
      p_points_delta: input.pointsDelta,
      p_reason: input.decisionNote,
      p_actor: user!.id,
      p_bonus_period_id: input.bonusPeriodId ?? null,
    });

    if (adjError) throw new Error(adjError.message);

    if (input.bonusPeriodId) {
      const { error: recalcError } = await admin.rpc('recalculate_bonus_after_dispute', {
        p_organization_id: org!.organization_id,
        p_bonus_period_id: input.bonusPeriodId,
        p_triggered_by: user!.id,
      });

      if (recalcError) throw new Error(recalcError.message);
    }
  }

  return { disputeId: input.disputeId };
});
