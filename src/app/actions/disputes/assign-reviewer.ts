'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { AssignReviewerSchema } from '@/lib/validation/schemas/disputes';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';

/**
 * Assign a reviewer and move a dispute open → under_review.
 * D9 (reviewer ≠ complainant / decision_owner) is enforced by the DB.
 */
export const assignReviewer = validatedAction(AssignReviewerSchema, async (input) => {
  await requirePermission('dispute.resolve');
  const org = await getActiveOrg();

  const supabase = await createClient();
  const { error } = await supabase
    .from('disputes')
    .update({
      status: 'under_review',
      assigned_reviewer_id: input.reviewerId,
    })
    .eq('id', input.disputeId)
    .eq('organization_id', org!.organization_id);

  if (error) throw new Error(error.message);

  return { disputeId: input.disputeId };
});
