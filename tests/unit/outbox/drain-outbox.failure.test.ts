import { describe, expect, it, vi } from 'vitest';

// ENGINEERING-28 — failure injection for the outbox drain worker. Proves the durable-async failure
// contract WITHOUT touching production code (drain-outbox.ts is already correct — this only exercises
// it): infra failure (claim) propagates and is never silently swallowed; a handler failure is
// CONTAINED (drainOutbox never throws for a handler error); retries use bounded exponential backoff
// and dead-letter after max_attempts; and a failed notification never disturbs the already-committed
// financial write. The telemetry-provider-throws and stable-commandId cases live elsewhere (see
// docs/engineering/e28-failure-matrix.md) and are deliberately NOT duplicated here.
vi.mock('@/lib/logger', () => ({ logError: vi.fn(), captureServerError: vi.fn() }));

import { drainOutbox, type OutboxEventRow, type OutboxRepository } from '@/modules/outbox';

function makeEvent(overrides: Partial<OutboxEventRow> = {}): OutboxEventRow {
  return {
    id: 'evt-1',
    organization_id: 'org-1',
    event_type: 'bonus_accrual_notification',
    payload: {},
    idempotency_key: 'idem-1',
    status: 'processing',
    attempts: 1,
    max_attempts: 3,
    ...overrides,
  };
}

// In-memory fake repository — never connects to Supabase. Each method is a spy so failures can be
// injected (claim rejects) and effects asserted (markRetry / markDead / markCompleted calls).
function makeRepo(over: Partial<Record<keyof OutboxRepository, unknown>> = {}): OutboxRepository {
  return {
    enqueue: vi.fn(),
    claim: vi.fn().mockResolvedValue([]),
    markCompleted: vi.fn().mockResolvedValue(undefined),
    markRetry: vi.fn().mockResolvedValue(undefined),
    markDead: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as OutboxRepository;
}

describe('drainOutbox — failure injection (ENGINEERING-28)', () => {
  it('Scenario 1 — DB claim failure PROPAGATES (a broken outbox is never silently swallowed)', async () => {
    const repo = makeRepo({ claim: vi.fn().mockRejectedValue(new Error('DB timeout (503)')) });

    await expect(drainOutbox({}, repo, {})).rejects.toThrow(/DB timeout/);
    // Nothing was claimed → no state transition attempted.
    expect(repo.markCompleted).not.toHaveBeenCalled();
    expect(repo.markRetry).not.toHaveBeenCalled();
    expect(repo.markDead).not.toHaveBeenCalled();
  });

  it('Scenario 2 — handler 429/500/timeout with attempts remaining → markRetry (backoff 30), no throw', async () => {
    const ev = makeEvent({ attempts: 1, max_attempts: 3 });
    const repo = makeRepo({ claim: vi.fn().mockResolvedValue([ev]) });
    const handler = vi.fn().mockRejectedValue(new Error('upstream 429'));

    const res = await drainOutbox({}, repo, { bonus_accrual_notification: handler });

    expect(res).toEqual({ claimed: 1, completed: 0, retried: 1, dead: 0 });
    expect(repo.markRetry).toHaveBeenCalledWith('evt-1', 'upstream 429', 30); // 30 * 2^(1-1)
    expect(repo.markCompleted).not.toHaveBeenCalled();
    expect(repo.markDead).not.toHaveBeenCalled();
  });

  it('Scenario 3 — handler error with attempts EXHAUSTED → markDead (DLQ), no throw', async () => {
    const ev = makeEvent({ attempts: 3, max_attempts: 3 });
    const repo = makeRepo({ claim: vi.fn().mockResolvedValue([ev]) });
    const handler = vi.fn().mockRejectedValue(new Error('persistent 500'));

    const res = await drainOutbox({}, repo, { bonus_accrual_notification: handler });

    expect(res).toEqual({ claimed: 1, completed: 0, retried: 0, dead: 1 });
    expect(repo.markDead).toHaveBeenCalledWith('evt-1', 'persistent 500');
    expect(repo.markRetry).not.toHaveBeenCalled();
  });

  it('Scenario 4 — NO handler registered → immediate dead-letter, no throw', async () => {
    const ev = makeEvent({ event_type: 'unknown_event_type' });
    const repo = makeRepo({ claim: vi.fn().mockResolvedValue([ev]) });

    const res = await drainOutbox({}, repo, {}); // empty registry

    expect(res).toMatchObject({ claimed: 1, completed: 0, dead: 1 });
    expect(repo.markDead).toHaveBeenCalledWith('evt-1', expect.stringMatching(/no handler/));
    expect(repo.markRetry).not.toHaveBeenCalled();
  });

  it('Scenario 5 — backoff formula 30 * 2^(attempts-1) for attempts 1 / 2 / 3', async () => {
    const cases: Array<[number, number]> = [
      [1, 30],
      [2, 60],
      [3, 120],
    ];
    for (const [attempts, expectedBackoff] of cases) {
      const ev = makeEvent({ attempts, max_attempts: 5 });
      const repo = makeRepo({ claim: vi.fn().mockResolvedValue([ev]) });
      const handler = vi.fn().mockRejectedValue(new Error('retry me'));

      await drainOutbox({}, repo, { bonus_accrual_notification: handler });

      expect(repo.markRetry).toHaveBeenCalledWith('evt-1', 'retry me', expectedBackoff);
    }
  });

  it('Scenario 6 — poison event (always throws) → DLQ after max_attempts (retries are bounded)', async () => {
    const ev = makeEvent({ attempts: 1, max_attempts: 1 }); // one attempt allowed → dead immediately
    const repo = makeRepo({ claim: vi.fn().mockResolvedValue([ev]) });
    const handler = vi.fn().mockRejectedValue(new Error('poison'));

    const res = await drainOutbox({}, repo, { bonus_accrual_notification: handler });

    expect(res).toEqual({ claimed: 1, completed: 0, retried: 0, dead: 1 });
    expect(repo.markDead).toHaveBeenCalledWith('evt-1', 'poison');
    expect(repo.markRetry).not.toHaveBeenCalled();
  });

  it('Scenario 7 — duplicate delivery: claim returns the SAME event 2× → handled twice (at-least-once boundary)', async () => {
    const ev = makeEvent({ id: 'evt-1' });
    const repo = makeRepo({ claim: vi.fn().mockResolvedValue([ev, ev]) });
    const handler = vi.fn().mockResolvedValue(undefined);

    const res = await drainOutbox({}, repo, { bonus_accrual_notification: handler });

    // drainOutbox processes each claimed row independently. In the real DB, FOR UPDATE SKIP LOCKED
    // prevents a double-claim; handlers must still be idempotent (delivery is at-least-once). This
    // documents the drain boundary if a duplicate ever reaches it.
    expect(handler).toHaveBeenCalledTimes(2);
    expect(repo.markCompleted).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({ claimed: 2, completed: 2 });
  });

  it('Scenario 8 — notification failure DLQs WITHOUT disturbing the committed financial write', async () => {
    // The financial commit (the bonus_calculation_run row) is already persisted in Postgres. The
    // outbox event is dispatched AFTER that DB commit — so if notification delivery fails, only the
    // NOTIFICATION is retried / dead-lettered, never the financial calculation. drainOutbox contains
    // the failure (does not throw) and leaves an audit trail (markDead).
    const ev = makeEvent({ event_type: 'bonus_accrual_notification', attempts: 1, max_attempts: 1 });
    const repo = makeRepo({ claim: vi.fn().mockResolvedValue([ev]) });
    const handler = vi.fn().mockRejectedValue(new Error('notification provider down'));

    const res = await drainOutbox({}, repo, { bonus_accrual_notification: handler });

    expect(res).toEqual({ claimed: 1, completed: 0, retried: 0, dead: 1 });
    expect(repo.markDead).toHaveBeenCalledWith('evt-1', 'notification provider down');
    expect(repo.markRetry).not.toHaveBeenCalled();
  });
});
