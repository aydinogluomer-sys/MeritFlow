import { createClient } from '@/lib/supabase/server';
import { TaskRepository } from '../repository/task-repository';
import { NO_PUBLISHED_SCORING_POLICY, type CreateTaskInput, type TaskContext } from '../domain/types';

/**
 * Create (and optionally assign) a task. Reads the org's PUBLISHED scoring policy version
 * (AD7 — required so approval can score) and inserts the task at status 'assigned'. Uses the
 * RLS user client only. Authz (task.create / task.assign) is enforced by the calling server
 * action + RLS; scoring itself is a DB trigger and is never re-implemented here.
 */
export async function createTask(
  input: CreateTaskInput,
  ctx: TaskContext,
): Promise<{ taskId: string }> {
  const supabase = await createClient();
  const repo = new TaskRepository(supabase);

  const versionId = await repo.publishedScoringPolicyVersionId(ctx.organizationId);
  if (!versionId) throw new Error(NO_PUBLISHED_SCORING_POLICY);

  const taskId = await repo.insert({
    organization_id: ctx.organizationId,
    team_id: input.teamId,
    title: input.title,
    status: 'assigned',
    created_by: ctx.userId,
    assigned_to: input.assignedTo ?? ctx.userId,
    complexity: input.complexity,
    impact: input.impact,
    base_points: input.basePoints,
    scoring_policy_version_id: versionId,
    due_date: input.dueDate ?? null,
  });

  return { taskId };
}
