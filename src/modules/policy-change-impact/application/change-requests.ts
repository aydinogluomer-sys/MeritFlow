import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  PolicyChangeRequestRepository,
  type PolicyChangeRequest,
} from '../repository/policy-change-request-repository';
import {
  DecisionInputSchema,
  NewChangeRequestInputSchema,
  type NewChangeRequestInput,
} from '../schemas/change-request';
import { assertPolicyChangeImpactEnabled, type PolicyChangeImpactContext } from './feature-gate';

// Governance actions (Module 6 / slice 6-A). Every action is feature-flag gated; DB RLS + the
// validate_policy_change_request() trigger enforce tenant, role, and state-machine integrity. NONE
// of these mutate a scoring_policy_version or any ledger.

async function repoFor(organizationId: string) {
  const supabase = await createClient();
  await assertPolicyChangeImpactEnabled(supabase, organizationId);
  return new PolicyChangeRequestRepository(supabase);
}

export async function createPolicyChangeRequest(
  input: NewChangeRequestInput,
  ctx: PolicyChangeImpactContext,
): Promise<PolicyChangeRequest> {
  const parsed = NewChangeRequestInputSchema.parse(input);
  const repo = await repoFor(ctx.organizationId);
  return repo.create({
    organizationId: ctx.organizationId,
    requestedBy: ctx.userId,
    scoringPolicyId: parsed.scoringPolicyId,
    fromVersionId: parsed.fromVersionId,
    toDraftVersionId: parsed.toDraftVersionId,
    reason: parsed.reason,
    effectiveDate: parsed.effectiveDate ?? null,
    allowRetroactive: parsed.allowRetroactive,
  });
}

export async function submitPolicyChangeRequest(
  id: string,
  ctx: PolicyChangeImpactContext,
): Promise<PolicyChangeRequest> {
  const repo = await repoFor(ctx.organizationId);
  return repo.submit(id, ctx.organizationId);
}

/** HR approval slot (dual approval, §8.7). The trigger enforces role=hr + self-stamp. */
export async function approvePolicyChangeRequestAsHr(
  id: string,
  ctx: PolicyChangeImpactContext,
): Promise<PolicyChangeRequest> {
  const repo = await repoFor(ctx.organizationId);
  return repo.recordHrApproval(id, ctx.organizationId, ctx.userId);
}

/** Finance approval slot (dual approval, §8.7). Completing both auto-promotes the request to approved. */
export async function approvePolicyChangeRequestAsFinance(
  id: string,
  ctx: PolicyChangeImpactContext,
): Promise<PolicyChangeRequest> {
  const repo = await repoFor(ctx.organizationId);
  return repo.recordFinanceApproval(id, ctx.organizationId, ctx.userId);
}

export async function rejectPolicyChangeRequest(
  id: string,
  note: string,
  ctx: PolicyChangeImpactContext,
): Promise<PolicyChangeRequest> {
  const { note: cleanNote } = DecisionInputSchema.parse({ note });
  const repo = await repoFor(ctx.organizationId);
  return repo.reject(id, ctx.organizationId, cleanNote);
}

export async function requestChangesOnPolicyChangeRequest(
  id: string,
  note: string,
  ctx: PolicyChangeImpactContext,
): Promise<PolicyChangeRequest> {
  const { note: cleanNote } = DecisionInputSchema.parse({ note });
  const repo = await repoFor(ctx.organizationId);
  return repo.requestChanges(id, ctx.organizationId, cleanNote);
}
