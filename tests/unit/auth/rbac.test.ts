import { beforeEach, describe, expect, it, vi } from 'vitest';

// ENGINEERING-26 (§15) — getPermissions() must fail-closed: DB errors throw, not return [].
// Before fix: DB outage → [] → requirePermission() threw PermissionError("FORBIDDEN") — misleading.
// After fix: DB outage → DomainError propagates — caller sees a real infrastructure error.

const { createClientMock, eqMock, getActiveOrgMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  eqMock: vi.fn(),
  getActiveOrgMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }));
vi.mock('@/lib/auth/org', () => ({ getActiveOrg: getActiveOrgMock }));

import { getPermissions, hasPermission, requirePermission } from '@/lib/auth/rbac';
import { DomainError } from '@/lib/errors/domain-error';

const ORG = { organization_id: 'o1', profile_id: 'u1', primary_role: 'employee' };

function setupDbResult(result: { data: unknown; error: unknown }) {
  createClientMock.mockResolvedValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: eqMock }),
    }),
  });
  eqMock.mockResolvedValue(result);
}

beforeEach(() => {
  vi.clearAllMocks();
  getActiveOrgMock.mockResolvedValue(ORG);
});

describe('getPermissions()', () => {
  it('returns permission keys on happy path', async () => {
    setupDbResult({
      data: [{ permission_key: 'tasks:read' }, { permission_key: 'tasks:submit' }],
      error: null,
    });
    expect(await getPermissions()).toEqual(['tasks:read', 'tasks:submit']);
  });

  it('returns [] when there is no active org', async () => {
    getActiveOrgMock.mockResolvedValue(null);
    expect(await getPermissions()).toEqual([]);
  });

  it('throws DomainError (INTERNAL) on DB outage — does not return [] (fail-closed)', async () => {
    setupDbResult({ data: null, error: { code: undefined, message: 'connection reset' } });
    await expect(getPermissions()).rejects.toBeInstanceOf(DomainError);
    await expect(getPermissions()).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('throws DomainError (FORBIDDEN) on privilege error — not silent empty permissions', async () => {
    setupDbResult({ data: null, error: { code: '42501', message: 'insufficient privilege' } });
    await expect(getPermissions()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('hasPermission()', () => {
  it('returns true when the permission exists in the DB result', async () => {
    setupDbResult({ data: [{ permission_key: 'tasks:approve' }], error: null });
    expect(await hasPermission('tasks:approve')).toBe(true);
  });

  it('returns false when the permission is absent', async () => {
    setupDbResult({ data: [{ permission_key: 'tasks:read' }], error: null });
    expect(await hasPermission('admin:users')).toBe(false);
  });

  it('propagates DomainError on DB error (does not mask as false)', async () => {
    setupDbResult({ data: null, error: { code: undefined, message: 'timeout' } });
    await expect(hasPermission('tasks:read')).rejects.toBeInstanceOf(DomainError);
  });
});

describe('requirePermission()', () => {
  it('resolves without throwing when permission is present', async () => {
    setupDbResult({ data: [{ permission_key: 'admin:users' }], error: null });
    await expect(requirePermission('admin:users')).resolves.toBeUndefined();
  });

  it('throws PermissionError when permission is absent (not a DB error)', async () => {
    setupDbResult({ data: [], error: null });
    await expect(requirePermission('admin:users')).rejects.toMatchObject({
      name: 'PermissionError',
      permission: 'admin:users',
    });
  });

  it('propagates DomainError on DB error — not PermissionError (distinguishable)', async () => {
    setupDbResult({ data: null, error: { code: undefined, message: 'timeout' } });
    await expect(requirePermission('tasks:read')).rejects.toBeInstanceOf(DomainError);
    await expect(requirePermission('tasks:read')).rejects.not.toMatchObject({ name: 'PermissionError' });
  });
});
