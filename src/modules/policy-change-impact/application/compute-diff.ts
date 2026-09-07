import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { diffPolicyVersions } from '../domain/diff';
import type { PolicyDiff } from '../domain/types';
import { PolicyChangeRequestRepository } from '../repository/policy-change-request-repository';
import { assertPolicyChangeImpactEnabled, type PolicyChangeImpactContext } from './feature-gate';

/**
 * Compute the deterministic structural diff between two scoring_policy_versions (plan §8.3). Reads
 * both configs through the RLS-scoped client (tenant + visibility enforced by policy), then runs the
 * PURE diff engine. Reproducible: same two versions → identical diff. Read-only — mutates nothing.
 */
export async function computePolicyDiff(
  fromVersionId: string,
  toDraftVersionId: string,
  ctx: Pick<PolicyChangeImpactContext, 'organizationId'>,
): Promise<PolicyDiff> {
  const supabase = await createClient();
  await assertPolicyChangeImpactEnabled(supabase, ctx.organizationId);
  const repo = new PolicyChangeRequestRepository(supabase);
  const [from, to] = await Promise.all([
    repo.getVersionConfig(fromVersionId, ctx.organizationId),
    repo.getVersionConfig(toDraftVersionId, ctx.organizationId),
  ]);
  if (!from || !to) {
    throw new Error('scoring policy version not found or not visible');
  }
  return diffPolicyVersions(from, to);
}
