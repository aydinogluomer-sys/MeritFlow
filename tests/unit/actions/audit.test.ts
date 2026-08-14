import { beforeEach, describe, expect, it, vi } from 'vitest';

// ENGINEERING-02F characterization guard (test-first). Pins the CURRENT behavior of exportAudit
// — especially AD3 comp-masking and the fail-closed log_comp_access — BEFORE it is extracted into
// @/modules/audit, then stays green unchanged after the refactor.
vi.mock('@/lib/auth/rbac', () => ({
  requirePermission: vi.fn(),
  getPermissions: vi.fn(),
  PermissionError: class extends Error {},
}));
vi.mock('@/lib/auth/org', () => ({ getActiveOrg: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { requirePermission, getPermissions } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { exportAudit } from '@/app/actions/audit/export-audit';

const requirePermissionMock = vi.mocked(requirePermission);
const getPermissionsMock = vi.mocked(getPermissions);
const getActiveOrgMock = vi.mocked(getActiveOrg);
const createClientMock = vi.mocked(createClient);
const createAdminClientMock = vi.mocked(createAdminClient);

type AuditRow = {
  id: string;
  action: string;
  actor_id: string | null;
  target_type: string | null;
  target_id: string | null;
  is_sensitive: boolean;
  before: unknown;
  after: unknown;
  reason: string | null;
  created_at: string;
};

function row(over: Partial<AuditRow> = {}): AuditRow {
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

/** audit_logs.select().eq().order()[.gte()][.lte()] — the whole builder is thenable. */
function mockAuditQuery(rows: AuditRow[], error: unknown = null) {
  const result = { data: rows, error };
  const builder: Record<string, unknown> = {};
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.gte = vi.fn(() => builder);
  builder.lte = vi.fn(() => builder);
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
  const select = vi.fn(() => builder);
  const from = vi.fn(() => ({ select }));
  createClientMock.mockResolvedValue({ from } as never);
  return { from, select, builder };
}

/** admin.rpc('log_comp_access', ...) -> { error } */
function mockAdminRpc(error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ error });
  createAdminClientMock.mockReturnValue({ rpc } as never);
  return { rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue(undefined);
  getActiveOrgMock.mockResolvedValue({
    organization_id: 'o1',
    profile_id: 'p1',
    primary_role: 'auditor',
  } as never);
  getPermissionsMock.mockResolvedValue(['audit.read']);
});

describe('exportAudit — non-sensitive rows', () => {
  it('emits raw payloads and never logs comp access', async () => {
    mockAuditQuery([row({ is_sensitive: false, before: null, after: { x: 1 } })]);
    const { rpc } = mockAdminRpc();

    const res = await exportAudit({});

    expect(res.ok).toBe(true);
    const { csv, rowCount } = (res as { ok: true; data: { csv: string; rowCount: number } }).data;
    expect(rowCount).toBe(1);
    expect(csv.split('\n')[0]).toContain('is_sensitive');
    expect(csv).toContain('{""x"":1}'); // JSON payload, CSV-escaped
    expect(csv).not.toContain('MASKED');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('exportAudit — AD3 masking', () => {
  it('sensitive row without comp.read: before/after MASKED, no comp-access log', async () => {
    getPermissionsMock.mockResolvedValue(['audit.read']); // no comp.read
    mockAuditQuery([row({ is_sensitive: true, before: { a: 1 }, after: { b: 2 } })]);
    const { rpc } = mockAdminRpc();

    const res = await exportAudit({});

    expect(res.ok).toBe(true);
    const { csv } = (res as { ok: true; data: { csv: string } }).data;
    expect(csv).toContain('"MASKED"');
    expect(csv).not.toContain('{""a"":1}');
    expect(csv).not.toContain('{""b"":2}');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('sensitive row WITH comp.read: raw payload + log_comp_access fires', async () => {
    getPermissionsMock.mockResolvedValue(['audit.read', 'comp.read']);
    mockAuditQuery([row({ is_sensitive: true, before: { a: 1 }, after: { b: 2 } })]);
    const { rpc } = mockAdminRpc();

    const res = await exportAudit({});

    expect(res.ok).toBe(true);
    const { csv } = (res as { ok: true; data: { csv: string } }).data;
    expect(csv).toContain('{""a"":1}');
    expect(csv).toContain('{""b"":2}');
    expect(csv).not.toContain('MASKED');
    expect(rpc).toHaveBeenCalledWith('log_comp_access', {
      p_organization_id: 'o1',
      p_actor_id: 'p1',
      p_reason: 'audit CSV export — raw sensitive payload included',
    });
  });

  it('comp.read but NO sensitive row exported: log_comp_access does NOT fire (fail-closed)', async () => {
    getPermissionsMock.mockResolvedValue(['audit.read', 'comp.read']);
    mockAuditQuery([row({ is_sensitive: false })]);
    const { rpc } = mockAdminRpc();

    const res = await exportAudit({});

    expect(res.ok).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('log_comp_access error propagates: ok:false', async () => {
    getPermissionsMock.mockResolvedValue(['audit.read', 'comp.read']);
    mockAuditQuery([row({ is_sensitive: true, before: { a: 1 }, after: { b: 2 } })]);
    mockAdminRpc({ message: 'AUDIT_FAIL' });

    const res = await exportAudit({});
    expect(res).toEqual({ ok: false, error: 'INTERNAL' });
  });
});

describe('exportAudit — query shape + CSV escaping', () => {
  it('applies fromDate/toDate as gte/lte filters', async () => {
    const { builder } = mockAuditQuery([]);
    mockAdminRpc();

    await exportAudit({ fromDate: '2026-01-01T00:00:00Z', toDate: '2026-02-01T00:00:00Z' });

    expect(builder.gte).toHaveBeenCalledWith('created_at', '2026-01-01T00:00:00Z');
    expect(builder.lte).toHaveBeenCalledWith('created_at', '2026-02-01T00:00:00Z');
  });

  it('RFC-4180 escapes commas and quotes in fields', async () => {
    mockAuditQuery([row({ reason: 'a,"b"' })]);
    mockAdminRpc();

    const res = await exportAudit({});
    const { csv } = (res as { ok: true; data: { csv: string } }).data;
    expect(csv).toContain('"a,""b"""');
  });

  it('authz fail: no query, ok:false', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const { from } = mockAuditQuery([]);
    mockAdminRpc();

    const res = await exportAudit({});
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('DB error on query: ok:false with the message', async () => {
    mockAuditQuery([], { message: 'QUERY_FAIL' });
    mockAdminRpc();

    const res = await exportAudit({});
    expect(res).toEqual({ ok: false, error: 'INTERNAL' });
  });
});
