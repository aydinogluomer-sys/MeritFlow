import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  evaluateStaticComplexity,
  configFromVersionRow,
  RULE_SET_VERSION,
  COMPLEXITY_RULES,
  type ScoringPolicyConfig,
} from '@/modules/policy-complexity';

// The standard seed d2 config (doc-04 multipliers).
const D2: ScoringPolicyConfig = {
  multipliers: {
    complexity: { low: 1.0, medium: 1.25, high: 1.5, critical: 2.0 },
    impact: { low: 1.0, medium: 1.2, high: 1.5, strategic: 2.0 },
    quality: { acceptable: 0.75, good: 1.0, excellent: 1.25, poor: 0 },
    timeliness: { early: 1.1, on_time: 1.0, late_minor: 0.85, late_major: 0.5 },
  },
  revisionPenaltyRule: { rate_per_revision: 0.05, cap: 0.25 },
  timelinessThresholds: {},
};

function clone(c: ScoringPolicyConfig): ScoringPolicyConfig {
  return JSON.parse(JSON.stringify(c)) as ScoringPolicyConfig;
}
function driver(res: ReturnType<typeof evaluateStaticComplexity>, code: string) {
  return res.components.find((d) => d.code === code);
}

describe('evaluateStaticComplexity (§6.2/§6.3/§6.4)', () => {
  it('golden: the standard d2 config scores 32 with a transparent driver breakdown', () => {
    const res = evaluateStaticComplexity(D2);
    expect(res.ruleSetVersion).toBe('static-v1');
    expect(res.staticScore).toBe(32);
    // dimensions 4×2=8, buckets 16×1=16, 1 cliff ×5=5, penalty ×3=3, thresholds 0.
    expect(driver(res, 'dimension_count')).toMatchObject({ value: 4, impact: 8 });
    expect(driver(res, 'bucket_count')).toMatchObject({ value: 16, impact: 16 });
    expect(driver(res, 'threshold_cliffs')).toMatchObject({ value: 1, impact: 5, threshold: 2 });
    expect(driver(res, 'revision_penalty')).toMatchObject({ value: 1, impact: 3 });
    expect(driver(res, 'timeliness_threshold_count')).toMatchObject({ value: 0, impact: 0 });
    // static_score is exactly the sum of the driver impacts (no opaque aggregate).
    expect(res.components.reduce((s, d) => s + d.impact, 0)).toBe(res.staticScore);
  });

  it('a linear/simple policy scores far lower than a rich one', () => {
    const simple: ScoringPolicyConfig = {
      multipliers: { complexity: { low: 1.0, high: 1.1 } },
      revisionPenaltyRule: {},
      timelinessThresholds: {},
    };
    const res = evaluateStaticComplexity(simple);
    // dimension 1×2=2, buckets 2×1=2, no cliffs, no penalty, no thresholds = 4.
    expect(res.staticScore).toBe(4);
    expect(res.staticScore).toBeLessThan(evaluateStaticComplexity(D2).staticScore);
  });

  it('detects a steep multiplier cliff (ratio ≥ 2×)', () => {
    const cliff: ScoringPolicyConfig = {
      multipliers: { complexity: { low: 1.0, huge: 5.0 } }, // 5/1 = 5 ≥ 2 → cliff
      revisionPenaltyRule: {},
      timelinessThresholds: {},
    };
    expect(driver(evaluateStaticComplexity(cliff), 'threshold_cliffs')).toMatchObject({ value: 1 });
  });

  it('detects a zero-multiplier bucket as a cliff (0 → positive)', () => {
    const zero: ScoringPolicyConfig = {
      multipliers: { quality: { poor: 0, good: 1.0 } },
      revisionPenaltyRule: {},
      timelinessThresholds: {},
    };
    expect(driver(evaluateStaticComplexity(zero), 'threshold_cliffs')).toMatchObject({ value: 1 });
  });

  it('counts custom timeliness thresholds', () => {
    const withThresholds: ScoringPolicyConfig = {
      multipliers: {},
      revisionPenaltyRule: {},
      timelinessThresholds: { grace_days: 3, hard_cutoff: 10 },
    };
    expect(driver(evaluateStaticComplexity(withThresholds), 'timeliness_threshold_count')).toMatchObject(
      { value: 2 },
    );
  });

  it('reproducible: same config → identical score + drivers', () => {
    expect(evaluateStaticComplexity(D2)).toEqual(evaluateStaticComplexity(clone(D2)));
  });

  it('exposes the versioned rule catalog (id/version/rationale — §3.5)', () => {
    expect(COMPLEXITY_RULES.length).toBeGreaterThanOrEqual(5);
    for (const r of COMPLEXITY_RULES) {
      expect(r.id).toBeTruthy();
      expect(r.version).toBeTruthy();
      expect(r.rationale.length).toBeGreaterThan(0);
    }
  });

  it('configFromVersionRow ignores non-config columns', () => {
    const row = {
      id: 'x',
      version_no: 7,
      status: 'published',
      notes: 'meta',
      multipliers: D2.multipliers,
      revision_penalty_rule: D2.revisionPenaltyRule,
      timeliness_thresholds: D2.timelinessThresholds,
    };
    expect(evaluateStaticComplexity(configFromVersionRow(row)).staticScore).toBe(32);
  });

  // ---- property tests ----
  const level = fc.constantFrom('low', 'medium', 'high', 'critical', 'a', 'b', 'c');
  const bucketTable = fc.dictionary(level, fc.double({ min: 0, max: 5, noNaN: true, noDefaultInfinity: true }));
  const configArb = fc.record({
    multipliers: fc.dictionary(fc.constantFrom('complexity', 'impact', 'quality', 'timeliness'), bucketTable),
    revisionPenaltyRule: fc.constantFrom({}, { rate_per_revision: 0.05, cap: 0.25 }, { rate_per_revision: 0 }),
    timelinessThresholds: fc.dictionary(fc.constantFrom('g', 'h'), fc.integer()),
  }) as fc.Arbitrary<ScoringPolicyConfig>;

  it('property: score is a finite non-negative number with no NaN; RULE_SET_VERSION stable', () => {
    fc.assert(
      fc.property(configArb, (cfg) => {
        const res = evaluateStaticComplexity(cfg);
        expect(Number.isFinite(res.staticScore)).toBe(true);
        expect(Number.isNaN(res.staticScore)).toBe(false);
        expect(res.staticScore).toBeGreaterThanOrEqual(0);
        expect(res.ruleSetVersion).toBe(RULE_SET_VERSION);
        for (const d of res.components) expect(Number.isFinite(d.impact)).toBe(true);
      }),
    );
  });

  it('property: adding a NEW dimension never decreases the score (monotonic)', () => {
    fc.assert(
      fc.property(configArb, (cfg) => {
        const base = evaluateStaticComplexity(cfg).staticScore;
        const withExtra = clone(cfg);
        (withExtra.multipliers as Record<string, unknown>).extra_dimension = { low: 1, high: 1.2 };
        expect(evaluateStaticComplexity(withExtra).staticScore).toBeGreaterThanOrEqual(base);
      }),
    );
  });
});
