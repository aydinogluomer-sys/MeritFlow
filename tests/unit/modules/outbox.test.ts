import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logError: vi.fn(), captureServerError: vi.fn() }));

import {
  enqueueOutboxEvent,
  drainOutbox,
  type OutboxRepository,
  type OutboxEventRow,
  type OutboxHandlerRegistry,
} from '@/modules/outbox';

beforeEach(() => vi.clearAllMocks());

const ctx = { organizationId: 'o1', userId: 'u1' };

function event(over: Partial<OutboxEventRow> = {}): OutboxEventRow {
  return {
    id: 'e1',
    organization_id: 'o1',
    event_type: 'demo.event',
    payload: {},
    idempotency_key: 'k1',
    status: 'processing',
    attempts: 1,
    max_attempts: 5,
    ...over,
  };
}

function repoWith(over: Partial<Record<keyof OutboxRepository, unknown>> = {}): OutboxRepository {
  return {
    enqueue: vi.fn(),
    claim: vi.fn().mockResolvedValue([]),
    markCompleted: vi.fn().mockResolvedValue(undefined),
    markRetry: vi.fn().mockResolvedValue(undefined),
    markDead: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as OutboxRepository;
}

describe('outbox module — enqueueOutboxEvent', () => {
  it('idempotent enqueue: returns { eventId } from the repo', async () => {
    const enqueue = vi.fn().mockResolvedValue('evt-1');
    const repo = repoWith({ enqueue });
    const input = { eventType: 'demo.event', payload: { a: 1 }, idempotencyKey: 'k1' };

    const res = await enqueueOutboxEvent(input, ctx, repo);

    expect(res).toEqual({ eventId: 'evt-1' });
    expect(enqueue).toHaveBeenCalledWith(input, ctx);
  });
});

describe('outbox module — drainOutbox', () => {
  it('empty queue: claims nothing, marks nothing (idempotent no-op)', async () => {
    const repo = repoWith({ claim: vi.fn().mockResolvedValue([]) });
    const res = await drainOutbox({}, repo, {});
    expect(res).toEqual({ claimed: 0, completed: 0, retried: 0, dead: 0 });
    expect(repo.markCompleted).not.toHaveBeenCalled();
  });

  it('happy path: handler succeeds → markCompleted', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const handlers: OutboxHandlerRegistry = { 'demo.event': handler };
    const ev = event({ id: 'e1' });
    const repo = repoWith({ claim: vi.fn().mockResolvedValue([ev]) });

    const res = await drainOutbox({ limit: 5 }, repo, handlers);

    expect(handler).toHaveBeenCalledWith(ev);
    expect(repo.markCompleted).toHaveBeenCalledWith('e1');
    expect(res).toMatchObject({ claimed: 1, completed: 1, retried: 0, dead: 0 });
  });

  it('unknown event_type: no handler → dead-letter (permanent)', async () => {
    const ev = event({ id: 'e2', event_type: 'no.handler' });
    const repo = repoWith({ claim: vi.fn().mockResolvedValue([ev]) });

    const res = await drainOutbox({}, repo, {});

    expect(repo.markDead).toHaveBeenCalledWith('e2', expect.stringContaining("no.handler"));
    expect(res).toMatchObject({ claimed: 1, dead: 1, completed: 0 });
  });

  it('handler throws with attempts remaining → markRetry with backoff', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    const ev = event({ id: 'e3', attempts: 2, max_attempts: 5 });
    const repo = repoWith({ claim: vi.fn().mockResolvedValue([ev]) });

    const res = await drainOutbox({}, repo, { 'demo.event': handler });

    expect(repo.markRetry).toHaveBeenCalledTimes(1);
    // exponential backoff: 30 * 2^(attempts-1) = 30 * 2^1 = 60s
    expect(repo.markRetry).toHaveBeenCalledWith('e3', 'boom', 60);
    expect(repo.markDead).not.toHaveBeenCalled();
    expect(res).toMatchObject({ retried: 1, dead: 0 });
  });

  it('handler throws with attempts exhausted → dead-letter', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('still failing'));
    const ev = event({ id: 'e4', attempts: 5, max_attempts: 5 });
    const repo = repoWith({ claim: vi.fn().mockResolvedValue([ev]) });

    const res = await drainOutbox({}, repo, { 'demo.event': handler });

    expect(repo.markDead).toHaveBeenCalledWith('e4', 'still failing');
    expect(repo.markRetry).not.toHaveBeenCalled();
    expect(res).toMatchObject({ dead: 1, retried: 0 });
  });

  it('mixed batch: one completes, one dead-letters (unknown), one retries', async () => {
    const ok = vi.fn().mockResolvedValue(undefined);
    const fail = vi.fn().mockRejectedValue(new Error('x'));
    const repo = repoWith({
      claim: vi.fn().mockResolvedValue([
        event({ id: 'a', event_type: 'ok.event' }),
        event({ id: 'b', event_type: 'unknown.event' }),
        event({ id: 'c', event_type: 'fail.event', attempts: 1, max_attempts: 3 }),
      ]),
    });

    const res = await drainOutbox({}, repo, { 'ok.event': ok, 'fail.event': fail });

    expect(res).toEqual({ claimed: 3, completed: 1, retried: 1, dead: 1 });
    expect(repo.markCompleted).toHaveBeenCalledWith('a');
    expect(repo.markDead).toHaveBeenCalledWith('b', expect.any(String));
    expect(repo.markRetry).toHaveBeenCalledWith('c', 'x', 30); // 30 * 2^0
  });
});
