import { beforeEach, describe, expect, it, vi } from 'vitest';

// ENGINEERING-26 (§15) — getUser() must fail-closed: auth service errors throw, not return null.

const { createClientMock, getAuthUserMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  getAuthUserMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
}));

import { getUser, requireUser } from '@/lib/auth/session';
import { DomainError } from '@/lib/errors/domain-error';

beforeEach(() => {
  vi.clearAllMocks();
  createClientMock.mockResolvedValue({ auth: { getUser: getAuthUserMock } });
});

describe('getUser()', () => {
  it('returns the user on happy path', async () => {
    getAuthUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    expect(await getUser()).toEqual({ id: 'u1' });
  });

  it('returns null when Supabase reports no user (no session, no error)', async () => {
    getAuthUserMock.mockResolvedValue({ data: { user: null }, error: null });
    expect(await getUser()).toBeNull();
  });

  it('throws DomainError (INTERNAL) on auth service error — does NOT return null (fail-closed)', async () => {
    getAuthUserMock.mockResolvedValue({
      data: { user: null },
      error: { code: undefined, message: 'auth service unavailable' },
    });
    await expect(getUser()).rejects.toBeInstanceOf(DomainError);
    await expect(getUser()).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('propagates DomainError unchanged when error is already a DomainError', async () => {
    const original = new DomainError('FORBIDDEN');
    getAuthUserMock.mockResolvedValue({ data: { user: null }, error: original });
    let caught: unknown;
    try { await getUser(); } catch (e) { caught = e; }
    expect(caught).toBe(original);
  });
});

describe('requireUser()', () => {
  it('returns the user when authenticated', async () => {
    getAuthUserMock.mockResolvedValue({ data: { user: { id: 'u2' } }, error: null });
    expect(await requireUser()).toEqual({ id: 'u2' });
  });

  it('throws NOT_AUTHENTICATED when no session', async () => {
    getAuthUserMock.mockResolvedValue({ data: { user: null }, error: null });
    await expect(requireUser()).rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' });
  });

  it('propagates auth service error as DomainError (not NOT_AUTHENTICATED)', async () => {
    getAuthUserMock.mockResolvedValue({
      data: { user: null },
      error: { code: undefined, message: 'network timeout' },
    });
    await expect(requireUser()).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});
