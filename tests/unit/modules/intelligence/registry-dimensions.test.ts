import { describe, expect, it } from 'vitest';
import {
  metricRegistry,
  createMetricRegistry,
  METRIC_IDS,
  METRIC_READ_PERMISSION,
  DIMENSION_IDS,
  isSensitiveDimension,
  SENSITIVE_DIMENSION_PERMISSION,
} from '@/modules/intelligence';

describe('metric registry', () => {
  it('registers exactly the 11 approved metrics', () => {
    expect(metricRegistry.all()).toHaveLength(METRIC_IDS.length);
    for (const id of METRIC_IDS) expect(metricRegistry.has(id)).toBe(true);
  });

  it('every metric is read-gated and carries a non-empty allowed-dimension set', () => {
    for (const def of metricRegistry.all()) {
      expect(def.requiredPermission).toBe(METRIC_READ_PERMISSION);
      expect(def.allowedDimensions.length).toBeGreaterThan(0);
      for (const dim of def.allowedDimensions) expect(DIMENSION_IDS).toContain(dim);
    }
  });

  it('rejects a registry with duplicate metric ids', () => {
    const dup = metricRegistry.get('payout_total')!;
    expect(() => createMetricRegistry([dup, dup])).toThrow(/duplicate/);
  });
});

describe('dimension catalog', () => {
  it('marks only person-level dimensions as sensitive', () => {
    expect(isSensitiveDimension('employee')).toBe(true);
    expect(isSensitiveDimension('manager')).toBe(true);
    expect(isSensitiveDimension('team')).toBe(false);
    expect(isSensitiveDimension('organization')).toBe(false);
  });

  it('gates sensitive dimensions behind the elevated permission key', () => {
    expect(SENSITIVE_DIMENSION_PERMISSION).toBe('intelligence.manage');
  });
});
