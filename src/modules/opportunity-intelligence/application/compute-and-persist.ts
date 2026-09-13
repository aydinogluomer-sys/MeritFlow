import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { IntelligenceRepository, type EvidenceRef, type SuggestedAction } from '@/modules/intelligence';
import { computeOpportunity, OPPORTUNITY_RULE_SET_VERSION } from '../domain/compute-opportunity';
import type { OpportunityResult } from '../domain/types';
import {
  OpportunityRepository,
  type OpportunitySnapshotRecord,
} from '../repository/opportunity-repository';
import { assertOpportunityIntelligenceEnabled, type OpportunityContext } from './feature-gate';

// Phase P3 / slice 2-A — compute + persist opportunity snapshots for a bonus period. Deterministic +
// reproducible + idempotent (one row per (employee, period, OPPORTUNITY_RULE_SET_VERSION); a fresh one
// is persisted, an existing one is returned unchanged). Feature-flag gated ('opportunity_intelligence').
// The service_role admin client is INJECTED (SI-11); it READS work-context signals only (§4.2 — never a
// protected attribute, never compensation), performs the append-only write, and emits advisory
// ("Investigate") insights for flagged, non-suppressed members. Drives NO pay/ledger/policy change; no LLM.

export interface OpportunityComputeResult {
  snapshots: OpportunitySnapshotRecord[];
  createdCount: number; // freshly persisted this run (existing rows are reused, not rewritten)
}

function buildActions(employeeId: string): SuggestedAction[] {
  const target = { type: 'employee', id: employeeId };
  return [
    { code: 'investigate_opportunity', label: 'Fırsatı incele', route: 'exception_center', target },
    { code: 'view_employee_evidence', label: 'Çalışan kanıtını gör', route: 'employee_evidence', target },
  ];
}

async function emitOpportunityInsight(
  admin: SupabaseClient<Database>,
  organizationId: string,
  bonusPeriodId: string,
  snapshotId: string,
  result: OpportunityResult,
): Promise<void> {
  const evidence: EvidenceRef[] = [
    { sourceType: 'snapshot', sourceId: snapshotId },
    { sourceType: 'metric', sourceId: result.employeeId },
  ];
  await new IntelligenceRepository(admin).insert({
    organizationId,
    insightType: 'opportunity_flag',
    // subjectType 'employee' + subjectId = the member's profile id (= auth.uid()) so the
    // intelligence_insights RLS employee-own branch matches (the member can see their own flag).
    subjectType: 'employee',
    subjectId: result.employeeId,
    bonusPeriodId,
    // Advisory — "Investigate", never a verdict/pay decision (§4.2/§26). Warning, never critical.
    severity: 'warning',
    headline: `Fırsat incelemesi: ${result.flags.join(', ')} (endeks ${result.opportunityIndex ?? '—'}).`,
    deterministicFacts: {
      opportunityIndex: result.opportunityIndex,
      ruleSetVersion: OPPORTUNITY_RULE_SET_VERSION,
      cohortKey: result.cohortKey,
      cohortSize: result.cohortSize,
      flags: result.flags,
      components: result.components,
      note: 'Danışma amaçlı — otomatik ücret kararı değildir; insan incelemesi gerektirir (§4.2/§26).',
    },
    evidence,
    suggestedActions: buildActions(result.employeeId),
  });
}

/**
 * Compute + persist opportunity snapshots for every eligible member of a bonus period. Idempotent per
 * (employee, period, rule_set): an existing snapshot is returned unchanged (no duplicate write, no
 * duplicate insight); a fresh one is persisted and — for a flagged, non-suppressed member — an advisory
 * insight is emitted once. Reads work-context signals ONLY; mutates no policy/ledger; no LLM.
 */
export async function computeOpportunitySnapshots(
  bonusPeriodId: string,
  ctx: OpportunityContext,
  admin: SupabaseClient<Database>,
): Promise<OpportunityComputeResult> {
  await assertOpportunityIntelligenceEnabled(admin, ctx.organizationId);
  const repo = new OpportunityRepository(admin);

  const members = await repo.readMemberSignals(bonusPeriodId, ctx.organizationId);
  const results = computeOpportunity(members);

  const snapshots: OpportunitySnapshotRecord[] = [];
  let createdCount = 0;
  for (const r of results) {
    const existing = await repo.findByEmployeePeriodRuleSet(
      r.employeeId,
      bonusPeriodId,
      OPPORTUNITY_RULE_SET_VERSION,
      ctx.organizationId,
    );
    if (existing) {
      snapshots.push(existing);
      continue;
    }
    const persisted = await repo.insert({
      organizationId: ctx.organizationId,
      employeeId: r.employeeId,
      bonusPeriodId,
      ruleSetVersion: OPPORTUNITY_RULE_SET_VERSION,
      eligibleWorkCount: r.signals.eligibleWorkCount,
      assignedWorkCount: r.signals.assignedWorkCount,
      completedWorkCount: r.signals.completedWorkCount,
      complexityWeightedAvailable: r.signals.complexityWeightedAvailable,
      complexityWeightedAssigned: r.signals.complexityWeightedAssigned,
      activeDays: r.signals.activeDays,
      reviewLatencyP50: r.signals.reviewLatencyP50Days,
      opportunityIndex: r.opportunityIndex,
      components: {
        items: r.components,
        weights: r.weights,
        flags: r.flags,
        cohortKey: r.cohortKey,
        cohortSize: r.cohortSize,
        suppressed: r.suppressed,
        suppressionReason: r.suppressionReason,
      },
    });
    createdCount += 1;
    // Advisory insight, once on creation, only for a flagged NON-suppressed member.
    if (!r.suppressed && r.flags.length > 0) {
      await emitOpportunityInsight(admin, ctx.organizationId, bonusPeriodId, persisted.id, r);
    }
    snapshots.push(persisted);
  }
  return { snapshots, createdCount };
}
