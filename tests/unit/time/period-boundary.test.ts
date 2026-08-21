import { describe, expect, it } from 'vitest';
import { isInPeriod, PERIOD_BOUNDARY_SEMANTICS, type PeriodBoundary } from '@/lib/time';

const period: PeriodBoundary = { startsOn: '2024-01-01', endsOn: '2024-01-31' };
const at = (iso: string) => new Date(iso);

describe('isInPeriod — inclusive both ends, UTC (mirrors DB BETWEEN)', () => {
  it('the starts_on day is inclusive', () => {
    expect(isInPeriod(at('2024-01-01T00:00:00Z'), period)).toBe(true);
    expect(isInPeriod(at('2024-01-01T23:59:59Z'), period)).toBe(true);
  });

  it('the ends_on day is inclusive', () => {
    expect(isInPeriod(at('2024-01-31T00:00:00Z'), period)).toBe(true);
    expect(isInPeriod(at('2024-01-31T23:59:59Z'), period)).toBe(true);
  });

  it('one day before starts_on is out', () => {
    expect(isInPeriod(at('2023-12-31T23:59:59Z'), period)).toBe(false);
  });

  it('one day after ends_on is out', () => {
    expect(isInPeriod(at('2024-02-01T00:00:00Z'), period)).toBe(false);
  });

  it('a middle day is in', () => {
    expect(isInPeriod(at('2024-01-15T12:00:00Z'), period)).toBe(true);
  });

  it('month-end boundary: ends_on 2024-01-31 -> 2024-02-01 is out', () => {
    expect(isInPeriod(at('2024-01-31T12:00:00Z'), period)).toBe(true);
    expect(isInPeriod(at('2024-02-01T00:00:00Z'), period)).toBe(false);
  });

  it('leap day: 2024-02-29 is IN a Feb period; 2024-03-01 is out', () => {
    const feb: PeriodBoundary = { startsOn: '2024-02-01', endsOn: '2024-02-29' };
    expect(isInPeriod(at('2024-02-29T12:00:00Z'), feb)).toBe(true);
    expect(isInPeriod(at('2024-03-01T00:00:00Z'), feb)).toBe(false);
  });

  it('DST-agnostic: membership is by UTC calendar day, never a local offset', () => {
    // Late on 2024-01-31 in UTC -> still in. Just past midnight 2024-02-01 in UTC -> out.
    // (A local DST shift cannot change the UTC day used here, so the result is DST-invariant.)
    expect(isInPeriod(at('2024-01-31T22:30:00Z'), period)).toBe(true);
    expect(isInPeriod(at('2024-02-01T00:30:00Z'), period)).toBe(false);
  });

  it('the semantics constant documents inclusive UTC BETWEEN', () => {
    expect(PERIOD_BOUNDARY_SEMANTICS.inclusiveBothEnds).toBe(true);
    expect(PERIOD_BOUNDARY_SEMANTICS.timezone).toBe('UTC');
    expect(PERIOD_BOUNDARY_SEMANTICS.dbComparison).toBe('BETWEEN starts_on AND ends_on');
  });
});
