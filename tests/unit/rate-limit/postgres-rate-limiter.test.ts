import { beforeEach, describe, expect, it, vi } from 'vitest';

// ENGINEERING-19 (8.4) — the PostgresRateLimiter delegates to the check_rate_limit RPC and FAILS
// OPEN on a DB error. Mock the admin client's rpc + the logger.
const { createAdminClientMock, rpcMock, logErrorMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  rpcMock: vi.fn(),
  logErrorMock: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }));
vi.mock('@/lib/logger', () => ({ logError: logErrorMock }));

import { PostgresRateLimiter } from '@/lib/rate-limit';

const ORG = 'a0000000-0000-0000-0000-000000000001';

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClientMock.mockReturnValue({ rpc: rpcMock });
});

describe('PostgresRateLimiter', () => {
  it('allows the request when the RPC returns true', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    const allowed = await new PostgresRateLimiter().check('point_override', ORG, 20, 60);
    expect(allowed).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith('check_rate_limit', {
      p_key: 'point_override',
      p_organization_id: ORG,
      p_max_requests: 20,
      p_window_seconds: 60,
    });
  });

  it('rejects the request when the RPC returns false', async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    const allowed = await new PostgresRateLimiter().check('run_calculation', ORG, 5, 60);
    expect(allowed).toBe(false);
  });

  it('fails open (returns true) and logs when the RPC errors', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'db down' } });
    const allowed = await new PostgresRateLimiter().check('export_payout', ORG, 10, 60);
    expect(allowed).toBe(true);
    expect(logErrorMock).toHaveBeenCalled();
  });
});
