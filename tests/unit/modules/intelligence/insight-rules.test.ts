import { describe, expect, it } from 'vitest';
import {
  runRules,
  RULE_METRICS,
  INSIGHT_RULE_SET_VERSION,
  parseInsight,
  type MetricSnapshot,
} from '@/modules/intelligence';

// Phase P4 (8-C3) — the DETERMINISTIC insight rule catalog (§10.12). PURE: each rule fires (or not)
// exactly at its threshold with the exact severity, and every fired candidate satisfies the evidence+
// action invariant (parseInsight). No statistical anomaly, no LLM.

function reading(value: number, delta: number | null = null) {
  return { value, delta, previous: delta === null ? null : value - delta };
}
/** Fire a single rule by supplying only its metric; return the (possibly empty) candidate list. */
function fireOne(metric: keyof MetricSnapshot, value: number, delta: number | null = null) {
  return runRules({ [metric]: reading(value, delta) } as MetricSnapshot);
}

describe('runRules — threshold rules', () => {
  it('budget_risk: ≥10 warning, ≥20 critical, <10 no-fire', () => {
    expect(fireOne('budget_variance', 5)).toHaveLength(0);
    const warn = fireOne('budget_variance', 12);
    expect(warn).toHaveLength(1);
    expect(warn[0]).toMatchObject({ insightType: 'budget_risk', severity: 'warning', subjectType: 'organization', subjectId: null });
    expect(warn[0]!.deterministicFacts).toMatchObject({ metric: 'budget_variance', value: 12, ruleSetVersion: INSIGHT_RULE_SET_VERSION });
    expect(fireOne('budget_variance', 20)[0]!.severity).toBe('critical');
  });
  it('dispute_concentration: ≥20 warning, ≥40 critical', () => {
    expect(fireOne('dispute_rate', 19)).toHaveLength(0);
    expect(fireOne('dispute_rate', 20)[0]).toMatchObject({ insightType: 'dispute_concentration', severity: 'warning' });
    expect(fireOne('dispute_rate', 40)[0]!.severity).toBe('critical');
  });
  it('concentration_change: HHI ≥0.5 warning, ≥0.7 critical', () => {
    expect(fireOne('payout_concentration', 0.49)).toHaveLength(0);
    expect(fireOne('payout_concentration', 0.5)[0]).toMatchObject({ insightType: 'concentration_change', severity: 'warning' });
    expect(fireOne('payout_concentration', 0.7)[0]!.severity).toBe('critical');
  });
  it('threshold_breach (gaming): ≥15 warning, ≥30 critical', () => {
    expect(fireOne('gaming_flag_rate', 14)).toHaveLength(0);
    expect(fireOne('gaming_flag_rate', 15)[0]).toMatchObject({ insightType: 'threshold_breach', severity: 'warning' });
    expect(fireOne('gaming_flag_rate', 30)[0]!.severity).toBe('critical');
  });
});

describe('runRules — delta rules (need a previous-period comparison)', () => {
  it('cycle_slowdown: fires on a DROP ≤ −15 pts, critical ≤ −30; a rise / small drop / null delta no-fire', () => {
    expect(fireOne('cycle_completion_rate', 90, null)).toHaveLength(0); // no comparison → no fire
    expect(fireOne('cycle_completion_rate', 88, -5)).toHaveLength(0); // small drop
    expect(fireOne('cycle_completion_rate', 80, 10)).toHaveLength(0); // improvement
    const warn = fireOne('cycle_completion_rate', 60, -20);
    expect(warn[0]).toMatchObject({ insightType: 'cycle_slowdown', severity: 'warning' });
    expect(warn[0]!.deterministicFacts).toMatchObject({ current: 60, previous: 80, delta: -20 });
    expect(fireOne('cycle_completion_rate', 50, -35)[0]!.severity).toBe('critical');
  });
  it('significant_delta (override rise): fires on ≥ +15 pts, critical ≥ +30; a drop / null delta no-fire', () => {
    expect(fireOne('manual_override_rate', 40, null)).toHaveLength(0);
    expect(fireOne('manual_override_rate', 30, 5)).toHaveLength(0);
    expect(fireOne('manual_override_rate', 40, 20)[0]).toMatchObject({ insightType: 'significant_delta', severity: 'warning' });
    expect(fireOne('manual_override_rate', 50, 35)[0]!.severity).toBe('critical');
  });
});

describe('runRules — composition + invariants', () => {
  it('an empty snapshot fires nothing (a missing metric never fabricates a value)', () => {
    expect(runRules({})).toEqual([]);
  });
  it('runs the whole catalog: all 6 rules fire together when every metric breaches', () => {
    const all: MetricSnapshot = {
      budget_variance: reading(25),
      cycle_completion_rate: reading(50, -35),
      dispute_rate: reading(45),
      payout_concentration: reading(0.8),
      manual_override_rate: reading(50, 35),
      gaming_flag_rate: reading(40),
    };
    const fired = runRules(all);
    expect(fired.map((c) => c.insightType).sort()).toEqual(
      ['budget_risk', 'concentration_change', 'cycle_slowdown', 'dispute_concentration', 'significant_delta', 'threshold_breach'].sort(),
    );
  });
  it('every fired candidate satisfies the evidence+action invariant (parseInsight passes)', () => {
    const fired = runRules({ budget_variance: reading(30), gaming_flag_rate: reading(40) });
    expect(fired.length).toBeGreaterThan(0);
    for (const c of fired) {
      expect(c.evidence.length).toBeGreaterThanOrEqual(1);
      expect(c.suggestedActions.length).toBeGreaterThanOrEqual(1);
      expect(() =>
        parseInsight({
          id: '00000000-0000-0000-0000-000000000000',
          type: c.insightType,
          severity: c.severity,
          headline: c.headline,
          deterministicFacts: c.deterministicFacts,
          evidence: c.evidence,
          suggestedActions: c.suggestedActions,
          generatedAt: '2026-01-01T00:00:00.000Z',
        }),
      ).not.toThrow();
    }
  });
  it('RULE_METRICS lists exactly the 6 metrics the engine must read', () => {
    expect([...RULE_METRICS].sort()).toEqual(
      ['budget_variance', 'cycle_completion_rate', 'dispute_rate', 'gaming_flag_rate', 'manual_override_rate', 'payout_concentration'].sort(),
    );
  });
});
