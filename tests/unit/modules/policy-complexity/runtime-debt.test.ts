import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  evaluateStaticComplexity,
  evaluateRuntimeComplexity,
  computeDebtEvaluation,
  computeVersionTrend,
  findSimplificationCandidates,
  RUNTIME_RULES,
  RUNTIME_RULE_SET_VERSION,
  FULL_RULE_SET_VERSION,
  type RuntimeSignals,
  type ScoringPolicyConfig,
  type BucketUsage,
} from '@/modules/policy-complexity';

const SIGNALS = (o: Partial<RuntimeSignals> = {}): RuntimeSignals => ({
  overrideCount: 0,
  recalculationCount: 0,
  taskApprovedCount: 0,
  ...o,
});
function driver(components: { code: string; impact: number; value: number }[], code: string) {
  return components.find((d) => d.code === code);
}

describe('evaluateRuntimeComplexity (§6.5)', () => {
  it('golden: weighted sum with transparent drivers + scored-volume context', () => {
    const res = evaluateRuntimeComplexity(
      SIGNALS({ overrideCount: 2, recalculationCount: 1, taskApprovedCount: 100 }),
    );
    // 2×3 + 1×4 = 10.
    expect(res.runtimeScore).toBe(10);
    expect(res.ruleSetVersion).toBe(RUNTIME_RULE_SET_VERSION);
    expect(driver(res.components, 'override_usage')).toMatchObject({ value: 2, impact: 6 });
    expect(driver(res.components, 'recalculation')).toMatchObject({ value: 1, impact: 4 });
    expect(driver(res.components, 'scored_volume')).toMatchObject({ value: 100, impact: 0 });
    expect(res.components.reduce((s, d) => s + d.impact, 0)).toBe(res.runtimeScore);
  });

  it('no operational signals → runtime score 0', () => {
    expect(evaluateRuntimeComplexity(SIGNALS()).runtimeScore).toBe(0);
  });

  it('reproducible: same signals → identical result', () => {
    const s = SIGNALS({ overrideCount: 5, recalculationCount: 2 });
    expect(evaluateRuntimeComplexity(s)).toEqual(evaluateRuntimeComplexity({ ...s }));
  });

  it('exposes the versioned runtime rule catalog (§3.5)', () => {
    expect(RUNTIME_RULES.length).toBeGreaterThanOrEqual(2);
    for (const r of RUNTIME_RULES) {
      expect(r.id).toBeTruthy();
      expect(r.rationale.length).toBeGreaterThan(0);
    }
  });

  const signalArb = fc.record({
    overrideCount: fc.nat({ max: 1000 }),
    recalculationCount: fc.nat({ max: 1000 }),
    taskApprovedCount: fc.nat({ max: 10000 }),
  });

  it('property: finite, non-negative, no NaN', () => {
    fc.assert(
      fc.property(signalArb, (s) => {
        const res = evaluateRuntimeComplexity(s);
        expect(Number.isFinite(res.runtimeScore)).toBe(true);
        expect(res.runtimeScore).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('property: monotonic in override count', () => {
    fc.assert(
      fc.property(signalArb, (s) => {
        const base = evaluateRuntimeComplexity(s).runtimeScore;
        const more = evaluateRuntimeComplexity({ ...s, overrideCount: s.overrideCount + 1 }).runtimeScore;
        expect(more).toBeGreaterThan(base);
      }),
    );
  });
});

describe('computeDebtEvaluation (§6.6)', () => {
  const CONFIG: ScoringPolicyConfig = {
    multipliers: { complexity: { low: 1.0, high: 1.5 } },
    revisionPenaltyRule: {},
    timelinessThresholds: {},
  };

  it('debt total = static + runtime; drivers are concatenated (no opaque aggregate)', () => {
    const staticRes = evaluateStaticComplexity(CONFIG);
    const runtimeRes = evaluateRuntimeComplexity(SIGNALS({ overrideCount: 2 }));
    const debt = computeDebtEvaluation(staticRes, runtimeRes);
    expect(debt.ruleSetVersion).toBe(FULL_RULE_SET_VERSION);
    expect(debt.staticScore).toBe(staticRes.staticScore);
    expect(debt.runtimeScore).toBe(runtimeRes.runtimeScore);
    expect(debt.totalScore).toBe(staticRes.staticScore + runtimeRes.runtimeScore);
    expect(debt.components).toHaveLength(staticRes.components.length + runtimeRes.components.length);
    expect(debt.components.reduce((s, d) => s + d.impact, 0)).toBe(debt.totalScore);
  });
});

describe('computeVersionTrend (§6.7)', () => {
  it('sorts by version_no and computes per-version deltas', () => {
    const trend = computeVersionTrend([
      { policyVersionId: 'v2', versionNo: 2, staticScore: 30, runtimeScore: 12, totalScore: 42 },
      { policyVersionId: 'v1', versionNo: 1, staticScore: 30, runtimeScore: 0, totalScore: 30 },
      { policyVersionId: 'v3', versionNo: 3, staticScore: 28, runtimeScore: 12, totalScore: 40 },
    ]);
    expect(trend.map((t) => t.versionNo)).toEqual([1, 2, 3]);
    expect(trend.map((t) => t.deltaTotal)).toEqual([0, 12, -2]);
  });
});

describe('findSimplificationCandidates (§6.8) — advisory, deterministic', () => {
  it('duplicate_outcome: buckets sharing a multiplier are flagged', () => {
    const config: ScoringPolicyConfig = {
      multipliers: { complexity: { low: 1.0, medium: 1.0, high: 1.5 } },
      revisionPenaltyRule: {},
      timelinessThresholds: {},
    };
    const cands = findSimplificationCandidates(config, {});
    const dup = cands.find((c) => c.kind === 'duplicate_outcome');
    expect(dup).toBeTruthy();
    expect(dup!.buckets).toEqual(['low', 'medium']);
  });

  it('unused_bucket: a config bucket absent from usage is flagged (only when usage exists)', () => {
    const config: ScoringPolicyConfig = {
      multipliers: { complexity: { low: 1.0, high: 1.5 } },
      revisionPenaltyRule: {},
      timelinessThresholds: {},
    };
    const usage: BucketUsage = { complexity: ['low'] };
    const cands = findSimplificationCandidates(config, usage);
    const unused = cands.find((c) => c.kind === 'unused_bucket');
    expect(unused).toBeTruthy();
    expect(unused!.buckets).toEqual(['high']);
  });

  it('no false-positive unused when there is no usage data', () => {
    const config: ScoringPolicyConfig = {
      multipliers: { complexity: { low: 1.0, high: 1.5 } },
      revisionPenaltyRule: {},
      timelinessThresholds: {},
    };
    expect(findSimplificationCandidates(config, {}).some((c) => c.kind === 'unused_bucket')).toBe(false);
  });

  it('reproducible + stably ordered', () => {
    const config: ScoringPolicyConfig = {
      multipliers: { complexity: { low: 1.0, medium: 1.0 }, impact: { a: 2, b: 2 } },
      revisionPenaltyRule: {},
      timelinessThresholds: {},
    };
    expect(findSimplificationCandidates(config, {})).toEqual(findSimplificationCandidates(config, {}));
  });
});
