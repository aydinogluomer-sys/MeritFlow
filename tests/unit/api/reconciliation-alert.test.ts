import { describe, it, expect, vi, beforeEach } from 'vitest';

// captureAlert is mocked so tests never touch Sentry — we only assert the route's contract.
vi.mock('@/lib/logger/capture', () => ({ captureAlert: vi.fn() }));

import { POST } from '../../../app/api/reconciliation-alert/route';
import { captureAlert } from '@/lib/logger/capture';

const captureAlertMock = vi.mocked(captureAlert);

function post(body: unknown): Request {
  return new Request('http://localhost/api/reconciliation-alert', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/reconciliation-alert', () => {
  beforeEach(() => vi.clearAllMocks());

  it('(a) valid CRITICAL payload → 200 + { received: true } and captures a fatal alert', async () => {
    const res = await POST(post({ severity: 'CRITICAL', message: 'db down', invariant: 'inv-ok' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
    expect(captureAlertMock).toHaveBeenCalledWith('db down', {
      level: 'fatal',
      invariant: 'inv-ok',
    });
  });

  it('(b) missing severity → 400', async () => {
    const res = await POST(post({ message: 'no severity here' }));
    expect(res.status).toBe(400);
    expect(captureAlertMock).not.toHaveBeenCalled();
  });

  it('(c) same invariant 6× within 60s → 429 on the 6th call', async () => {
    const payload = { severity: 'WARNING' as const, message: 'noisy', invariant: 'inv-rate' };
    for (let i = 1; i <= 5; i++) {
      const res = await POST(post(payload));
      expect(res.status).toBe(200);
    }
    const sixth = await POST(post(payload));
    expect(sixth.status).toBe(429);
    await expect(sixth.json()).resolves.toEqual({ error: 'rate limited' });
  });
});
