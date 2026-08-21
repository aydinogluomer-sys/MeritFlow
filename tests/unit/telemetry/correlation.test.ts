import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Prove the correlation pipeline end-to-end: proxy sets x-request-id → validatedAction reads it and
// opens a per-action context (fresh traceId) → the logger auto-attaches both to every LogEntry.
// next/headers is mocked to supply the x-request-id the proxy would have set.
const { headerState } = vi.hoisted(() => ({
  headerState: { requestId: 'req-abc' as string | null },
}));
vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (k: string) => (k === 'x-request-id' ? headerState.requestId : null),
  }),
}));

import { validatedAction } from '@/lib/validation/action';
import { logInfo } from '@/lib/logger';

const action = validatedAction(z.object({}), async () => {
  logInfo('correlated event');
  return 'ok';
});

function lastLogEntry(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const call = spy.mock.calls.at(-1);
  return JSON.parse(call![0] as string) as Record<string, unknown>;
}

describe('correlation propagation (proxy → validatedAction → logger)', () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    headerState.requestId = 'req-abc';
  });
  afterEach(() => spy.mockRestore());

  it('a log emitted inside the action carries requestId (from header) and a traceId', async () => {
    await action({});
    const entry = lastLogEntry(spy);
    expect(entry.requestId).toBe('req-abc');
    expect(typeof entry.traceId).toBe('string');
    expect((entry.traceId as string).length).toBeGreaterThan(0);
  });

  it('two actions in the SAME request share requestId but get distinct traceIds', async () => {
    await action({});
    const a = lastLogEntry(spy);
    await action({});
    const b = lastLogEntry(spy);
    expect(a.requestId).toBe(b.requestId); // same x-request-id header
    expect(a.traceId).not.toBe(b.traceId); // fresh per server action
  });

  it('actions in DIFFERENT requests carry different requestIds', async () => {
    headerState.requestId = 'req-1';
    await action({});
    const a = lastLogEntry(spy);
    headerState.requestId = 'req-2';
    await action({});
    const b = lastLogEntry(spy);
    expect(a.requestId).toBe('req-1');
    expect(b.requestId).toBe('req-2');
  });
});
