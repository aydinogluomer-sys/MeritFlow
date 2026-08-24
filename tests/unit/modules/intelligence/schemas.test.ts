import { describe, expect, it } from 'vitest';
import {
  InsightSchema,
  parseInsight,
  EvidenceRefSchema,
  SuggestedActionSchema,
  MetricResultSchema,
  SemanticQuerySchema,
} from '@/modules/intelligence';

const VALID_EVIDENCE = { sourceType: 'metric', sourceId: 'payout_total' };
const VALID_ACTION = { code: 'inspect', label: 'İncele', route: 'inspect' };

function baseInsight(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    type: 'payout_concentration_spike',
    severity: 'warning',
    headline: 'Ödeme yoğunlaşması arttı',
    deterministicFacts: { top1: 0.32 },
    evidence: [VALID_EVIDENCE],
    suggestedActions: [VALID_ACTION],
    generatedAt: '2026-08-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('EvidenceRefSchema', () => {
  it('accepts a known source type', () => {
    expect(EvidenceRefSchema.safeParse(VALID_EVIDENCE).success).toBe(true);
  });
  it('rejects an unknown source type', () => {
    expect(EvidenceRefSchema.safeParse({ sourceType: 'nope', sourceId: 'x' }).success).toBe(false);
  });
});

describe('SuggestedActionSchema', () => {
  it('accepts a minimal action', () => {
    expect(SuggestedActionSchema.safeParse({ code: 'x', label: 'Y' }).success).toBe(true);
  });
  it('rejects an empty code', () => {
    expect(SuggestedActionSchema.safeParse({ code: '', label: 'Y' }).success).toBe(false);
  });
});

describe('InsightSchema — evidence + action invariant (§23)', () => {
  it('accepts an insight with >=1 evidence and >=1 action', () => {
    expect(InsightSchema.safeParse(baseInsight()).success).toBe(true);
    expect(() => parseInsight(baseInsight())).not.toThrow();
  });

  it('rejects an insight WITHOUT evidence', () => {
    const res = InsightSchema.safeParse(baseInsight({ evidence: [] }));
    expect(res.success).toBe(false);
    expect(() => parseInsight(baseInsight({ evidence: [] }))).toThrow();
  });

  it('rejects an insight WITHOUT a suggested action', () => {
    const res = InsightSchema.safeParse(baseInsight({ suggestedActions: [] }));
    expect(res.success).toBe(false);
  });

  it('rejects an unknown severity', () => {
    expect(InsightSchema.safeParse(baseInsight({ severity: 'fatal' })).success).toBe(false);
  });
});

describe('MetricResultSchema', () => {
  const valid = {
    metricId: 'payout_total',
    value: 100,
    unit: 'minor_currency',
    period: { start: '2026-06-01', end: '2026-06-30' },
    organizationId: '00000000-0000-0000-0000-000000000001',
    dimensions: { team: 't1' },
    computedAt: '2026-08-24T00:00:00.000Z',
    sourceVersion: 'v1',
  };
  it('accepts a well-formed result', () => {
    expect(MetricResultSchema.safeParse(valid).success).toBe(true);
  });
  it('rejects an invalid unit', () => {
    expect(MetricResultSchema.safeParse({ ...valid, unit: 'bananas' }).success).toBe(false);
  });
  it('rejects an unknown metric id', () => {
    expect(MetricResultSchema.safeParse({ ...valid, metricId: 'nope' }).success).toBe(false);
  });
});

describe('SemanticQuerySchema', () => {
  it('requires at least one metric', () => {
    const res = SemanticQuerySchema.safeParse({
      metrics: [],
      dimensions: [],
      filters: [],
      period: { kind: 'relative', trailing: 'current' },
    });
    expect(res.success).toBe(false);
  });
  it('accepts a valid query with a relative period', () => {
    const res = SemanticQuerySchema.safeParse({
      metrics: ['dispute_rate'],
      dimensions: ['team'],
      filters: [{ dimension: 'team', operator: 'eq', value: 't1' }],
      period: { kind: 'relative', trailing: 'trailing_3' },
    });
    expect(res.success).toBe(true);
  });
});
