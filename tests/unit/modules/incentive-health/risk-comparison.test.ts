import { describe, expect, it } from 'vitest';
import {
  computeHealthComparison,
  pickPreviousVersion,
  type ComparableEvaluation,
} from '@/modules/incentive-health';

// Module 1-B — comparison-to-previous health delta (§3.11). Pure + deterministic; no DB.

function evalOf(versionNo: number, overall: number, dims: Record<string, number>): ComparableEvaluation {
  return {
    versionNo,
    overallScore: overall,
    dimensions: Object.entries(dims).map(([dimension, score]) => ({ dimension: dimension as never, score })),
  };
}

describe('pickPreviousVersion (previous-version selection)', () => {
  const versions = [{ id: 'a', versionNo: 1 }, { id: 'b', versionNo: 2 }, { id: 'c', versionNo: 4 }];

  it('selects the highest version_no strictly below the current', () => {
    expect(pickPreviousVersion(versions, 4)?.id).toBe('b'); // 2 is the highest < 4 (gap at 3)
    expect(pickPreviousVersion(versions, 2)?.id).toBe('a');
  });

  it('returns null for the first version (nothing below it)', () => {
    expect(pickPreviousVersion(versions, 1)).toBeNull();
  });

  it('ignores versions at or above the current (never compares to self/future)', () => {
    expect(pickPreviousVersion(versions, 3)?.id).toBe('b'); // 4 is excluded (not < 3)
    expect(pickPreviousVersion([{ id: 'x', versionNo: 5 }], 5)).toBeNull();
  });
});

describe('computeHealthComparison (overall + per-dimension deltas)', () => {
  it('computes signed deltas (positive = healthier than the previous version)', () => {
    const current = evalOf(3, 80, { financial_integrity: 100, payout_concentration: 60, complexity: 70 });
    const previous = evalOf(2, 72, { financial_integrity: 90, payout_concentration: 70, complexity: 70 });
    const cmp = computeHealthComparison(current, previous);

    expect(cmp.currentVersionNo).toBe(3);
    expect(cmp.previousVersionNo).toBe(2);
    expect(cmp.hasPrevious).toBe(true);
    expect(cmp.overall).toEqual({ current: 80, previous: 72, delta: 8 });

    const fi = cmp.dimensions.find((d) => d.dimension === 'financial_integrity')!;
    expect(fi).toEqual({ dimension: 'financial_integrity', current: 100, previous: 90, delta: 10 });
    const pc = cmp.dimensions.find((d) => d.dimension === 'payout_concentration')!;
    expect(pc.delta).toBe(-10); // regressed
    const cx = cmp.dimensions.find((d) => d.dimension === 'complexity')!;
    expect(cx.delta).toBe(0); // unchanged
  });

  it('first version (no previous) ⇒ hasPrevious=false and every delta is null', () => {
    const current = evalOf(1, 95, { financial_integrity: 100, complexity: 82 });
    const cmp = computeHealthComparison(current, null);
    expect(cmp.hasPrevious).toBe(false);
    expect(cmp.previousVersionNo).toBeNull();
    expect(cmp.overall).toEqual({ current: 95, previous: null, delta: null });
    for (const d of cmp.dimensions) {
      expect(d.previous).toBeNull();
      expect(d.delta).toBeNull();
      expect(d.current).not.toBeNull();
    }
  });

  it('a dimension absent from the previous evaluation ⇒ its delta is null (no NaN)', () => {
    const current = evalOf(2, 90, { financial_integrity: 100, gaming_resistance: 80 });
    const previous = evalOf(1, 100, { financial_integrity: 100 }); // gaming_resistance not present
    const cmp = computeHealthComparison(current, previous);
    const gr = cmp.dimensions.find((d) => d.dimension === 'gaming_resistance')!;
    expect(gr.previous).toBeNull();
    expect(gr.delta).toBeNull();
    expect(cmp.dimensions.find((d) => d.dimension === 'financial_integrity')!.delta).toBe(0);
  });

  it('reproducible: same inputs ⇒ identical comparison', () => {
    const current = evalOf(3, 80, { financial_integrity: 100, payout_concentration: 60 });
    const previous = evalOf(2, 72, { financial_integrity: 90, payout_concentration: 70 });
    expect(computeHealthComparison(current, previous)).toEqual(computeHealthComparison(current, previous));
  });
});
