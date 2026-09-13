import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import {
  IncentiveHealthRepository,
  type PolicyHealthRiskAcceptance,
} from '../repository/incentive-health-repository';
import { assertHealthEngineEnabled, type HealthContext } from './feature-gate';

// Phase P2 / slice 1-B — accept a specific health RISK driver of a policy version's evaluation (§3.8).
// A risk is NEVER silently dismissed: the only lifecycle is accept-with-reason (+ optional expiry),
// recorded as an APPEND-ONLY, AUDITED waiver (§2.7). Accepting a risk NEVER changes the computed health
// score and mutates NO policy / NO ledger (§26/AD7). The write is a USER action through the RLS client:
// the DB INSERT policy enforces policy.manage + accepted_by = auth.uid(); this fn additionally validates
// (against the referenced evaluation) that the waived (dimension, driver_code) is a REAL surfaced driver
// and derives policy_version_id from the evaluation (so it can never be spoofed). Feature-flag gated.

export interface AcceptHealthRiskInput {
  healthEvaluationId: string;
  dimension: string;
  driverCode: string;
  reason: string;
  expiresAt?: string | null;
}

/**
 * Record a risk acceptance for a surfaced driver of a health evaluation. Throws if the evaluation does
 * not exist (in this org) or the (dimension, driver_code) is not present in it, or the reason is blank.
 * The RLS INSERT policy is the authoritative authz (policy.manage + self actor); this is defense + a
 * clear early error. `client` MUST be the RLS-scoped user client so auth.uid() = the acting policy owner.
 */
export async function acceptHealthRisk(
  input: AcceptHealthRiskInput,
  ctx: HealthContext,
  client: SupabaseClient<Database>,
): Promise<PolicyHealthRiskAcceptance> {
  await assertHealthEngineEnabled(client, ctx.organizationId);

  if (!input.reason || input.reason.trim().length === 0) {
    throw new Error('a risk acceptance requires a non-empty reason (§3.8)');
  }

  const repo = new IncentiveHealthRepository(client);
  const evaluation = await repo.getById(input.healthEvaluationId, ctx.organizationId);
  if (!evaluation) throw new Error('health evaluation not found');

  // The waiver must reference a REAL surfaced risk driver (not an arbitrary code) — you can only
  // accept a risk the engine actually reported (§3.4/§3.8).
  const dimension = evaluation.dimensions.find((d) => d.dimension === input.dimension);
  if (!dimension) throw new Error(`unknown health dimension: ${input.dimension}`);
  if (!dimension.drivers.some((dr) => dr.code === input.driverCode)) {
    throw new Error(`unknown risk driver ${input.driverCode} for dimension ${input.dimension}`);
  }

  // policy_version_id is DERIVED from the evaluation (never independently supplied) ⇒ always consistent.
  return repo.insertRiskAcceptance({
    organizationId: ctx.organizationId,
    policyVersionId: evaluation.policyVersionId,
    healthEvaluationId: evaluation.id,
    dimension: input.dimension,
    driverCode: input.driverCode,
    reason: input.reason,
    acceptedBy: ctx.userId,
    expiresAt: input.expiresAt ?? null,
  });
}

/** List a version's risk acceptances (full append-only history), newest first. Feature-flag gated. */
export async function listHealthRiskAcceptances(
  policyVersionId: string,
  ctx: Pick<HealthContext, 'organizationId'>,
  client: SupabaseClient<Database>,
): Promise<PolicyHealthRiskAcceptance[]> {
  await assertHealthEngineEnabled(client, ctx.organizationId);
  return new IncentiveHealthRepository(client).listRiskAcceptances(policyVersionId, ctx.organizationId);
}
