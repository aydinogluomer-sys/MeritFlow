'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createAdminClient } from '@/lib/supabase/admin';
import { runInsightEngine } from '@/modules/intelligence';
import { RunInsightEngineSchema } from '@/lib/validation/schemas/insight-engine';

/**
 * On-demand run of the deterministic insight engine (Module 8-C3). Enforces intelligence.manage
 * server-side (AD1 — client-side authz is never the source of truth), then delegates to the intelligence
 * module. The service_role admin client is created HERE and injected (SI-11 — never imported in a
 * module/client component): the engine needs ORG-WIDE detection reads + server-only insight writes; the
 * emitted insights remain RLS-gated on READ. Idempotent: a re-run touches existing non-terminal insights
 * (no duplicate). NO raw SQL/LLM (§26) — metrics are read via executeSemanticQuery inside the engine.
 */
export const runInsightEngineAction = validatedAction(RunInsightEngineSchema, async (input) => {
  await requirePermission('intelligence.manage');
  const org = await getActiveOrg();
  return runInsightEngine(
    { organizationId: org!.organization_id, bonusPeriodId: input.bonusPeriodId ?? null },
    createAdminClient(),
  );
});
