'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { AssignReviewerSchema } from '@/lib/validation/schemas/disputes';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { assignReviewer as assignReviewerModule } from '@/modules/disputes';

/**
 * Thin server-action wrapper (ENGINEERING-02E). Enforces dispute.resolve, then delegates to the
 * disputes module. No getUser here — the original action did not use it. Behavior unchanged.
 */
export const assignReviewer = validatedAction(AssignReviewerSchema, async (input) => {
  await requirePermission('dispute.resolve');
  const org = await getActiveOrg();
  return assignReviewerModule(input, { organizationId: org!.organization_id });
});
