import { logError } from '@/lib/logger';
import type { OutboxRepository } from '../repository/outbox-repository';
import type { DrainOutboxInput, DrainOutboxResult, OutboxHandlerRegistry } from '../domain/types';

const BACKOFF_BASE_SECONDS = 30;

/**
 * Drain a batch of the outbox (ENGINEERING-09): claim due events, dispatch each to its registered
 * handler, and record the outcome —
 *   - success               → completed
 *   - handler throws, tries left → retried with exponential backoff (30s · 2^(attempts-1))
 *   - handler throws, exhausted  → dead-lettered
 *   - no handler for event_type  → dead-lettered (permanent; unknown event)
 * Idempotent consumer: `claim` only picks pending+due rows (FOR UPDATE SKIP LOCKED), so a
 * completed/dead event is never re-processed; handlers must themselves be idempotent
 * (at-least-once delivery). `attempts` is already incremented by the claim.
 */
export async function drainOutbox(
  input: DrainOutboxInput,
  repo: OutboxRepository,
  handlers: OutboxHandlerRegistry,
): Promise<DrainOutboxResult> {
  const events = await repo.claim(input.limit ?? 10);
  let completed = 0;
  let retried = 0;
  let dead = 0;

  for (const event of events) {
    const handler = handlers[event.event_type];
    if (!handler) {
      await repo.markDead(event.id, `no handler registered for event_type '${event.event_type}'`);
      dead += 1;
      continue;
    }
    try {
      await handler(event);
      await repo.markCompleted(event.id);
      completed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (event.attempts >= event.max_attempts) {
        await repo.markDead(event.id, message);
        dead += 1;
      } else {
        const backoff = BACKOFF_BASE_SECONDS * 2 ** (event.attempts - 1);
        await repo.markRetry(event.id, message, backoff);
        retried += 1;
      }
      logError('[outbox] handler failed', {
        eventType: event.event_type,
        attempts: event.attempts,
        maxAttempts: event.max_attempts,
      });
    }
  }

  return { claimed: events.length, completed, retried, dead };
}
