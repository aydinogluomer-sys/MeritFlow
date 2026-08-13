'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { CreateTaskSchema } from '@/lib/validation/schemas/tasks';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createTask as createTaskModule } from '@/modules/tasks';

/**
 * Thin server-action wrapper (ENGINEERING-02B). Enforces authz (AD1) — task.create, plus
 * task.assign when an assignee is given — then delegates orchestration to the tasks domain
 * module. Behavior (return/error shape, RLS enforcement) is unchanged from before the refactor.
 */
export const createTask = validatedAction(CreateTaskSchema, async (input) => {
  await requirePermission('task.create');
  if (input.assignedTo) {
    await requirePermission('task.assign');
  }

  const org = await getActiveOrg();
  const user = await getUser();

  return createTaskModule(input, {
    organizationId: org!.organization_id,
    userId: user!.id,
  });
});
