import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import {
  IntelligenceRepository,
  type EvidenceRef,
  type InsightSeverity,
  type SuggestedAction,
} from '@/modules/intelligence';
import { evaluateHealth } from '../domain/evaluate-health';
import type { HealthEvaluation } from '../domain/types';
import {
  IncentiveHealthRepository,
  type PolicyHealthEvaluation,
} from '../repository/incentive-health-repository';
import { assertHealthEngineEnabled, type HealthContext } from './feature-gate';

// Phase P2 / slice 1-A — evaluate a scoring_policy_version's INCENTIVE HEALTH and persist a
// reproducible evaluation. Deterministic + idempotent (one row per (version, HEALTH_RULE_SET_VERSION);
// re-eval returns the existing row — no duplicate write, no duplicate insight). Feature-flag gated
// ('health_engine'). The service_role admin client is INJECTED (SI-11); it READS the config +
// operational data (READ-ONLY, §26), performs the append-only write, and emits an advisory insight.
// The stored evaluation is ADVISORY: it drives NO financial calc and NEVER mutates a policy/ledger.
// No LLM — the overall is a transparent weighted aggregate of decomposed sub-scores (§26).

export interface PolicyHealthResult {
  evaluation: PolicyHealthEvaluation;
  created: boolean; // false when an existing evaluation was returned unchanged (idempotent)
}

/** Overall severity from the health score: worse score ⇒ higher severity (deterministic thresholds). */
function severityForOverall(overall: number): InsightSeverity {
  if (overall < 50) return 'critical';
  if (overall < 75) return 'warning';
  return 'info';
}

function buildActions(policyVersionId: string): SuggestedAction[] {
  const target = { type: 'scoring_policy_version', id: policyVersionId };
  return [
    { code: 'inspect_health', label: 'Sağlık ayrıntısını incele', route: 'policy_review', target },
    { code: 'review_policy', label: 'Politikayı gözden geçir', route: 'policy_review', target },
  ];
}

async function emitHealthInsight(
  admin: SupabaseClient<Database>,
  organizationId: string,
  policyVersionId: string,
  evaluation: HealthEvaluation,
): Promise<void> {
  // Evidence = the union of each dimension's evidence (always ≥ the policy version) — de-duplicated.
  const seen = new Set<string>();
  const evidence: EvidenceRef[] = [];
  for (const d of evaluation.dimensions) {
    for (const e of d.evidence) {
      const key = `${e.sourceType}:${e.sourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push(e);
    }
  }

  await new IntelligenceRepository(admin).insert({
    organizationId,
    insightType: 'policy_health',
    subjectType: 'scoring_policy_version',
    subjectId: policyVersionId,
    severity: severityForOverall(evaluation.overallScore),
    headline:
      `Politika sağlığı: ${evaluation.overallScore}/100 (` +
      evaluation.dimensions.map((d) => `${d.dimension} ${d.score}`).join(', ') +
      ').',
    deterministicFacts: {
      ruleSetVersion: evaluation.ruleSetVersion,
      overallScore: evaluation.overallScore,
      weights: evaluation.weights,
      deferredDimensions: evaluation.deferredDimensions,
      dimensions: evaluation.dimensions.map((d) => ({
        dimension: d.dimension,
        score: d.score,
        confidence: d.confidence,
        drivers: d.drivers,
      })),
    },
    evidence,
    suggestedActions: buildActions(policyVersionId),
  });
}

/**
 * Evaluate a policy version's incentive health and emit the advisory Health insight. Idempotent: an
 * existing evaluation for (version, HEALTH_RULE_SET_VERSION) is returned unchanged; otherwise a fresh
 * one is computed from frozen signals, persisted (append-only), and an insight emitted once.
 */
export async function evaluatePolicyHealth(
  policyVersionId: string,
  ctx: HealthContext,
  admin: SupabaseClient<Database>,
): Promise<PolicyHealthResult> {
  await assertHealthEngineEnabled(admin, ctx.organizationId);
  const repo = new IncentiveHealthRepository(admin);

  // Read the signals first — this also validates the version exists in the org (throws otherwise).
  const signals = await repo.readHealthSignals(policyVersionId, ctx.organizationId);
  const evaluation = evaluateHealth(signals);

  const existing = await repo.findByVersionAndRuleSet(
    policyVersionId,
    ctx.organizationId,
    evaluation.ruleSetVersion,
  );
  if (existing) {
    return { evaluation: existing, created: false };
  }

  const persisted = await repo.insert({
    organizationId: ctx.organizationId,
    policyVersionId,
    ruleSetVersion: evaluation.ruleSetVersion,
    overallScore: evaluation.overallScore,
    dimensions: evaluation.dimensions,
    weights: evaluation.weights,
    deferredDimensions: evaluation.deferredDimensions,
  });

  // Emit the advisory insight once, on creation (avoids duplicates on repeated evaluation).
  await emitHealthInsight(admin, ctx.organizationId, policyVersionId, evaluation);

  return { evaluation: persisted, created: true };
}
