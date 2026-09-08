import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/rbac';
import {
  IntelligenceRepository,
  type EvidenceRef,
  type SuggestedAction,
} from '@/modules/intelligence';
import { runBacktest, type ImpactSummary } from '../domain/backtest';
import {
  PolicyChangeImpactRepository,
  type PolicyChangeImpact,
} from '../repository/policy-change-impact-repository';
import {
  PolicyChangeRequestRepository,
  type PolicyChangeRequest,
} from '../repository/policy-change-request-repository';
import { assertPolicyChangeImpactEnabled, type PolicyChangeImpactContext } from './feature-gate';

// Phase P1 / slice 6-B — generate a Policy Change Impact artifact. Runs the DETERMINISTIC backtest
// (reuse allocateBonus) over a frozen reference period and writes the append-only artifact + an
// advisory P0 insight. Gated by the 'policy_change_impact' feature flag + policy.manage. The engine
// reads (incl. sensitive comp) + writes via the service_role (admin) client — the same server-only
// posture as run_bonus_calculation / the insight store. NO ledger write; NO run_bonus_calculation;
// NO published-version mutation.

export interface GenerateImpactInput {
  changeRequestId: string;
  referencePeriodId: string; // a LOCKED period whose approved work is the frozen dataset
}

function buildEvidence(cr: PolicyChangeRequest, referencePeriodId: string): EvidenceRef[] {
  // Valid P0 EvidenceRef source types only. The two policy versions are the deterministic diff
  // sources; the reference period's frozen point_ledger is the dataset source (change_request_id +
  // reference_period_id are also carried in deterministicFacts for full traceability).
  return [
    { sourceType: 'policy_version', sourceId: cr.fromVersionId },
    { sourceType: 'policy_version', sourceId: cr.toDraftVersionId },
    { sourceType: 'ledger', sourceId: referencePeriodId },
  ];
}

function buildActions(cr: PolicyChangeRequest): SuggestedAction[] {
  const requestTarget = { type: 'policy_change_request', id: cr.id };
  return [
    { code: 'approve', label: 'Onayla', route: 'policy_review', target: requestTarget },
    { code: 'reject', label: 'Reddet', route: 'policy_review', target: requestTarget },
    {
      code: 'modify_draft',
      label: 'Taslağı düzenle',
      route: 'policy_review',
      target: { type: 'scoring_policy_version', id: cr.toDraftVersionId },
    },
    { code: 'run_simulation', label: 'Yeni simülasyon çalıştır', route: 'digital_twin', target: requestTarget },
  ];
}

async function emitImpactInsight(
  admin: SupabaseClient<Database>,
  organizationId: string,
  cr: PolicyChangeRequest,
  referencePeriodId: string,
  summary: ImpactSummary,
): Promise<void> {
  const insights = new IntelligenceRepository(admin);
  await insights.insert({
    organizationId,
    insightType: 'policy_change_impact',
    subjectType: 'policy_change_request',
    subjectId: cr.id,
    bonusPeriodId: referencePeriodId,
    severity: summary.lower > 0 ? 'warning' : 'info',
    headline:
      `Politika değişikliği etkisi: ${summary.employeesAffected} çalışan etkilendi ` +
      `(bütçe Δ ${summary.budgetDeltaMinor} kuruş).`,
    deterministicFacts: {
      ...summary,
      changeRequestId: cr.id,
      referencePeriodId,
      fromVersionId: cr.fromVersionId,
      toDraftVersionId: cr.toDraftVersionId,
    },
    evidence: buildEvidence(cr, referencePeriodId),
    suggestedActions: buildActions(cr),
  });
}

/**
 * Generate (or re-generate) a Policy Change Impact artifact for a change request against a frozen
 * reference period. Deterministic + reproducible; append-only. Also emits the advisory insight.
 *
 * The service_role `admin` client is INJECTED by the trusted caller (a server action) — the module
 * never imports it (SI-11 boundary): the engine reads sensitive comp + performs the server-only
 * writes through it. Gating (feature flag + policy.manage) uses the RLS-scoped user client.
 */
export async function generatePolicyChangeImpact(
  input: GenerateImpactInput,
  ctx: PolicyChangeImpactContext,
  admin: SupabaseClient<Database>,
): Promise<PolicyChangeImpact> {
  const userClient = await createClient();
  await assertPolicyChangeImpactEnabled(userClient, ctx.organizationId);
  await requirePermission('policy.manage'); // generating a backtest is a policy-management action

  const impactRepo = new PolicyChangeImpactRepository(admin);
  const crRepo = new PolicyChangeRequestRepository(admin);

  const cr = await crRepo.getById(input.changeRequestId, ctx.organizationId);
  if (!cr) throw new Error('change request not found');

  const [dataset, fromPolicy, toPolicy] = await Promise.all([
    impactRepo.readReferenceDataset(ctx.organizationId, input.referencePeriodId),
    impactRepo.readPolicyConfig(cr.fromVersionId, ctx.organizationId),
    impactRepo.readPolicyConfig(cr.toDraftVersionId, ctx.organizationId),
  ]);
  if (!dataset) throw new Error('reference period not found or has no pool');
  if (!fromPolicy || !toPolicy) throw new Error('scoring policy version not found');

  const result = runBacktest(dataset, fromPolicy, toPolicy);
  const impactVersion = await impactRepo.nextImpactVersion(ctx.organizationId, input.changeRequestId);

  const impact = await impactRepo.insert({
    organizationId: ctx.organizationId,
    changeRequestId: input.changeRequestId,
    referencePeriodId: input.referencePeriodId,
    impactVersion,
    fromVersionId: cr.fromVersionId,
    toDraftVersionId: cr.toDraftVersionId,
    financialImpact: result.summary,
    employeeDistribution: result.distribution,
  });

  await emitImpactInsight(admin, ctx.organizationId, cr, input.referencePeriodId, result.summary);
  return impact;
}
