import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  computeOpportunity,
  MIN_COHORT_SIZE,
  OPPORTUNITY_RULE_SET_VERSION,
  type MemberSignals,
  type OpportunityResult,
} from '@/modules/opportunity-intelligence';

// Module 2-A — the pure, cohort-relative opportunity engine (§4.3/§4.5/§4.6/§4.10). No DB.

function mem(over: Partial<MemberSignals> = {}): MemberSignals {
  return {
    employeeId: 'e0', // default; overridden by `over` or the cohort() factory
    primaryRole: 'employee',
    primaryTeamId: 'team-a',
    activeDays: 20,
    periodDays: 30,
    eligibleWorkCount: 100,
    assignedWorkCount: 10,
    completedWorkCount: 8,
    complexityWeightedAvailable: 200,
    complexityWeightedAssigned: 20,
    reviewLatencyP50Days: 2,
    ...over,
  };
}
// Build a healthy cohort of `n` baseline members (distinct ids) so cohort stats are well-defined.
function cohort(n: number, over: Partial<MemberSignals> = {}): MemberSignals[] {
  return Array.from({ length: n }, (_, i) => mem({ ...over, employeeId: `base-${i}` }));
}
function find(results: OpportunityResult[], id: string): OpportunityResult {
  const r = results.find((x) => x.employeeId === id);
  if (!r) throw new Error(`missing ${id}`);
  return r;
}

describe('cohort suppression (§4.5/§17 — statistical validity + small-cohort privacy)', () => {
  it(`a cohort below MIN_COHORT_SIZE (${MIN_COHORT_SIZE}) is SUPPRESSED — index null, not a misleading score`, () => {
    const members = cohort(MIN_COHORT_SIZE - 1);
    const results = computeOpportunity(members);
    for (const r of results) {
      expect(r.suppressed).toBe(true);
      expect(r.opportunityIndex).toBeNull();
      expect(r.flags).toContain('COHORT_SUPPRESSED');
      expect(r.suppressionReason).toBe('cohort_below_min_sample');
    }
  });

  it(`a cohort at MIN_COHORT_SIZE is NOT suppressed (index present)`, () => {
    const results = computeOpportunity(cohort(MIN_COHORT_SIZE));
    for (const r of results) {
      expect(r.suppressed).toBe(false);
      expect(r.opportunityIndex).not.toBeNull();
    }
  });

  it('no primary team ⇒ suppressed (no_primary_team); zero active days ⇒ suppressed (no_active_period)', () => {
    const base = cohort(MIN_COHORT_SIZE);
    const noTeam = mem({ employeeId: 'no-team', primaryTeamId: null });
    const onLeave = mem({ employeeId: 'leave', activeDays: 0 });
    const results = computeOpportunity([...base, noTeam, onLeave]);
    expect(find(results, 'no-team').suppressionReason).toBe('no_primary_team');
    expect(find(results, 'leave').suppressionReason).toBe('no_active_period');
    expect(find(results, 'leave').opportunityIndex).toBeNull();
  });

  it('a team change moves a member into a different (role::team) cohort', () => {
    // 5 on team-a + 1 lone member on team-b ⇒ team-b cohort has size 1 ⇒ suppressed.
    const teamB = mem({ employeeId: 'moved', primaryTeamId: 'team-b' });
    const results = computeOpportunity([...cohort(MIN_COHORT_SIZE), teamB]);
    expect(find(results, 'moved').cohortKey).toBe('employee::team-b');
    expect(find(results, 'moved').suppressed).toBe(true);
  });

  it('a role change forms a distinct cohort key', () => {
    const lead = mem({ employeeId: 'lead', primaryRole: 'manager' });
    const results = computeOpportunity([...cohort(MIN_COHORT_SIZE), lead]);
    expect(find(results, 'lead').cohortKey).toBe('manager::team-a');
  });
});

describe('flags (§4.6 — advisory, deterministic)', () => {
  it('low assignment vs cohort ⇒ LOW_ASSIGNMENT_OPPORTUNITY', () => {
    const low = mem({ employeeId: 'low-assign', assignedWorkCount: 1, complexityWeightedAssigned: 2 });
    const results = computeOpportunity([...cohort(MIN_COHORT_SIZE), low]);
    const r = find(results, 'low-assign');
    expect(r.flags).toContain('LOW_ASSIGNMENT_OPPORTUNITY');
    expect(r.components.find((c) => c.code === 'assignment_share')!.score).toBeLessThanOrEqual(34);
  });

  it('complexity imbalance fires in EITHER direction (§4.3 mix balance): under- OR over-exposed', () => {
    // Under-exposed: far below the cohort complexity norm.
    const under = mem({ employeeId: 'under', complexityWeightedAssigned: 2 });
    const over = mem({ employeeId: 'over', complexityWeightedAssigned: 200 });
    const results = computeOpportunity([...cohort(MIN_COHORT_SIZE), under, over]);
    expect(find(results, 'under').flags).toContain('HIGH_COMPLEXITY_IMBALANCE');
    expect(find(results, 'over').flags).toContain('HIGH_COMPLEXITY_IMBALANCE');
    // A cohort-norm member is NOT flagged (balanced complexity mix).
    expect(find(results, 'base-0').flags).not.toContain('HIGH_COMPLEXITY_IMBALANCE');
  });

  it('review latency far above cohort ⇒ REVIEW_BOTTLENECK', () => {
    const slow = mem({ employeeId: 'slow-review', reviewLatencyP50Days: 40 });
    const results = computeOpportunity([...cohort(MIN_COHORT_SIZE), slow]);
    expect(find(results, 'slow-review').flags).toContain('REVIEW_BOTTLENECK');
  });

  it('adequate opportunity (full active window, cohort-norm assignment) but low completion ⇒ PERFORMANCE_OPPORTUNITY_MISMATCH', () => {
    // Full active period + cohort-norm assignment/complexity/review ⇒ opportunity adequate; but the
    // member completes nothing ⇒ the "low output despite opportunity" signal (§4.1) fires.
    const full = cohort(MIN_COHORT_SIZE, { activeDays: 30 });
    const mismatch = mem({ employeeId: 'mismatch', activeDays: 30, completedWorkCount: 0 });
    const results = computeOpportunity([...full, mismatch]);
    const r = find(results, 'mismatch');
    expect(r.opportunityIndex).toBeGreaterThanOrEqual(60);
    expect(r.flags).toContain('PERFORMANCE_OPPORTUNITY_MISMATCH');
  });
});

describe('active-days normalization (§4.3 — fair cross-employee comparison)', () => {
  it('a part-timer with the SAME per-active-day rate scores like full-timers on assignment', () => {
    // Full-timers: 10 assigned / 20 active days = 0.5/day. Part-timer: 5 / 10 = 0.5/day (same rate).
    const part = mem({ employeeId: 'part', activeDays: 10, assignedWorkCount: 5, complexityWeightedAssigned: 10, completedWorkCount: 4 });
    const results = computeOpportunity([...cohort(MIN_COHORT_SIZE), part]);
    const r = find(results, 'part');
    // Same per-day assignment ⇒ assignment_share at the cohort norm (~50), NOT penalised for part-time.
    expect(r.components.find((c) => c.code === 'assignment_share')!.score).toBe(50);
    // But active_period coverage is lower (10/30) — a real, honest opportunity-window difference.
    expect(r.components.find((c) => c.code === 'active_period')!.score).toBeLessThan(50);
  });
});

describe('properties (§4.10): range, no-NaN, reproducibility, no protected attribute', () => {
  it('NO protected attribute is present on MemberSignals — only work-context fields', () => {
    const WORK_CONTEXT_FIELDS = new Set([
      'employeeId', 'primaryRole', 'primaryTeamId', 'activeDays', 'periodDays',
      'eligibleWorkCount', 'assignedWorkCount', 'completedWorkCount',
      'complexityWeightedAvailable', 'complexityWeightedAssigned', 'reviewLatencyP50Days',
    ]);
    const keys = Object.keys(mem());
    for (const k of keys) expect(WORK_CONTEXT_FIELDS.has(k)).toBe(true);
    // Explicitly assert none of the forbidden protected-characteristic fields exist (§4.2/§26).
    for (const forbidden of ['gender', 'age', 'race', 'ethnicity', 'disability', 'religion', 'nationality', 'compensation', 'salary', 'pay']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  const memberArb = fc.record({
    employeeId: fc.uuid(),
    primaryRole: fc.constantFrom('employee', 'manager', 'hr'),
    primaryTeamId: fc.constantFrom('team-a', 'team-b', null),
    activeDays: fc.nat({ max: 31 }),
    periodDays: fc.integer({ min: 1, max: 31 }),
    eligibleWorkCount: fc.nat({ max: 500 }),
    assignedWorkCount: fc.nat({ max: 200 }),
    completedWorkCount: fc.nat({ max: 200 }),
    complexityWeightedAvailable: fc.nat({ max: 2000 }),
    complexityWeightedAssigned: fc.nat({ max: 1000 }),
    reviewLatencyP50Days: fc.option(fc.double({ min: 0, max: 90, noNaN: true }), { nil: null }),
  }) as fc.Arbitrary<MemberSignals>;

  it('index is null (suppressed) or an integer in [0,100]; no NaN; flags always present', () => {
    fc.assert(
      fc.property(fc.array(memberArb, { maxLength: 30 }), (members) => {
        const results = computeOpportunity(members);
        expect(results).toHaveLength(members.length);
        for (const r of results) {
          if (r.opportunityIndex === null) {
            expect(r.suppressed).toBe(true);
          } else {
            expect(Number.isInteger(r.opportunityIndex)).toBe(true);
            expect(r.opportunityIndex).toBeGreaterThanOrEqual(0);
            expect(r.opportunityIndex).toBeLessThanOrEqual(100);
            for (const c of r.components) {
              expect(Number.isNaN(c.score)).toBe(false);
              expect(c.score).toBeGreaterThanOrEqual(0);
              expect(c.score).toBeLessThanOrEqual(100);
            }
          }
          expect(Array.isArray(r.flags)).toBe(true);
        }
      }),
    );
  });

  it('reproducible: same signals + rule_set ⇒ identical results', () => {
    fc.assert(
      fc.property(fc.array(memberArb, { maxLength: 20 }), (members) => {
        expect(computeOpportunity(members)).toEqual(computeOpportunity(members));
      }),
    );
    expect(OPPORTUNITY_RULE_SET_VERSION).toBe('opportunity-v1');
  });
});
