import { describe, expect, it } from 'vitest';
import {
  runBacktest,
  type ReferenceDataset,
  type ScoringPolicy,
} from '@/modules/policy-change-impact';

const D2: ScoringPolicy = {
  multipliers: {
    complexity: { low: 1.0, medium: 1.25, high: 1.5, critical: 2.0 },
    impact: { low: 1.0, medium: 1.2, high: 1.5, strategic: 2.0 },
    quality: { acceptable: 0.75, good: 1.0, excellent: 1.25, poor: 0 },
    timeliness: { early: 1.1, on_time: 1.0, late_minor: 0.85, late_major: 0.5 },
  },
  revisionPenaltyRule: { rate_per_revision: 0.05, cap: 0.25 },
};

// The seeded Org C worked example: Ali 1000 / Ayşe 1000 / Mehmet 300 / Zeynep 847 (all low/low/good/
// on_time), pool 10,000,000 kuruş, T=1, cap basis 10,000,000 (non-binding). This reproduces doc-05 §8.
function orgCDataset(): ReferenceDataset {
  const emp = (id: string) => ({
    employeeId: id,
    eligibilityFactor: 1,
    prorataFactor: 1,
    capBasisMinor: 10_000_000,
  });
  const task = (id: string, basePoints: number) => ({
    employeeId: id,
    inputs: { basePoints, complexity: 'low', impact: 'low', quality: 'good', timeliness: 'on_time', revisionCount: 0 },
  });
  return {
    tasks: [task('ali', 1000), task('ayse', 1000), task('mehmet', 300), task('zeynep', 847)],
    employees: [emp('ali'), emp('ayse'), emp('mehmet'), emp('zeynep')],
    pool: { amountMinor: 10_000_000, tOrg: 1, topUpApproved: false, capRate: 0.5 },
  };
}

describe('runBacktest — deterministic, reproducible, reuses allocateBonus', () => {
  it('from-side reproduces the live 0021 worked example (Ali = 3,177,630)', () => {
    const res = runBacktest(orgCDataset(), D2, D2);
    const ali = res.distribution.find((d) => d.employeeId === 'ali');
    expect(ali?.fromMinor).toBe(3_177_630);
    // The full doc-05 §8 distribution: Ali 3,177,630 / Ayşe 3,177,629 / Mehmet 953,289 / Zeynep 2,691,452.
    const byId = Object.fromEntries(res.distribution.map((d) => [d.employeeId, d.fromMinor]));
    expect(byId).toEqual({ ali: 3_177_630, ayse: 3_177_629, mehmet: 953_289, zeynep: 2_691_452 });
  });

  it('from == to → every delta is 0 (no change)', () => {
    const res = runBacktest(orgCDataset(), D2, D2);
    expect(res.summary.employeesAffected).toBe(0);
    expect(res.summary.higher).toBe(0);
    expect(res.summary.lower).toBe(0);
    expect(res.summary.unchanged).toBe(4);
    expect(res.summary.budgetDeltaMinor).toBe(0);
    expect(res.summary.maxNegativeDeltaMinor).toBe(0);
    expect(res.distribution.every((d) => d.deltaMinor === 0)).toBe(true);
  });

  it('a differentiated multiplier change shifts the distribution (higher/lower + max-negative)', () => {
    const dataset: ReferenceDataset = {
      tasks: [
        { employeeId: 'e1', inputs: { basePoints: 100, complexity: 'high', impact: 'low', quality: 'good', timeliness: 'on_time', revisionCount: 0 } },
        { employeeId: 'e2', inputs: { basePoints: 100, complexity: 'low', impact: 'low', quality: 'good', timeliness: 'on_time', revisionCount: 0 } },
      ],
      employees: [
        { employeeId: 'e1', eligibilityFactor: 1, prorataFactor: 1, capBasisMinor: null },
        { employeeId: 'e2', eligibilityFactor: 1, prorataFactor: 1, capBasisMinor: null },
      ],
      pool: { amountMinor: 1_000_000, tOrg: 1, topUpApproved: false, capRate: 0.5 },
    };
    // to-version raises complexity.high 1.5 → 2.0 (affects only e1). e1 points 150→200, e2 stays 100.
    const to: ScoringPolicy = {
      multipliers: { ...D2.multipliers, complexity: { low: 1.0, medium: 1.25, high: 2.0, critical: 2.0 } },
      revisionPenaltyRule: D2.revisionPenaltyRule,
    };
    const res = runBacktest(dataset, D2, to);
    const byId = Object.fromEntries(res.distribution.map((d) => [d.employeeId, d]));
    // from: e1 = floor(1e6·150/250)=600000, e2 = floor(1e6·100/250)=400000.
    expect(byId.e1!.fromMinor).toBe(600_000);
    expect(byId.e2!.fromMinor).toBe(400_000);
    // to: e1 = floor(1e6·200/300)=666666 (+1 largest-remainder)=666667, e2 = 333333.
    expect(byId.e1!.toMinor).toBe(666_667);
    expect(byId.e2!.toMinor).toBe(333_333);
    expect(res.summary.higher).toBe(1);
    expect(res.summary.lower).toBe(1);
    expect(res.summary.employeesAffected).toBe(2);
    expect(res.summary.maxNegativeDeltaMinor).toBe(-66_667);
    // Budget is conserved (a pure re-weighting of a fixed pool).
    expect(res.summary.budgetDeltaMinor).toBe(0);
  });

  it('reproducible: same dataset + same versions → identical result', () => {
    const a = runBacktest(orgCDataset(), D2, D2);
    const b = runBacktest(orgCDataset(), D2, D2);
    expect(a).toEqual(b);
  });

  it('budget never exceeds the pool (Σ final ≤ pool amount)', () => {
    const res = runBacktest(orgCDataset(), D2, D2);
    expect(res.summary.fromBudgetMinor).toBeLessThanOrEqual(10_000_000);
    expect(res.summary.toBudgetMinor).toBeLessThanOrEqual(10_000_000);
  });

  it('throws when the to-version is incomplete (a task level is undefined)', () => {
    const dataset = orgCDataset();
    const incomplete: ScoringPolicy = {
      multipliers: { ...D2.multipliers, complexity: { medium: 1.25 } }, // no 'low' → Org C tasks unscoreable
      revisionPenaltyRule: D2.revisionPenaltyRule,
    };
    expect(() => runBacktest(dataset, D2, incomplete)).toThrow(/incomplete/);
  });
});
