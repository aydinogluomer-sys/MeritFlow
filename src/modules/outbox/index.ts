// Public API for the outbox module (ENGINEERING-09) — minimal transactional outbox + worker.
import type { OutboxHandlerRegistry } from './domain/types';

export { enqueueOutboxEvent } from './application/enqueue';
export { drainOutbox } from './application/drain-outbox';
export { OutboxRepository } from './repository/outbox-repository';
export type {
  EnqueueOutboxInput,
  OutboxContext,
  DrainOutboxInput,
  DrainOutboxResult,
  OutboxEventRow,
  OutboxHandler,
  OutboxHandlerRegistry,
  OutboxStatus,
} from './domain/types';

/**
 * Handler registry the drain worker dispatches on. Empty in MVP — real handlers (email /
 * notification / webhook / long-calc / reconcile) are registered here as durable-async needs
 * land. With an empty registry nothing is enqueued yet, so the drain action is a safe no-op
 * scaffold that a scheduled job (cron) invokes once handlers exist.
 */
export const DEFAULT_OUTBOX_HANDLERS: OutboxHandlerRegistry = {};
