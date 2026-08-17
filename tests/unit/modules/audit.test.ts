import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditExportContext, AuditExportRow, CompAccessRepository } from '@/modules/audit';

// exportAudit creates `new AuditRepository(await createClient())` internally, so we mock the server
// client + the AuditRepository class. compAccessRepo is injected → passed as a hand-built mock.
// These tests own the AD3 masking + fail-closed comp-access logic now that it lives in the module.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn().mockResolvedValue({}) }));
// Regular `function`, not an arrow: vitest 4 constructs the mock impl with Reflect.construct and
// arrow functions are not constructable ("is not a constructor").
vi.mock('@/modules/audit/repository/audit-repository', () => ({
  AuditRepository: vi.fn(function () {
    return { fetchAuditLogs: fetchMock };
  }),
}));

import { exportAudit } from '@/modules/audit';

beforeEach(() => vi.clearAllMocks());

function row(over: Partial<AuditExportRow> = {}): AuditExportRow {
  return {
    id: 'a1',
    action: 'task_approved',
    actor_id: 'u1',
    target_type: 'task',
    target_id: 't1',
    is_sensitive: false,
    before: null,
    after: { x: 1 },
    reason: null,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function compRepoMock() {
  return { logRawAccess: vi.fn().mockResolvedValue(undefined) };
}

const baseCtx = (over: Partial<AuditExportContext> = {}): AuditExportContext => ({
  organizationId: 'o1',
  actorProfileId: 'p1',
  canSeeRaw: false,
  ...over,
});

describe('audit module — exportAudit AD3 masking', () => {
  it('sensitive row without canSeeRaw: MASKED, no comp-access log', async () => {
    fetchMock.mockResolvedValue([row({ is_sensitive: true, before: { a: 1 }, after: { b: 2 } })]);
    const comp = compRepoMock();

    const res = await exportAudit({}, baseCtx({ canSeeRaw: false }), comp as unknown as CompAccessRepository);

    expect(res.rowCount).toBe(1);
    expect(res.csv).toContain('"MASKED"');
    expect(res.csv).not.toContain('{""a"":1}');
    expect(comp.logRawAccess).not.toHaveBeenCalled();
  });

  it('sensitive row WITH canSeeRaw: raw payload + logRawAccess(org, actorProfileId)', async () => {
    fetchMock.mockResolvedValue([row({ is_sensitive: true, before: { a: 1 }, after: { b: 2 } })]);
    const comp = compRepoMock();

    const res = await exportAudit({}, baseCtx({ canSeeRaw: true }), comp as unknown as CompAccessRepository);

    expect(res.csv).toContain('{""a"":1}');
    expect(res.csv).not.toContain('MASKED');
    expect(comp.logRawAccess).toHaveBeenCalledWith('o1', 'p1');
  });

  it('canSeeRaw but NO sensitive row: logRawAccess does NOT fire (fail-closed)', async () => {
    fetchMock.mockResolvedValue([row({ is_sensitive: false })]);
    const comp = compRepoMock();

    await exportAudit({}, baseCtx({ canSeeRaw: true }), comp as unknown as CompAccessRepository);

    expect(comp.logRawAccess).not.toHaveBeenCalled();
  });

  it('empty trail: header only, rowCount 0, no comp-access log', async () => {
    fetchMock.mockResolvedValue([]);
    const comp = compRepoMock();

    const res = await exportAudit({}, baseCtx({ canSeeRaw: true }), comp as unknown as CompAccessRepository);

    expect(res.rowCount).toBe(0);
    expect(res.csv.split('\n')).toHaveLength(1);
    expect(comp.logRawAccess).not.toHaveBeenCalled();
  });

  it('propagates a repo (fetch) error', async () => {
    fetchMock.mockRejectedValue(new Error('QUERY_FAIL'));
    const comp = compRepoMock();

    await expect(
      exportAudit({}, baseCtx({ canSeeRaw: true }), comp as unknown as CompAccessRepository),
    ).rejects.toThrow('QUERY_FAIL');
  });
});
