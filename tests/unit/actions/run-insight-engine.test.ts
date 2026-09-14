import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────
vi.mock('@/lib/auth/rbac', () => ({
  requirePermission: vi.fn(),
  PermissionError: class PermissionError extends Error {},
}));
vi.mock('@/lib/auth/org', () => ({ getActiveOrg: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ admin: true })) }));
vi.mock('@/modules/intelligence', () => ({ runInsightEngine: vi.fn() }));

import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createAdminClient } from '@/lib/supabase/admin';
import { runInsightEngine } from '@/modules/intelligence';
import { runInsightEngineAction } from '@/app/actions/intelligence/run-insight-engine';
import { RunInsightEngineSchema } from '@/lib/validation/schemas/insight-engine';

const requirePermissionMock = vi.mocked(requirePermission);
const getActiveOrgMock = vi.mocked(getActiveOrg);
const engineMock = vi.mocked(runInsightEngine);

const PERIOD = 'a0000000-0000-4000-8000-0000000000f1';

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue(undefined);
  getActiveOrgMock.mockResolvedValue({ organization_id: 'o1', profile_id: 'u1', primary_role: 'hr' } as never);
  engineMock.mockResolvedValue({ ruleSetVersion: 'insight-v1', bonusPeriodId: PERIOD, detected: 2, inserted: 2, recurred: 0, status: 'ok' } as never);
});

describe('RunInsightEngineSchema', () => {
  it('accepts empty {} and an optional uuid bonusPeriodId; rejects a non-uuid', () => {
    expect(RunInsightEngineSchema.safeParse({}).success).toBe(true);
    expect(RunInsightEngineSchema.safeParse({ bonusPeriodId: PERIOD }).success).toBe(true);
    expect(RunInsightEngineSchema.safeParse({ bonusPeriodId: 'nope' }).success).toBe(false);
  });
});

describe('runInsightEngineAction', () => {
  it('happy: enforces intelligence.manage + delegates the org + the injected ADMIN client', async () => {
    const res = await runInsightEngineAction({});
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toMatchObject({ status: 'ok', inserted: 2, recurred: 0 });
    expect(requirePermissionMock).toHaveBeenCalledWith('intelligence.manage');
    expect(engineMock).toHaveBeenCalledWith({ organizationId: 'o1', bonusPeriodId: null }, { admin: true });
    expect(createAdminClient).toHaveBeenCalled();
  });

  it('passes an explicit bonusPeriodId through unchanged', async () => {
    await runInsightEngineAction({ bonusPeriodId: PERIOD });
    expect(engineMock).toHaveBeenCalledWith({ organizationId: 'o1', bonusPeriodId: PERIOD }, { admin: true });
  });

  it('deny: requirePermission throws → the engine is NOT run (server-side authz, not client — AD1)', async () => {
    requirePermissionMock.mockRejectedValue(new Error('FORBIDDEN'));
    const res = await runInsightEngineAction({});
    expect(res.ok).toBe(false);
    expect(engineMock).not.toHaveBeenCalled();
  });

  it('validation: a non-uuid bonusPeriodId → ok:false, the engine is NOT run', async () => {
    const res = await runInsightEngineAction({ bonusPeriodId: 'bad' } as never);
    expect(res.ok).toBe(false);
    expect(engineMock).not.toHaveBeenCalled();
  });
});
