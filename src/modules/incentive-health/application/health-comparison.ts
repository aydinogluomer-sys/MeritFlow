import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import {
  computeHealthComparison,
  pickPreviousVersion,
  type ComparableEvaluation,
  type HealthComparison,
} from '../domain/compare-health';
import { HEALTH_RULE_SET_VERSION } from '../domain/rules/weights.rules';
import {
  IncentiveHealthRepository,
  type PolicyHealthEvaluation,
} from '../repository/incentive-health-repository';
import { assertHealthEngineEnabled, type HealthContext } from './feature-gate';

// Phase P2 / slice 1-B — comparison-to-previous-policy health delta (§3.11). DETERMINISTIC read over
// policy_health_evaluations: the given version's latest health-v1 evaluation vs the PREVIOUS version's
// (largest version_no strictly below it). Returns overall + per-dimension deltas (higher = healthier,
// positive delta = improvement). No write, no mutation, no LLM. Feature-flag gated ('health_engine').

function toComparable(evaluation: PolicyHealthEvaluation, versionNo: number): ComparableEvaluation {
  return {
    versionNo,
    overallScore: evaluation.overallScore,
    dimensions: evaluation.dimensions.map((d) => ({ dimension: d.dimension, score: d.score })),
  };
}

/**
 * Compare a policy version's health to the previous version's. Throws if the version does not exist in
 * this org, or if it has no health evaluation yet (evaluate it first). A first version (no earlier
 * version, or the earlier version has no evaluation) yields hasPrevious=false with null deltas.
 */
export async function getHealthComparison(
  policyVersionId: string,
  ctx: Pick<HealthContext, 'organizationId'>,
  client: SupabaseClient<Database>,
): Promise<HealthComparison> {
  await assertHealthEngineEnabled(client, ctx.organizationId);
  const repo = new IncentiveHealthRepository(client);

  const meta = await repo.getVersionMeta(policyVersionId, ctx.organizationId);
  if (!meta) throw new Error('scoring policy version not found');

  const currentEval = await repo.findByVersionAndRuleSet(
    policyVersionId,
    ctx.organizationId,
    HEALTH_RULE_SET_VERSION,
  );
  if (!currentEval) throw new Error('no health evaluation for this version (evaluate it first)');

  // Previous version = the highest version_no strictly below the current one (pure, testable).
  const versions = await repo.listPolicyVersions(meta.scoringPolicyId, ctx.organizationId);
  const previous = pickPreviousVersion(versions, meta.versionNo);

  const previousEval = previous
    ? await repo.findByVersionAndRuleSet(previous.id, ctx.organizationId, HEALTH_RULE_SET_VERSION)
    : null;

  return computeHealthComparison(
    toComparable(currentEval, meta.versionNo),
    previous && previousEval ? toComparable(previousEval, previous.versionNo) : null,
  );
}
