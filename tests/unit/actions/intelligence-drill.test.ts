import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────
vi.mock('@/lib/auth/rbac', () => ({
  requirePermission: vi.fn(),
  getPermissions: vi.fn(),
  PermissionError: class PermissionError extends Error {},
}));
vi.mock('@/lib/auth/org', () => ({ getActiveOrg: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rls: true })) }));

const { buildDrillQueryMock, executeSemanticQueryMock } = vi.hoisted(() => ({
  buildDrillQueryMock: vi.fn(),
  executeSemanticQueryMock: vi.fn(),
}));
vi.mock('@/modules/intelligence', () => {
  const { z } = require('zod');
  return {
    MetricIdSchema: z.enum([
      'cycle_completion_rate', 'payout_total', 'budget_variance', 'dispute_rate', 'manual_override_rate',
      'cap_hit_rate', 'approval_latency', 'gaming_flag_rate', 'opportunity_index', 'policy_complexity', 'payout_concentration',
    ]),
    buildDrillQuery: buildDrillQueryMock,
    executeSemanticQuery: executeSemanticQueryMock,
  };
});

import { requirePermission, getPermissions } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { drillMetricAction } from '@/app/actions/intelligence/drill';

const requirePermissionMock = vi.mocked(requirePermission);
const getActiveOrgMock = vi.mocked(getActiveOrg);
const getPermissionsMock = vi.mocked(getPermissions);

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue(undefined);
  getActiveOrgMock.mockResolvedValue({ organization_id: 'o1', profile_id: 'u1', primary_role: 'hr' } as never);
  getPermissionsMock.mockResolvedValue(['intelligence.read']);
  buildDrillQueryMock.mockReturnValue({ ok: true, query: { metrics: ['payout_total'], dimensions: ['team'], filters: [], period: { kind: 'relative', trailing: 'current' } } });
  executeSemanticQueryMock.mockResolvedValue({
    ok: true,
    metrics: [
      {
        metricId: 'payout_total',
        results: [{ metricId: 'payout_total', value: 100, unit: 'minor_currency', period: { start: 'a', end: 'b' }, organizationId: 'o1', dimensions: { team: 't1' }, computedAt: 'x', sourceVersion: 'metrics-v1' }],
      },
    ],
  });
});

describe('drillMetricAction', () => {
  it('happy: floor gate intelligence.read → builds + runs the plan → returns drilled rows', async () => {
    const res = await drillMetricAction({ metric: 'payout_total', level: 'team' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.drilled).toBe(true);
      if (res.data.drilled) expect(res.data.rows).toHaveLength(1);
    }
    expect(requirePermissionMock).toHaveBeenCalledWith('intelligence.read');
    expect(buildDrillQueryMock).toHaveBeenCalled();
    expect(executeSemanticQueryMock).toHaveBeenCalled();
  });

  it('deny: requirePermission throws → ok:false, the plan is NEVER built or run (server-side authz)', async () => {
    requirePermissionMock.mockRejectedValue(new Error('FORBIDDEN'));
    const res = await drillMetricAction({ metric: 'payout_total', level: 'team' });
    expect(res.ok).toBe(false);
    expect(buildDrillQueryMock).not.toHaveBeenCalled();
    expect(executeSemanticQueryMock).not.toHaveBeenCalled();
  });

  it('unservable level: buildDrillQuery rejects → drilled:false with the typed code, query NOT run', async () => {
    buildDrillQueryMock.mockReturnValue({ ok: false, error: { code: 'dimension_not_executable', message: 'x' } });
    const res = await drillMetricAction({ metric: 'budget_variance', level: 'team' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.drilled).toBe(false);
      if (!res.data.drilled) expect(res.data.error).toBe('dimension_not_executable');
    }
    expect(executeSemanticQueryMock).not.toHaveBeenCalled();
  });

  it('validation: a bad metric id → ok:false (schema rejects), nothing built', async () => {
    const res = await drillMetricAction({ metric: 'not_a_metric', level: 'team' } as never);
    expect(res.ok).toBe(false);
    expect(buildDrillQueryMock).not.toHaveBeenCalled();
  });
});
