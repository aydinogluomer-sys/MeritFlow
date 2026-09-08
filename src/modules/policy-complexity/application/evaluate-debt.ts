import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import {
  IntelligenceRepository,
  type EvidenceRef,
  type SuggestedAction,
} from '@/modules/intelligence';
import { evaluateStaticComplexity } from '../domain/complexity-rules';
import { evaluateRuntimeComplexity } from '../domain/runtime-rules';
import { computeDebtEvaluation, FULL_RULE_SET_VERSION } from '../domain/debt';
import { findSimplificationCandidates } from '../domain/simplification';
import type { SimplificationCandidate } from '../domain/types';
import {
  PolicyComplexityRepository,
  type PolicyComplexityEvaluation,
} from '../repository/policy-complexity-repository';
import { assertPolicyDebtEnabled, type PolicyComplexityContext } from './feature-gate';

// Phase P1 / slice 4-B — evaluate a policy version's DEBT (static + runtime) and surface advisory
// simplification candidates. Deterministic + reproducible + idempotent (one full row per (version,
// FULL_RULE_SET_VERSION); re-eval returns the existing row). Feature-flag gated ('policy_debt'). The
// service_role admin client is INJECTED (SI-11); it READS operational data (READ-ONLY, §26) and
// performs the append-only write + emits the advisory insight. NEVER mutates a policy; no LLM.
export interface PolicyDebtResult {
  evaluation: PolicyComplexityEvaluation;
  candidates: SimplificationCandidate[];
}

function buildActions(policyVersionId: string): SuggestedAction[] {
  const target = { type: 'scoring_policy_version', id: policyVersionId };
  return [
    { code: 'review_rule', label: 'Kuralı incele', route: 'policy_review', target },
    { code: 'create_policy_draft', label: 'Politika taslağı oluştur', route: 'policy_review', target },
  ];
}

async function emitDebtInsight(
  admin: SupabaseClient<Database>,
  organizationId: string,
  policyVersionId: string,
  evaluation: PolicyComplexityEvaluation,
  candidates: SimplificationCandidate[],
): Promise<void> {
  const evidence: EvidenceRef[] = [
    { sourceType: 'policy_version', sourceId: policyVersionId },
    { sourceType: 'ledger', sourceId: policyVersionId }, // the version's frozen operational data
  ];
  await new IntelligenceRepository(admin).insert({
    organizationId,
    insightType: 'policy_debt',
    subjectType: 'scoring_policy_version',
    subjectId: policyVersionId,
    severity: candidates.length > 0 ? 'warning' : 'info',
    headline:
      `Politika borcu: toplam ${evaluation.totalScore} (statik ${evaluation.staticScore} + ` +
      `çalışma-zamanı ${evaluation.runtimeScore ?? 0}); ${candidates.length} sadeleştirme adayı.`,
    deterministicFacts: {
      staticScore: evaluation.staticScore,
      runtimeScore: evaluation.runtimeScore,
      totalScore: evaluation.totalScore,
      ruleSetVersion: evaluation.ruleSetVersion,
      simplificationCandidateCount: candidates.length,
      simplificationCandidates: candidates.map((c) => ({ code: c.code, kind: c.kind, detail: c.detail })),
    },
    evidence,
    suggestedActions: buildActions(policyVersionId),
  });
}

/**
 * Evaluate a policy version's debt and emit the advisory Policy Debt insight. Idempotent: an existing
 * full evaluation is reused (no duplicate write, no duplicate insight); a fresh one is persisted +
 * an insight emitted. Simplification candidates are ADVISORY (never auto-applied — §26).
 */
export async function evaluatePolicyDebt(
  policyVersionId: string,
  ctx: PolicyComplexityContext,
  admin: SupabaseClient<Database>,
): Promise<PolicyDebtResult> {
  await assertPolicyDebtEnabled(admin, ctx.organizationId);
  const repo = new PolicyComplexityRepository(admin);

  const config = await repo.readVersionConfig(policyVersionId, ctx.organizationId);
  if (!config) throw new Error('scoring policy version not found');

  const existing = await repo.findByVersionAndRuleSet(
    policyVersionId,
    ctx.organizationId,
    FULL_RULE_SET_VERSION,
  );

  const usage = await repo.readBucketUsage(policyVersionId, ctx.organizationId);
  const candidates = findSimplificationCandidates(config, usage);

  if (existing) {
    return { evaluation: existing, candidates };
  }

  const signals = await repo.readRuntimeSignals(policyVersionId, ctx.organizationId);
  const debt = computeDebtEvaluation(evaluateStaticComplexity(config), evaluateRuntimeComplexity(signals));
  const evaluation = await repo.insert({
    organizationId: ctx.organizationId,
    policyVersionId,
    ruleSetVersion: debt.ruleSetVersion,
    staticScore: debt.staticScore,
    runtimeScore: debt.runtimeScore,
    totalScore: debt.totalScore,
    components: debt.components,
  });

  // Emit the advisory insight once, on creation (avoids duplicate insights on repeated evaluation).
  await emitDebtInsight(admin, ctx.organizationId, policyVersionId, evaluation, candidates);

  return { evaluation, candidates };
}
