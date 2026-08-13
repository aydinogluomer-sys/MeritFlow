import type { ScoringBreakdown } from '../domain/types';

// RLS user client only (never admin) — reads are tenant-scoped by RLS. Client type is taken
// from createClient via a type-only import so it always matches `await createClient()`.
type ServerClient = Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>;

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v);
}

export class ScoringRepository {
  constructor(private readonly supabase: ServerClient) {}

  /**
   * Explainability breakdown for a task's `task_approved` earning row, or null if the task has
   * not scored yet. finalPoints comes from `points_delta` (the source of truth — 0020 D); the
   * multipliers/base come from the metadata the scoring trigger (0020) persisted. The formula
   * is never recomputed here (constraint A). Metadata keys mirror 0020's jsonb_build_object:
   * base_points / complexity_multiplier / impact_multiplier / quality_multiplier /
   * timeliness_multiplier / revision_penalty_rate.
   */
  async breakdownForTask(
    taskId: string,
    organizationId: string,
  ): Promise<ScoringBreakdown | null> {
    const { data, error } = await this.supabase
      .from('point_ledger')
      .select('employee_id, points_delta, scoring_policy_version_id, metadata')
      .eq('task_id', taskId)
      .eq('event_type', 'task_approved')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;

    const row = data as {
      employee_id: string;
      points_delta: number | string;
      scoring_policy_version_id: string;
      metadata: Record<string, unknown> | null;
    };
    const md = row.metadata ?? {};

    return {
      taskId,
      employeeId: row.employee_id,
      finalPoints: num(row.points_delta),
      complexityMultiplier: num(md.complexity_multiplier),
      impactMultiplier: num(md.impact_multiplier),
      qualityMultiplier: num(md.quality_multiplier),
      timelinessFactor: num(md.timeliness_multiplier),
      revisionPenaltyRate: num(md.revision_penalty_rate),
      basePts: num(md.base_points),
      policyVersionId: row.scoring_policy_version_id,
      metadata: md,
    };
  }
}
