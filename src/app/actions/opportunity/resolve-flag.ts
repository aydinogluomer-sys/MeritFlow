'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';
import { IntelligenceRepository } from '@/modules/intelligence';
import { ResolveOpportunityFlagSchema } from '@/lib/validation/schemas/opportunity';

/**
 * Resolve an opportunity_flag insight (Module 2-B) via the §2.8 status lifecycle — a HUMAN REVIEW
 * outcome, NEVER a pay/policy change (§4.2/§26). Floor gate: intelligence.read (managers/HR/owner/
 * admin hold it — satisfies the server-side-authz invariant); the AUTHORITATIVE gate is the 0049
 * UPDATE RLS policy (intelligence.manage holder OR the manager of the subject's PRIMARY team — no
 * cross-team resolution). The write uses the RLS USER client (NOT admin) so auth.uid() is the resolver
 * and the 0049 after-update log_audit trigger records the actor (§2.7 audited resolution).
 * IntelligenceRepository.transition enforces the one-step §2.8 legality (assertTransition).
 */
export const resolveOpportunityFlagAction = validatedAction(ResolveOpportunityFlagSchema, async (input) => {
  await requirePermission('intelligence.read');
  const org = await getActiveOrg();
  const supabase = await createClient();
  const updated = await new IntelligenceRepository(supabase).transition(
    input.insightId,
    org!.organization_id,
    input.toStatus,
    input.resolutionCode,
  );
  return { id: updated.id, status: updated.status };
});
