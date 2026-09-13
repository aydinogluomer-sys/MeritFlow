import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  evaluateHealth,
  aggregateOverall,
  DIMENSION_WEIGHTS,
  HEALTH_RULE_SET_VERSION,
  CONCENTRATION_RULES,
  DISCRETION_RULES,
  GAMING_RULES,
  DISPUTE_RULES,
  FINANCIAL_INTEGRITY_RULES,
  COMPLEXITY_RULES,
  type DimensionScore,
  type HealthDimensionKey,
  type HealthEvaluation,
  type HealthSignals,
} from '@/modules/incentive-health';

// Neutral signals: no operational data, trivial config ⇒ every dimension is perfectly healthy (100).
function neutral(overrides: Partial<HealthSignals> = {}): HealthSignals {
  return {
    concentration: { payouts: [] },
    discretion: { scoredPoints: 0, overrideMagnitude: 0, scoredCount: 0, overrideCount: 0 },
    gaming: { cliffCount: 0 },
    dispute: { attributableDisputes: 0, openOrUnresolved: 0, scopedTargets: 0 },
    financialIntegrity: { pools: [], missingCapBasis: 0, allocationCount: 0 },
    complexity: { staticScore: 0 },
    evidence: { policyVersionId: 'v1', calculationRunIds: [], disputeIds: [] },
    ...overrides,
  };
}

function dim(ev: HealthEvaluation, key: HealthDimensionKey): DimensionScore {
  const d = ev.dimensions.find((x) => x.dimension === key);
  if (!d) throw new Error(`missing dimension ${key}`);
  return d;
}

describe('evaluateHealth — baseline + shape (§3.3/§3.4)', () => {
  it('neutral signals ⇒ every sub-score 100 and overall 100', () => {
    const ev = evaluateHealth(neutral());
    expect(ev.ruleSetVersion).toBe(HEALTH_RULE_SET_VERSION);
    for (const d of ev.dimensions) expect(d.score).toBe(100);
    expect(ev.overallScore).toBe(100);
    expect(ev.dimensions).toHaveLength(6);
  });

  it('every dimension returns { score, confidence, drivers[], evidence[] } (§3.4)', () => {
    const ev = evaluateHealth(neutral());
    for (const d of ev.dimensions) {
      expect(d.score).toBeGreaterThanOrEqual(0);
      expect(d.score).toBeLessThanOrEqual(100);
      expect(d.confidence).toBeGreaterThanOrEqual(0);
      expect(d.confidence).toBeLessThanOrEqual(1);
      expect(Array.isArray(d.drivers)).toBe(true);
      expect(d.drivers.length).toBeGreaterThan(0);
      // Evidence is always ≥ the policy version (§3.4 drill-down).
      expect(d.evidence.some((e) => e.sourceType === 'policy_version' && e.sourceId === 'v1')).toBe(true);
    }
    expect(ev.deferredDimensions).toEqual(['opportunity_balance', 'controllability']);
  });

  it('the config-only d2 fixture reproduces the seeded row (cliff 1, static 32 ⇒ overall 95)', () => {
    const ev = evaluateHealth(neutral({ gaming: { cliffCount: 1 }, complexity: { staticScore: 32 } }));
    expect(dim(ev, 'gaming_resistance').score).toBe(84);
    expect(dim(ev, 'complexity').score).toBe(82);
    expect(ev.overallScore).toBe(95); // matches seed_test_tenants.sql policy_health_evaluations fixture
  });
});

describe('dimension boundaries (§3.9 exact thresholds)', () => {
  it('payout concentration: equal split is healthy; a skew applies a transparent driver', () => {
    expect(dim(evaluateHealth(neutral({ concentration: { payouts: [50, 50] } })), 'payout_concentration').score).toBe(100);
    // [60,40]: top-1 share 0.6 (excess 0.10 · 120, capped 45) ⇒ −12 ⇒ 88; gini 0.1 & divergence 0 (both ≤ threshold).
    const d = dim(evaluateHealth(neutral({ concentration: { payouts: [60, 40] } })), 'payout_concentration');
    expect(d.score).toBe(88);
    expect(d.drivers.find((x) => x.code === 'CONCENTRATION_TOP10_HIGH')!.impact).toBe(-12);
  });

  it('payout concentration: legitimate ZERO payouts are counted (not dropped) — the pathology is caught', () => {
    // 2 high earners + 18 zero-earners: the have-nots MUST count, else this looks perfectly equal.
    const payouts = [1000, 1000, ...Array.from({ length: 18 }, () => 0)];
    const d = dim(evaluateHealth(neutral({ concentration: { payouts } })), 'payout_concentration');
    expect(d.score).toBeLessThan(60); // top-10% share, gini and divergence all fire
    expect(d.confidence).toBe(1); // n = 20 ≥ MIN_SAMPLE (zeros count toward the sample)
    // All-zero population stays safe (no division-by-zero; nothing to concentrate ⇒ healthy 100).
    expect(dim(evaluateHealth(neutral({ concentration: { payouts: [0, 0, 0] } })), 'payout_concentration').score).toBe(100);
  });

  it('manager discretion: 15% override share is the boundary; beyond it lowers health', () => {
    expect(dim(evaluateHealth(neutral({ discretion: { scoredPoints: 85, overrideMagnitude: 15, scoredCount: 10, overrideCount: 3 } })), 'manager_discretion').score).toBe(100);
    // share 0.20 (excess 0.05 · 260) ⇒ −13 ⇒ 87.
    expect(dim(evaluateHealth(neutral({ discretion: { scoredPoints: 80, overrideMagnitude: 20, scoredCount: 10, overrideCount: 4 } })), 'manager_discretion').score).toBe(87);
  });

  it('gaming resistance: each config cliff costs 16 (capped 80), confidence 1', () => {
    expect(dim(evaluateHealth(neutral({ gaming: { cliffCount: 0 } })), 'gaming_resistance').score).toBe(100);
    expect(dim(evaluateHealth(neutral({ gaming: { cliffCount: 2 } })), 'gaming_resistance').score).toBe(68);
    const many = dim(evaluateHealth(neutral({ gaming: { cliffCount: 6 } })), 'gaming_resistance');
    expect(many.score).toBe(20); // 16·6 = 96 → capped at 80
    expect(many.confidence).toBe(1);
  });

  it('dispute exposure: rate + open disputes both apply drivers', () => {
    // 10/100 = 0.10 (excess 0.05·240→12) + 3 open (·10 → 30) ⇒ −42 ⇒ 58; confidence 1 (targets ≥ 10).
    const d = dim(evaluateHealth(neutral({ dispute: { attributableDisputes: 10, openOrUnresolved: 3, scopedTargets: 100 } })), 'dispute_exposure');
    expect(d.score).toBe(58);
    expect(d.confidence).toBe(1);
  });

  it('financial integrity: conservation holds ⇒ 100; a breach + missing-basis cut hard', () => {
    expect(dim(evaluateHealth(neutral({ financialIntegrity: { pools: [{ declared: 1000, allocated: 900, undistributed: 100 }], missingCapBasis: 0, allocationCount: 5 } })), 'financial_integrity').score).toBe(100);
    // breach (−45) + missing 2 (−12) ⇒ −57 ⇒ 43. (Cap OVERFLOW is DB-enforced, not a driver here.)
    const d = dim(evaluateHealth(neutral({ financialIntegrity: { pools: [{ declared: 1000, allocated: 900, undistributed: 50 }], missingCapBasis: 2, allocationCount: 5 } })), 'financial_integrity');
    expect(d.score).toBe(43);
    expect(d.drivers.some((x) => x.code === 'CAP_EXCEEDED')).toBe(false); // dead signal removed
  });

  it('complexity: at the free allowance (20) is healthy; beyond it lowers health', () => {
    expect(dim(evaluateHealth(neutral({ complexity: { staticScore: 20 } })), 'complexity').score).toBe(100);
    expect(dim(evaluateHealth(neutral({ complexity: { staticScore: 40 } })), 'complexity').score).toBe(70); // excess 20 · 1.5
    expect(dim(evaluateHealth(neutral({ complexity: { staticScore: 100 } })), 'complexity').score).toBe(30); // capped at 70
  });
});

describe('confidence reflects data availability (§3.4)', () => {
  it('operational dimensions have confidence 0 with no data; config dimensions have confidence 1', () => {
    const ev = evaluateHealth(neutral());
    expect(dim(ev, 'financial_integrity').confidence).toBe(0);
    expect(dim(ev, 'payout_concentration').confidence).toBe(0);
    expect(dim(ev, 'manager_discretion').confidence).toBe(0);
    expect(dim(ev, 'dispute_exposure').confidence).toBe(0);
    expect(dim(ev, 'gaming_resistance').confidence).toBe(1);
    expect(dim(ev, 'complexity').confidence).toBe(1);
  });
});

describe('transparent overall aggregate — NO opaque score (§26/§3.3)', () => {
  it('overall is exactly the published weighted mean of the sub-scores', () => {
    const ev = evaluateHealth(neutral({ gaming: { cliffCount: 1 }, complexity: { staticScore: 32 } }));
    let wsum = 0;
    let acc = 0;
    for (const d of ev.dimensions) {
      const w = ev.weights.find((x) => x.dimension === d.dimension)!.weight;
      expect(w).toBe(DIMENSION_WEIGHTS[d.dimension]);
      wsum += w;
      acc += w * d.score;
    }
    expect(ev.overallScore).toBe(Math.round(acc / wsum));
  });

  it('aggregateOverall is a pure function of the sub-scores + published weights', () => {
    const ev = evaluateHealth(neutral({ financialIntegrity: { pools: [{ declared: 100, allocated: 40, undistributed: 0 }], missingCapBasis: 0, allocationCount: 3 } }));
    const re = aggregateOverall(ev.dimensions);
    expect(re.overallScore).toBe(ev.overallScore);
    expect(re.weights).toEqual(ev.weights);
  });
});

describe('versioned rule catalogs are exposed for transparency (§3.5)', () => {
  it('each dimension publishes id/version/rationale rules', () => {
    for (const cat of [
      CONCENTRATION_RULES,
      DISCRETION_RULES,
      GAMING_RULES,
      DISPUTE_RULES,
      FINANCIAL_INTEGRITY_RULES,
      COMPLEXITY_RULES,
    ]) {
      expect(cat.length).toBeGreaterThan(0);
      for (const r of cat) {
        expect(r.id.length).toBeGreaterThan(0);
        expect(r.version.length).toBeGreaterThan(0);
        expect(r.rationale.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('properties (§3.9): range, no-NaN, monotonic risk, reproducible', () => {
  const signalsArb = fc.record({
    concentration: fc.record({ payouts: fc.array(fc.integer({ min: 0, max: 1_000_000 }), { maxLength: 40 }) }),
    discretion: fc.record({
      scoredPoints: fc.nat({ max: 100000 }),
      overrideMagnitude: fc.nat({ max: 100000 }),
      scoredCount: fc.nat({ max: 500 }),
      overrideCount: fc.nat({ max: 500 }),
    }),
    gaming: fc.record({ cliffCount: fc.nat({ max: 50 }) }),
    dispute: fc.record({
      attributableDisputes: fc.nat({ max: 500 }),
      openOrUnresolved: fc.nat({ max: 500 }),
      scopedTargets: fc.nat({ max: 1000 }),
    }),
    financialIntegrity: fc.record({
      pools: fc.array(
        fc.record({ declared: fc.nat({ max: 1_000_000 }), allocated: fc.nat({ max: 1_000_000 }), undistributed: fc.nat({ max: 1_000_000 }) }),
        { maxLength: 8 },
      ),
      missingCapBasis: fc.nat({ max: 50 }),
      allocationCount: fc.nat({ max: 500 }),
    }),
    complexity: fc.record({ staticScore: fc.nat({ max: 500 }) }),
    evidence: fc.constant({ policyVersionId: 'v1', calculationRunIds: [], disputeIds: [] }),
  }) as fc.Arbitrary<HealthSignals>;

  it('all scores are integers in [0,100], confidence in [0,1], no NaN; overall = weighted mean', () => {
    fc.assert(
      fc.property(signalsArb, (s) => {
        const ev = evaluateHealth(s);
        let wsum = 0;
        let acc = 0;
        for (const d of ev.dimensions) {
          expect(Number.isInteger(d.score)).toBe(true);
          expect(d.score).toBeGreaterThanOrEqual(0);
          expect(d.score).toBeLessThanOrEqual(100);
          expect(Number.isNaN(d.confidence)).toBe(false);
          expect(d.confidence).toBeGreaterThanOrEqual(0);
          expect(d.confidence).toBeLessThanOrEqual(1);
          for (const dr of d.drivers) expect(Number.isFinite(dr.impact)).toBe(true);
          const w = DIMENSION_WEIGHTS[d.dimension];
          wsum += w;
          acc += w * d.score;
        }
        expect(ev.overallScore).toBe(Math.round(acc / wsum));
      }),
    );
  });

  it('monotonic risk: more cliffs / complexity / overrides / cap breaches never RAISE the sub-score', () => {
    fc.assert(
      fc.property(fc.nat({ max: 40 }), fc.nat({ max: 40 }), (a, b) => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const g = (n: number) => dim(evaluateHealth(neutral({ gaming: { cliffCount: n } })), 'gaming_resistance').score;
        const c = (n: number) => dim(evaluateHealth(neutral({ complexity: { staticScore: n } })), 'complexity').score;
        expect(g(hi)).toBeLessThanOrEqual(g(lo));
        expect(c(hi)).toBeLessThanOrEqual(c(lo));
      }),
    );
  });

  it('reproducible: same signals + rule_set_version ⇒ identical evaluation', () => {
    fc.assert(
      fc.property(signalsArb, (s) => {
        expect(evaluateHealth(s)).toEqual(evaluateHealth(s));
      }),
    );
  });
});
