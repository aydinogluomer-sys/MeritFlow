'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { CreateTaskSchema } from '@/lib/validation/schemas/tasks';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

/**
 * Create a task (and optionally assign it). Inserts into `tasks` via the RLS user
 * client (createClient) — the tasks_insert policy enforces org + task.create + team
 * management server-side, so this is defense-in-depth over RLS (AD1).
 *
 * The task lifecycle starts at 'assigned' (0019 validate_task_transition allows INSERT
 * in draft|assigned; a task with an assignee begins 'assigned'). tasks.assigned_to is
 * NOT NULL, so an unassigned request defaults the assignee to the creator; supplying a
 * distinct assignedTo additionally requires task.assign. scoring_policy_version_id is
 * NOT NULL and must reference the org's PUBLISHED version (AD7) so approval can score.
 */
export const createTask = validatedAction(CreateTaskSchema, async (input) => {
  await requirePermission('task.create');
  if (input.assignedTo) {
    await requirePermission('task.assign');
  }

  const org = await getActiveOrg();
  const user = await getUser();
  const supabase = await createClient();

  // The active org's published scoring policy version (AD7). RLS-scoped read.
  const { data: version, error: versionError } = await supabase
    .from('scoring_policy_versions')
    .select('id')
    .eq('organization_id', org!.organization_id)
    .eq('status', 'published')
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (versionError) throw new Error(versionError.message);
  if (!version) throw new Error('NO_PUBLISHED_SCORING_POLICY');

  const assignedTo = input.assignedTo ?? user!.id;

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      organization_id: org!.organization_id,
      team_id: input.teamId,
      title: input.title,
      status: 'assigned',
      created_by: user!.id,
      assigned_to: assignedTo,
      complexity: input.complexity,
      impact: input.impact,
      base_points: input.basePoints,
      scoring_policy_version_id: (version as { id: string }).id,
      due_date: input.dueDate ?? null,
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);

  return { taskId: (data as { id: string }).id };
});
