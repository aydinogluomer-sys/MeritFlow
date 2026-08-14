import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureServerError } from '@/lib/logger/capture';

describe('captureServerError', () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
    delete process.env.SENTRY_DSN;
  });

  it('logs the error as structured JSON (console.error called once)', async () => {
    await captureServerError(new Error('boom'), { code: 'INTERNAL', action: 'exportPayout' });

    expect(spy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(entry.level).toBe('error');
    expect(entry.code).toBe('INTERNAL');
    expect(entry.action).toBe('exportPayout');
  });

  it('does not throw when SENTRY_DSN is absent', async () => {
    await expect(captureServerError(new Error('x'))).resolves.toBeUndefined();
  });

  it('does not throw when the Sentry SDK is absent but a DSN is set', async () => {
    process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
    await expect(captureServerError(new Error('x'))).resolves.toBeUndefined();
  });

  it('scrubs sensitive data in the logged payload', async () => {
    await captureServerError(new Error('failed for ada@example.com'), { code: 'INTERNAL' });
    const line = spy.mock.calls[0]![0] as string;
    expect(line).toContain('[REDACTED:email]');
    expect(line).not.toContain('ada@example.com');
  });
});
