import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { computeVersionTrend, type TrendInput } from '../domain/trend';
import { FULL_RULE_SET_VERSION } from '../domain/debt';
import type { VersionTrendEntry } from '../domain/types';
import { PolicyComplexityRepository } from '../repository/policy-complexity-repository';
import { assertPolicyDebtEnabled, type PolicyComplexityContext } from './feature-gate';

// Phase P1 / slice 4-B — the version complexity/debt trend (§6.7). Deterministic READ across a
// scoring policy's versions. Uses the RLS-scoped user client (read gated by policy.manage) and the
// P0 'policy_debt' feature flag. Per version, prefers the full (static+runtime) evaluation, else the
// latest available (e.g. a 4-A static-only row). No mutation.
export async function getPolicyComplexityTrend(
  scoringPolicyId: string,
  ctx: Pick<PolicyComplexityContext, 'organizationId'>,
): Promise<VersionTrendEntry[]> {
  const supabase = await createClient();
  await assertPolicyDebtEnabled(supabase, ctx.organizationId);
  const repo = new PolicyComplexityRepository(supabase);

  const [versions, evaluations] = await Promise.all([
    repo.listVersionsForPolicy(scoringPolicyId, ctx.organizationId),
    repo.list(ctx.organizationId), // RLS-scoped; ordered evaluated_at desc (latest first)
  ]);

  const fullByVersion = new Map<string, (typeof evaluations)[number]>();
  const latestByVersion = new Map<string, (typeof evaluations)[number]>();
  for (const e of evaluations) {
    if (e.ruleSetVersion === FULL_RULE_SET_VERSION && !fullByVersion.has(e.policyVersionId)) {
      fullByVersion.set(e.policyVersionId, e);
    }
    if (!latestByVersion.has(e.policyVersionId)) latestByVersion.set(e.policyVersionId, e);
  }

  const inputs: TrendInput[] = [];
  for (const v of versions) {
    const chosen = fullByVersion.get(v.policyVersionId) ?? latestByVersion.get(v.policyVersionId);
    if (!chosen) continue; // versions with no evaluation are not on the trend
    inputs.push({
      policyVersionId: v.policyVersionId,
      versionNo: v.versionNo,
      staticScore: chosen.staticScore,
      runtimeScore: chosen.runtimeScore,
      totalScore: chosen.totalScore,
    });
  }
  return computeVersionTrend(inputs);
}
