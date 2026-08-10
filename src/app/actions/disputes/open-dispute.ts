'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { OpenDisputeSchema } from '@/lib/validation/schemas/disputes';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

/**
 * Open a dispute against a task. status defaults to 'open' in the DB.
 * There is NO `description` column — target is the task.
 */
export const openDispute = validatedAction(OpenDisputeSchema, async (input) => {
  await requirePermission('dispute.open');
  const org = await getActiveOrg();
  const user = await getUser();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('disputes')
    .insert({
      organization_id: org!.organization_id,
      complainant_id: user!.id,
      dispute_type: input.disputeType,
      target_type: 'task',
      target_id: input.taskId,
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);

  return (data as { id: string }).id;
});
