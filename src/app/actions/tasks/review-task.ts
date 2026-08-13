'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { ReviewTaskSchema } from '@/lib/validation/schemas/tasks';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { reviewTask as reviewTaskModule } from '@/modules/reviews';

/**
 * Thin server-action wrapper (ENGINEERING-02B). The D3 guard (approve + quality=poor) is kept
 * here, BEFORE authz, to preserve the exact pre-refactor error ordering; the DB trigger is the
 * hard enforcement. After authz it delegates the task_reviews insert to the reviews module.
 */
export const reviewTask = validatedAction(ReviewTaskSchema, async (input) => {
  // D3: quality=poor cannot be approved.
  if (input.decision === 'approve' && input.quality === 'poor') {
    throw new Error('APPROVE_POOR_FORBIDDEN');
  }

  await requirePermission('task.review');
  const org = await getActiveOrg();
  const user = await getUser();

  return reviewTaskModule(input, {
    organizationId: org!.organization_id,
    reviewerId: user!.id,
  });
});
