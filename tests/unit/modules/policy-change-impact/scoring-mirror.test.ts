import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { scoreTask, type ScoringInputs, type ScoringPolicy } from '@/modules/policy-change-impact';

// The standard published multipliers (seed d2 / doc-04) the DB engine (0020) uses.
const POLICY: ScoringPolicy = {
  multipliers: {
    complexity: { low: 1.0, medium: 1.25, high: 1.5, critical: 2.0 },
    impact: { low: 1.0, medium: 1.2, high: 1.5, strategic: 2.0 },
    quality: { acceptable: 0.75, good: 1.0, excellent: 1.25, poor: 0 },
    timeliness: { early: 1.1, on_time: 1.0, late_minor: 0.85, late_major: 0.5 },
  },
  revisionPenaltyRule: { rate_per_revision: 0.05, cap: 0.25 },
};

const base = (o: Partial<ScoringInputs>): ScoringInputs => ({
  basePoints: 100,
  complexity: 'low',
  impact: 'low',
  quality: 'good',
  timeliness: 'on_time',
  revisionCount: 0,
  ...o,
});

describe('scoreTask — parity with the 0020 DB engine (compute_final_points)', () => {
  it('golden: base 1000, low/low/good/on_time, rev 0 → 1000 (final = base)', () => {
    expect(scoreTask(base({ basePoints: 1000 }), POLICY)).toBe(1000);
  });

  it('golden: base 100, medium/high/good/on_time, rev 0 → 187.5 (the value 0020 cites)', () => {
    expect(scoreTask(base({ complexity: 'medium', impact: 'high' }), POLICY)).toBe(187.5);
  });

  it('revision penalty: rev 2 → penalty 0.10 → base × 0.90', () => {
    expect(scoreTask(base({ revisionCount: 2 }), POLICY)).toBe(90);
  });

  it('revision penalty is capped: rev 10 (0.50) → capped at 0.25 → base × 0.75', () => {
    expect(scoreTask(base({ revisionCount: 10 }), POLICY)).toBe(75);
  });

  it('quality=poor multiplier 0 → final 0', () => {
    expect(scoreTask(base({ quality: 'poor', basePoints: 500 }), POLICY)).toBe(0);
  });

  it('defaults rate 0.05 / cap 0.25 when the penalty rule is empty (0020 coalesce)', () => {
    const noRule: ScoringPolicy = { multipliers: POLICY.multipliers, revisionPenaltyRule: {} };
    expect(scoreTask(base({ revisionCount: 3 }), noRule)).toBe(85); // 100 × (1 − 0.15)
  });

  it('missing multiplier level → null (mirrors DB NULL; unscoreable under this policy)', () => {
    expect(scoreTask(base({ complexity: 'epic' }), POLICY)).toBeNull();
  });

  // ---- property tests ----
  const level = fc.constantFrom('low', 'medium', 'high');
  const inputArb = fc.record({
    basePoints: fc.integer({ min: 0, max: 100000 }),
    complexity: level,
    impact: level,
    quality: fc.constantFrom('acceptable', 'good', 'excellent'),
    timeliness: fc.constantFrom('early', 'on_time', 'late_minor'),
    revisionCount: fc.integer({ min: 0, max: 20 }),
  }) as fc.Arbitrary<ScoringInputs>;

  it('property: deterministic — same inputs → same output', () => {
    fc.assert(
      fc.property(inputArb, (i) => {
        expect(scoreTask(i, POLICY)).toBe(scoreTask({ ...i }, POLICY));
      }),
    );
  });

  it('property: linear in basePoints (scoreTask(k·base) = k·scoreTask(base))', () => {
    fc.assert(
      fc.property(inputArb, fc.integer({ min: 1, max: 50 }), (i, k) => {
        const one = scoreTask({ ...i, basePoints: 1 }, POLICY);
        const scaled = scoreTask({ ...i, basePoints: k }, POLICY);
        if (one === null || scaled === null) return;
        expect(scaled).toBeCloseTo(k * one, 6);
      }),
    );
  });

  it('property: penalty never exceeds the cap → result ≥ base × (1 − cap) × (min multipliers)', () => {
    fc.assert(
      fc.property(inputArb, (i) => {
        const r = scoreTask(i, POLICY);
        if (r === null) return;
        expect(r).toBeGreaterThanOrEqual(0); // multipliers ≥ 0, penalty ≤ cap < 1
      }),
    );
  });
});
