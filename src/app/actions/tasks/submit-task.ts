'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { SubmitTaskSchema } from '@/lib/validation/schemas/tasks';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';

/**
 * Submit a task (in_progress → submitted). RLS restricts the update to the assignee.
 * approved/rejected/needs_revision are trigger-driven and are NOT direct-updated here.
 */
export const submitTask = validatedAction(SubmitTaskSchema, async (input) => {
  await requirePermission('task.submit');
  const org = await getActiveOrg();

  const supabase = await createClient();
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'submitted' })
    .eq('id', input.taskId)
    .eq('status', 'in_progress')
    .eq('organization_id', org!.organization_id);

  if (error) throw new Error(error.message);

  return { taskId: input.taskId };
});
