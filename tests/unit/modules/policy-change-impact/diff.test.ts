import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  diffPolicyVersions,
  configFromVersionRow,
  type JsonValue,
  type PolicyVersionConfig,
} from '@/modules/policy-change-impact';

// A representative baseline config (shape of scoring_policy_versions' three diffable sections).
const BASE: PolicyVersionConfig = {
  multipliers: {
    complexity: { low: 1.0, medium: 1.25, high: 1.5, critical: 2.0 },
    quality: { acceptable: 0.75, good: 1.0, excellent: 1.25, poor: 0 },
    timeliness: { early: 1.1, on_time: 1.0 },
  },
  revisionPenaltyRule: { rate_per_revision: 0.05, cap: 0.25 },
  timelinessThresholds: { grace_days: 3 },
};

function clone(c: PolicyVersionConfig): PolicyVersionConfig {
  return JSON.parse(JSON.stringify(c)) as PolicyVersionConfig;
}

/** Deep clone re-inserting object keys in reverse-sorted order (proves order-independence). */
function reorderKeys(v: JsonValue): JsonValue {
  if (Array.isArray(v)) return v.map(reorderKeys);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const k of Object.keys(v).sort().reverse()) out[k] = reorderKeys(v[k] as JsonValue);
    return out;
  }
  return v;
}

describe('diffPolicyVersions (§8.3 / §8.11)', () => {
  it('exact-same config yields NO diff', () => {
    const d = diffPolicyVersions(BASE, clone(BASE));
    expect(d.hasChanges).toBe(false);
    expect(d.entries).toEqual([]);
  });

  it('reordering irrelevant fields yields NO diff (order-independent)', () => {
    const reordered = {
      multipliers: reorderKeys(BASE.multipliers) as PolicyVersionConfig['multipliers'],
      revisionPenaltyRule: reorderKeys(BASE.revisionPenaltyRule) as PolicyVersionConfig['revisionPenaltyRule'],
      timelinessThresholds: reorderKeys(
        BASE.timelinessThresholds,
      ) as PolicyVersionConfig['timelinessThresholds'],
    };
    expect(diffPolicyVersions(BASE, reordered).hasChanges).toBe(false);
  });

  it('detects a weight change (multiplier value) with category "weight"', () => {
    const to = clone(BASE);
    (to.multipliers.complexity as Record<string, number>).high = 1.6;
    const d = diffPolicyVersions(BASE, to);
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0]).toMatchObject({
      path: 'multipliers.complexity.high',
      category: 'weight',
      changeType: 'changed',
      before: 1.5,
      after: 1.6,
    });
  });

  it('detects a threshold change with category "threshold"', () => {
    const to = clone(BASE);
    (to.timelinessThresholds as Record<string, number>).grace_days = 5;
    const d = diffPolicyVersions(BASE, to);
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0]).toMatchObject({ path: 'timelinessThresholds.grace_days', category: 'threshold' });
  });

  it('categorizes revision_penalty_rule.cap as "cap" and rate as "formula"', () => {
    const capChange = clone(BASE);
    (capChange.revisionPenaltyRule as Record<string, number>).cap = 0.3;
    expect(diffPolicyVersions(BASE, capChange).entries[0]).toMatchObject({
      path: 'revisionPenaltyRule.cap',
      category: 'cap',
    });
    const rateChange = clone(BASE);
    (rateChange.revisionPenaltyRule as Record<string, number>).rate_per_revision = 0.1;
    expect(diffPolicyVersions(BASE, rateChange).entries[0]).toMatchObject({
      path: 'revisionPenaltyRule.rate_per_revision',
      category: 'formula',
    });
  });

  it('reports an added multiplier level as "metric" added (before null)', () => {
    const to = clone(BASE);
    (to.multipliers.complexity as Record<string, number>).epic = 3.0;
    const d = diffPolicyVersions(BASE, to);
    expect(d.entries).toEqual([
      { path: 'multipliers.complexity.epic', category: 'metric', changeType: 'added', before: null, after: 3.0 },
    ]);
  });

  it('reports a removed multiplier level as "metric" removed (after null)', () => {
    const to = clone(BASE);
    delete (to.multipliers.quality as Record<string, number>).poor;
    const d = diffPolicyVersions(BASE, to);
    expect(d.entries).toEqual([
      { path: 'multipliers.quality.poor', category: 'metric', changeType: 'removed', before: 0, after: null },
    ]);
  });

  it('ignores hidden/irrelevant metadata (configFromVersionRow)', () => {
    const rowA = {
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
      version_no: 1,
      status: 'published',
      notes: 'v1',
      created_at: '2026-01-01T00:00:00Z',
      multipliers: BASE.multipliers,
      revision_penalty_rule: BASE.revisionPenaltyRule,
      timeliness_thresholds: BASE.timelinessThresholds,
    };
    const rowB = {
      id: 'bbbbbbbb-0000-0000-0000-000000000002', // different id/version/notes — metadata only
      version_no: 2,
      status: 'draft',
      notes: 'v2 draft',
      created_at: '2026-09-01T00:00:00Z',
      multipliers: BASE.multipliers,
      revision_penalty_rule: BASE.revisionPenaltyRule,
      timeliness_thresholds: BASE.timelinessThresholds,
    };
    expect(diffPolicyVersions(configFromVersionRow(rowA), configFromVersionRow(rowB)).hasChanges).toBe(
      false,
    );
  });

  it('produces deterministic path-sorted output for multiple changes', () => {
    const to = clone(BASE);
    (to.multipliers.complexity as Record<string, number>).high = 1.6;
    (to.revisionPenaltyRule as Record<string, number>).cap = 0.3;
    const paths = diffPolicyVersions(BASE, to).entries.map((e) => e.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toEqual(['multipliers.complexity.high', 'revisionPenaltyRule.cap']);
  });

  // ---- property tests ----
  const leaf = fc.oneof(
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.boolean(),
    fc.constant(null),
    fc.string(),
  );
  // Realistic scoring-config keys (a fixed enum vocabulary). scoring_policy_versions jsonb never
  // carries prototype-polluting keys like "__proto__", so the engine is not tested against them.
  const key = fc.constantFrom(
    'low', 'medium', 'high', 'critical', 'strategic', 'acceptable', 'good', 'excellent', 'poor',
    'early', 'on_time', 'late_minor', 'cap', 'rate_per_revision', 'grace_days',
    'complexity', 'impact', 'quality', 'timeliness',
  );
  const section = fc.dictionary(key, fc.oneof(leaf, fc.dictionary(key, leaf)));
  const configArb = fc.record({
    multipliers: section,
    revisionPenaltyRule: section,
    timelinessThresholds: section,
  }) as fc.Arbitrary<PolicyVersionConfig>;

  it('property: diff of a config against itself is always empty', () => {
    fc.assert(
      fc.property(configArb, (cfg) => {
        expect(diffPolicyVersions(cfg, clone(cfg)).hasChanges).toBe(false);
      }),
    );
  });

  it('property: diff is order-independent (key reordering never produces a change)', () => {
    fc.assert(
      fc.property(configArb, (cfg) => {
        const reordered = {
          multipliers: reorderKeys(cfg.multipliers),
          revisionPenaltyRule: reorderKeys(cfg.revisionPenaltyRule),
          timelinessThresholds: reorderKeys(cfg.timelinessThresholds),
        } as PolicyVersionConfig;
        expect(diffPolicyVersions(cfg, reordered).hasChanges).toBe(false);
      }),
    );
  });
});
