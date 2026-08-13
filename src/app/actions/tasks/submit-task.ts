'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { SubmitTaskSchema } from '@/lib/validation/schemas/tasks';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { submitTask as submitTaskModule } from '@/modules/tasks';

/**
 * Thin server-action wrapper (ENGINEERING-02B). Enforces task.submit, then delegates the
 * in_progress → submitted transition to the tasks domain module. Behavior unchanged.
 */
export const submitTask = validatedAction(SubmitTaskSchema, async (input) => {
  await requirePermission('task.submit');
  const org = await getActiveOrg();

  return submitTaskModule(input, { organizationId: org!.organization_id });
});
