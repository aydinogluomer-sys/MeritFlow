// The pure opportunity engine (§4.3/§4.5). Maps the frozen work signals of ALL members of a bonus
// period to a per-employee, cohort-normalized, DECOMPOSED opportunity index + advisory flags.
// COHORT = same primary_role + same PRIMARY team (team_memberships.is_primary, AD9). A cohort below
// MIN_COHORT_SIZE — or a member with no primary team / no active window — is SUPPRESSED (index null,
// COHORT_SUPPRESSED), never a misleading score / raw-count comparison (§4.5/§17). DETERMINISTIC +
// REPRODUCIBLE: same signals + OPPORTUNITY_RULE_SET_VERSION → identical output. No NaN; index 0–100.
// Reads ONLY the passed work-context signals — no protected attribute, no compensation (§4.2/§26).
import type {
  MemberSignals,
  OpportunityComponent,
  OpportunityDriver,
  OpportunityResult,
} from './types';
import { clampScore, lessIsBetterScore, median, moreIsBetterScore, perDay, ratio, roundScore } from './score-util';
import {
  COMPONENT_LABELS,
  COMPONENT_WEIGHTS,
  MIN_COHORT_SIZE,
  TARGET_POOL_PER_MEMBER,
  componentWeights,
  OPPORTUNITY_RULE_SET_VERSION,
} from './rules/weights.rules';
import { deriveFlags } from './rules/flags.rules';

export { OPPORTUNITY_RULE_SET_VERSION };

function driver(code: string, label: string, value: number, cohortValue: number): OpportunityDriver {
  return { code, label, value: round2(value), cohortValue: round2(cohortValue), ratio: round2(ratio(value, cohortValue)) };
}
function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function suppressed(m: MemberSignals, reason: string, cohortKey: string, cohortSize: number): OpportunityResult {
  return {
    employeeId: m.employeeId,
    cohortKey,
    cohortSize,
    suppressed: true,
    suppressionReason: reason,
    opportunityIndex: null,
    components: [],
    weights: componentWeights(),
    flags: ['COHORT_SUPPRESSED'],
    signals: m,
  };
}

interface CohortStats {
  medAssignedPerDay: number;
  medComplexityPerDay: number;
  medCompletionPerDay: number;
  medLatency: number; // median review latency (days) over members that HAVE a latency signal
  poolPerMember: number; // complexity-weighted team pool ÷ cohort size (team pool is shared)
}

function cohortStats(members: MemberSignals[]): CohortStats {
  const assigned = members.map((m) => perDay(m.assignedWorkCount, m.activeDays));
  const complexity = members.map((m) => perDay(m.complexityWeightedAssigned, m.activeDays));
  const completion = members.map((m) => perDay(m.completedWorkCount, m.activeDays));
  const latencies = members.map((m) => m.reviewLatencyP50Days).filter((v): v is number => v !== null);
  // Team pool is shared across the cohort (same primary team); use the max observed (all equal in
  // practice) ÷ cohort size for a per-member availability measure.
  const pool = Math.max(0, ...members.map((m) => m.complexityWeightedAvailable), 0);
  return {
    medAssignedPerDay: median(assigned),
    medComplexityPerDay: median(complexity),
    medCompletionPerDay: median(completion),
    medLatency: median(latencies),
    poolPerMember: members.length > 0 ? pool / members.length : 0,
  };
}

function scoreMember(m: MemberSignals, s: CohortStats): { components: OpportunityComponent[]; completionScore: number; index: number } {
  const assignedPerDay = perDay(m.assignedWorkCount, m.activeDays);
  const complexityPerDay = perDay(m.complexityWeightedAssigned, m.activeDays);
  const completionPerDay = perDay(m.completedWorkCount, m.activeDays);
  const coverage = m.periodDays > 0 ? m.activeDays / m.periodDays : 0;

  const components: OpportunityComponent[] = [
    {
      code: 'assignment_share',
      label: COMPONENT_LABELS.assignment_share,
      score: moreIsBetterScore(assignedPerDay, s.medAssignedPerDay),
      drivers: [driver('ASSIGNED_PER_ACTIVE_DAY', 'Aktif gün başına atanan iş', assignedPerDay, s.medAssignedPerDay)],
    },
    {
      code: 'complexity_exposure',
      label: COMPONENT_LABELS.complexity_exposure,
      score: moreIsBetterScore(complexityPerDay, s.medComplexityPerDay),
      drivers: [driver('COMPLEXITY_PER_ACTIVE_DAY', 'Aktif gün başına karmaşıklık ağırlığı', complexityPerDay, s.medComplexityPerDay)],
    },
    {
      code: 'review_throughput',
      // No latency signal (no submitted+reviewed tasks) ⇒ neutral 50 (no bottleneck evidence).
      label: COMPONENT_LABELS.review_throughput,
      score: m.reviewLatencyP50Days === null ? 50 : lessIsBetterScore(m.reviewLatencyP50Days, s.medLatency),
      drivers: [driver('REVIEW_LATENCY_P50_DAYS', 'İnceleme gecikmesi (medyan, gün)', m.reviewLatencyP50Days ?? 0, s.medLatency)],
    },
    {
      code: 'work_availability',
      label: COMPONENT_LABELS.work_availability,
      score: moreIsBetterScore(s.poolPerMember, TARGET_POOL_PER_MEMBER),
      drivers: [driver('POOL_PER_MEMBER', 'Üye başına takım iş havuzu', s.poolPerMember, TARGET_POOL_PER_MEMBER)],
    },
    {
      code: 'active_period',
      label: COMPONENT_LABELS.active_period,
      score: clampScore(100 * coverage),
      drivers: [driver('ACTIVE_DAY_COVERAGE', 'Dönemin aktif gün oranı', coverage, 1)],
    },
  ];

  let weightSum = 0;
  let acc = 0;
  for (const c of components) {
    const w = COMPONENT_WEIGHTS[c.code];
    weightSum += w;
    acc += w * c.score;
  }
  const index = weightSum > 0 ? roundScore(acc / weightSum) : 0;
  const completionScore = moreIsBetterScore(completionPerDay, s.medCompletionPerDay);
  return { components, completionScore, index };
}

/**
 * Compute opportunity results for every member of a period. Members are grouped into cohorts
 * (primaryRole::primaryTeamId); a cohort with < MIN_COHORT_SIZE cohortable members is suppressed.
 * Members with no primary team or no active window are suppressed individually. Pure + deterministic.
 */
export function computeOpportunity(members: MemberSignals[]): OpportunityResult[] {
  // Cohortable = has a primary team AND an active window; others are individually suppressed.
  const cohortable = members.filter((m) => m.primaryTeamId !== null && m.activeDays > 0);
  const byCohort = new Map<string, MemberSignals[]>();
  for (const m of cohortable) {
    const key = `${m.primaryRole}::${m.primaryTeamId}`;
    (byCohort.get(key) ?? byCohort.set(key, []).get(key)!).push(m);
  }

  const results: OpportunityResult[] = [];
  for (const m of members) {
    if (m.primaryTeamId === null) {
      results.push(suppressed(m, 'no_primary_team', `${m.primaryRole}::none`, 0));
      continue;
    }
    if (m.activeDays <= 0) {
      results.push(suppressed(m, 'no_active_period', `${m.primaryRole}::${m.primaryTeamId}`, 0));
      continue;
    }
    const key = `${m.primaryRole}::${m.primaryTeamId}`;
    const cohort = byCohort.get(key)!;
    if (cohort.length < MIN_COHORT_SIZE) {
      results.push(suppressed(m, 'cohort_below_min_sample', key, cohort.length));
      continue;
    }
    const stats = cohortStats(cohort);
    const { components, completionScore, index } = scoreMember(m, stats);
    results.push({
      employeeId: m.employeeId,
      cohortKey: key,
      cohortSize: cohort.length,
      suppressed: false,
      suppressionReason: null,
      opportunityIndex: index,
      components,
      weights: componentWeights(),
      flags: deriveFlags(components, index, completionScore),
      signals: m,
    });
  }
  return results;
}
