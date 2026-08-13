import { createClient } from '@/lib/supabase/server';
import { TaskRepository } from '../repository/task-repository';

/**
 * Submit a task (in_progress → submitted). RLS restricts the update to the assignee;
 * approved/rejected/needs_revision are trigger-driven and never direct-updated here.
 */
export async function submitTask(
  input: { taskId: string },
  ctx: { organizationId: string },
): Promise<{ taskId: string }> {
  const supabase = await createClient();
  const repo = new TaskRepository(supabase);
  await repo.markSubmitted(input.taskId, ctx.organizationId);
  return { taskId: input.taskId };
}
