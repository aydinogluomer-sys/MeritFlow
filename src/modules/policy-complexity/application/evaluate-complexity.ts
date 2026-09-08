import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { evaluateStaticComplexity, RULE_SET_VERSION } from '../domain/complexity-rules';
import {
  PolicyComplexityRepository,
  type PolicyComplexityEvaluation,
} from '../repository/policy-complexity-repository';
import { assertPolicyDebtEnabled, type PolicyComplexityContext } from './feature-gate';

// Phase P1 / slice 4-A — evaluate a scoring_policy_version's STATIC complexity and persist it.
// Deterministic + reproducible + idempotent: an existing evaluation for (version, RULE_SET_VERSION)
// is returned unchanged (append-only; never overwritten). Feature-flag gated ('policy_debt'). The
// service_role admin client is INJECTED by the trusted caller (SI-11 boundary — the module never
// imports it): it reads the policy config (READ-ONLY — §26) and performs the server-only write.
// NO policy mutation, NO LLM.
export async function evaluatePolicyComplexity(
  policyVersionId: string,
  ctx: PolicyComplexityContext,
  admin: SupabaseClient<Database>,
): Promise<PolicyComplexityEvaluation> {
  await assertPolicyDebtEnabled(admin, ctx.organizationId);
  const repo = new PolicyComplexityRepository(admin);

  const existing = await repo.findByVersionAndRuleSet(
    policyVersionId,
    ctx.organizationId,
    RULE_SET_VERSION,
  );
  if (existing) return existing;

  const config = await repo.readVersionConfig(policyVersionId, ctx.organizationId);
  if (!config) throw new Error('scoring policy version not found');

  const result = evaluateStaticComplexity(config);
  return repo.insert({
    organizationId: ctx.organizationId,
    policyVersionId,
    ruleSetVersion: result.ruleSetVersion,
    staticScore: result.staticScore,
    totalScore: result.staticScore, // total = static until 4-B adds runtime complexity
    components: result.components,
  });
}
