import type { OutboxRepository } from '../repository/outbox-repository';
import type { EnqueueOutboxInput, OutboxContext } from '../domain/types';

/**
 * Enqueue a durable event. Idempotent per (organization, idempotencyKey) — a duplicate enqueue
 * returns the existing event id. For a true transactional-outbox guarantee (event commits with a
 * business change), enqueue from within the business DB function; see docs/runbooks/outbox.md.
 */
export async function enqueueOutboxEvent(
  input: EnqueueOutboxInput,
  ctx: OutboxContext,
  repo: OutboxRepository,
): Promise<{ eventId: string }> {
  const eventId = await repo.enqueue(input, ctx);
  return { eventId };
}
