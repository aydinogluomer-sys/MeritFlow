export type OutboxStatus = 'pending' | 'processing' | 'completed' | 'dead';

export interface OutboxEventRow {
  id: string;
  organization_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  status: OutboxStatus;
  attempts: number;
  max_attempts: number;
}

export interface EnqueueOutboxInput {
  eventType: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

export interface OutboxContext {
  organizationId: string;
  userId: string;
}

export interface DrainOutboxInput {
  limit?: number;
}

/** A consumer for one event type. Must be idempotent (delivery is at-least-once). */
export type OutboxHandler = (event: OutboxEventRow) => Promise<void>;
export type OutboxHandlerRegistry = Record<string, OutboxHandler>;

export interface DrainOutboxResult {
  claimed: number;
  completed: number;
  retried: number;
  dead: number;
}
