import { toDomainError } from '@/lib/errors';
import { systemClock, type Clock } from '@/lib/time';
import type {
  AssignReviewerInput,
  DisputeContext,
  OpenDisputeInput,
  ResolveDisputeInput,
  ReviewerContext,
} from '../domain/types';

type ServerClient = Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>;

/**
 * RLS-scoped dispute table operations (ENGINEERING-02E). Always uses the user (server)
 * client — never admin. The dispute state machine (open → under_review → resolved) and
 * D9 (reviewer ≠ complainant/decision_owner) are enforced in the DB, not here.
 */
export class DisputeRepository {
  constructor(
    private readonly supabase: ServerClient,
    // ENGINEERING-24: injectable clock (default = real time) for the resolved_at timestamp.
    private readonly clock: Clock = systemClock,
  ) {}

  async open(input: OpenDisputeInput, ctx: DisputeContext): Promise<string> {
    const { data, error } = await this.supabase
      .from('disputes')
      .insert({
        organization_id: ctx.organizationId,
        complainant_id: ctx.userId,
        dispute_type: input.disputeType,
        target_type: 'task',
        target_id: input.taskId,
      })
      .select('id')
      .single();
    if (error) throw toDomainError(error);
    return (data as { id: string }).id;
  }

  async assignReviewer(input: AssignReviewerInput, ctx: ReviewerContext): Promise<void> {
    const { error } = await this.supabase
      .from('disputes')
      .update({ status: 'under_review', assigned_reviewer_id: input.reviewerId })
      .eq('id', input.disputeId)
      .eq('organization_id', ctx.organizationId);
    if (error) throw toDomainError(error);
  }

  async markResolved(input: ResolveDisputeInput, ctx: DisputeContext): Promise<void> {
    const { error } = await this.supabase
      .from('disputes')
      .update({
        status: 'resolved',
        resolution: input.resolution,
        decision_note: input.decisionNote,
        resolved_at: this.clock.now().toISOString(),
      })
      .eq('id', input.disputeId)
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'under_review');
    if (error) throw toDomainError(error);
  }
}
