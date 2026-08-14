'use server';
import 'server-only';

import { z } from 'zod';
import { validatedAction } from '@/lib/validation/action';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { runReconciliation, ReconciliationRepository } from '@/modules/reconciliation';

const RunReconciliationSchema = z.object({});

/**
 * Thin server-action wrapper (ENGINEERING-05). Enforces period.manage, then runs the read-only
 * reconciliation verifier. The admin client (RLS-restricted finance tables) is created HERE and
 * injected. No mutation, no RPC — findings are logged/captured inside the module.
 */
export const runReconciliationAction = validatedAction(RunReconciliationSchema, async () => {
  await requirePermission('period.manage');
  const org = await getActiveOrg();
  const user = await getUser();

  const repo = new ReconciliationRepository(createAdminClient());
  return runReconciliation({ organizationId: org!.organization_id, userId: user!.id }, repo);
});
