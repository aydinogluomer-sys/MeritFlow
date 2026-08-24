import { describe, expect, it } from 'vitest';
import {
  validateSemanticQuery,
  createMetricRegistry,
  metricRegistry,
  METRIC_READ_PERMISSION,
  type ValidationResult,
} from '@/modules/intelligence';

const PERIOD = { kind: 'bonus_period', bonusPeriodId: '00000000-0000-0000-0000-0000000000aa' } as const;

function codes(res: ValidationResult): string[] {
  return res.valid ? [] : res.errors.map((e) => e.code);
}

describe('validateSemanticQuery', () => {
  it('accepts a well-formed, permitted, catalog-valid query', () => {
    const res = validateSemanticQuery(
      { metrics: ['payout_total'], dimensions: ['team'], filters: [], period: PERIOD },
      { permissions: [METRIC_READ_PERMISSION] },
    );
    expect(res.valid).toBe(true);
  });

  it('rejects a malformed query (empty metrics) before any semantic check', () => {
    const res = validateSemanticQuery(
      { metrics: [], dimensions: [], filters: [], period: PERIOD },
      { permissions: [METRIC_READ_PERMISSION] },
    );
    expect(res.valid).toBe(false);
    expect(codes(res)).toContain('malformed_query');
  });

  it('denies a metric the caller has no permission for', () => {
    const res = validateSemanticQuery(
      { metrics: ['payout_total'], dimensions: [], filters: [], period: PERIOD },
      { permissions: [] },
    );
    expect(codes(res)).toContain('metric_permission_denied');
  });

  it('flags a metric that is valid but not in the (custom) registry', () => {
    // A registry missing payout_total — the metric id is still a valid MetricId, so it reaches the
    // registry check rather than being rejected by Zod.
    const partial = createMetricRegistry(
      metricRegistry.all().filter((m) => m.id !== 'payout_total'),
    );
    const res = validateSemanticQuery(
      { metrics: ['payout_total'], dimensions: [], filters: [], period: PERIOD },
      { permissions: [METRIC_READ_PERMISSION], registry: partial },
    );
    expect(codes(res)).toContain('unknown_metric');
  });

  it('rejects a non-sensitive dimension not allowed for the metric', () => {
    // budget_variance allows organization/team/bonus_period — 'role' is neither allowed nor sensitive.
    const res = validateSemanticQuery(
      { metrics: ['budget_variance'], dimensions: ['role'], filters: [], period: PERIOD },
      { permissions: [METRIC_READ_PERMISSION] },
    );
    expect(codes(res)).toContain('dimension_not_allowed_for_metric');
    expect(codes(res)).not.toContain('sensitive_dimension_permission_denied');
  });

  it('requires the elevated permission for a sensitive (person-level) dimension', () => {
    const denied = validateSemanticQuery(
      { metrics: ['payout_total'], dimensions: ['employee'], filters: [], period: PERIOD },
      { permissions: [METRIC_READ_PERMISSION] },
    );
    expect(codes(denied)).toContain('sensitive_dimension_permission_denied');

    const allowed = validateSemanticQuery(
      { metrics: ['payout_total'], dimensions: ['employee'], filters: [], period: PERIOD },
      { permissions: [METRIC_READ_PERMISSION, 'intelligence.manage'] },
    );
    expect(allowed.valid).toBe(true);
  });

  it('validates dimensions used only in filters too', () => {
    const res = validateSemanticQuery(
      {
        metrics: ['budget_variance'],
        dimensions: [],
        filters: [{ dimension: 'employee', operator: 'eq', value: 'x' }],
        period: PERIOD,
      },
      { permissions: [METRIC_READ_PERMISSION] },
    );
    // employee is both not-allowed for budget_variance AND sensitive → both violations surface.
    expect(codes(res)).toContain('dimension_not_allowed_for_metric');
    expect(codes(res)).toContain('sensitive_dimension_permission_denied');
  });
});
