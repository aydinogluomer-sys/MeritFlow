'use server';
import 'server-only';

import { z } from 'zod';
import { validatedAction } from '@/lib/validation/action';
import { requirePermission } from '@/lib/auth/rbac';
import { createAdminClient } from '@/lib/supabase/admin';
import { drainOutbox, OutboxRepository, DEFAULT_OUTBOX_HANDLERS } from '@/modules/outbox';

const DrainOutboxSchema = z.object({ limit: z.number().int().min(1).max(100).optional() });

/**
 * Thin server-action wrapper (ENGINEERING-09). Drains a batch of the outbox. Guarded by
 * period.manage; intended to be invoked by a scheduled job (cron) once real handlers are
 * registered in DEFAULT_OUTBOX_HANDLERS. The claim RPC is SECURITY DEFINER and the outbox is
 * RLS server-only, so the admin client is created HERE and injected. System-wide drain (not
 * org-scoped) — see docs/runbooks/outbox.md for the production worker model.
 */
export const drainOutboxAction = validatedAction(DrainOutboxSchema, async (input) => {
  await requirePermission('period.manage');
  const repo = new OutboxRepository(createAdminClient());
  return drainOutbox({ limit: input.limit }, repo, DEFAULT_OUTBOX_HANDLERS);
});
