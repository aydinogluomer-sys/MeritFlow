import { describe, expect, it } from 'vitest';
import {
  BonusSnapshotMetadataSchema,
  poolRefFromMetadata,
} from '@/lib/db-schemas/bonus-snapshot-metadata';

// ENGINEERING-23 (§12) — the Zod contract for the untyped snapshot jsonb, plus the reconciliation
// helper that reads pool_ref_minor. Parsing NEVER hard-fails: a bad payload is "indeterminate" (NaN),
// which the verifier skips rather than raising a false mismatch.
describe('BonusSnapshotMetadataSchema', () => {
  it('1. accepts a numeric pool_ref_minor', () => {
    const r = BonusSnapshotMetadataSchema.safeParse({ pool_ref_minor: 100000 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.pool_ref_minor).toBe(100000);
  });

  it('2. accepts a string pool_ref_minor', () => {
    const r = BonusSnapshotMetadataSchema.safeParse({ pool_ref_minor: '100000' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.pool_ref_minor).toBe('100000');
  });

  it('3. accepts an empty object (field is optional)', () => {
    expect(BonusSnapshotMetadataSchema.safeParse({}).success).toBe(true);
  });

  it('4. passes extra keys through (forward-compat)', () => {
    const r = BonusSnapshotMetadataSchema.safeParse({ pool_ref_minor: 50, extra_key: true });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as Record<string, unknown>).extra_key).toBe(true);
  });
});

describe('poolRefFromMetadata', () => {
  it('5. returns the coerced number for valid metadata', () => {
    expect(poolRefFromMetadata({ pool_ref_minor: 80000 })).toBe(80000);
    expect(poolRefFromMetadata({ pool_ref_minor: '80000' })).toBe(80000);
  });

  it('6. returns NaN for null / missing / blank / non-object metadata (indeterminate)', () => {
    expect(poolRefFromMetadata(null)).toBeNaN();
    expect(poolRefFromMetadata({})).toBeNaN();
    expect(poolRefFromMetadata({ pool_ref_minor: '' })).toBeNaN();
    expect(poolRefFromMetadata('not an object')).toBeNaN();
  });
});
