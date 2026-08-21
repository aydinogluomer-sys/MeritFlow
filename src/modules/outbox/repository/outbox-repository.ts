import { toDomainError } from '@/lib/errors';
import type { Json } from '@/types/database.generated';
import type { EnqueueOutboxInput, OutboxContext, OutboxEventRow } from '../domain/types';

type AdminClient = Awaited<ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>>;

/**
 * Outbox data-access (ENGINEERING-09). Uses the injected admin client because outbox_events is
 * RLS server-only-write and the claim RPC is SECURITY DEFINER. Enqueue/claim go through the DB
 * functions (idempotency + FOR UPDATE SKIP LOCKED live in the DB); status transitions are plain
 * admin-client updates.
 */
export class OutboxRepository {
  constructor(private readonly admin: AdminClient) {}

  /** Idempotent enqueue; returns the event id (the existing id on a duplicate key). */
  async enqueue(input: EnqueueOutboxInput, ctx: OutboxContext): Promise<string> {
    const { data, error } = await this.admin.rpc('enqueue_outbox_event', {
      p_organization_id: ctx.organizationId,
      p_event_type: input.eventType,
      // Domain payload is Record<string, unknown>; it is a JSON object at runtime (serialized into
      // the jsonb arg). Narrow to the generated Json type at the DB boundary.
      p_payload: input.payload as Json,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw toDomainError(error);
    return data as string;
  }

  /** Atomically claim up to `limit` due pending events (pending -> processing, attempts++). */
  async claim(limit: number): Promise<OutboxEventRow[]> {
    const { data, error } = await this.admin.rpc('claim_outbox_events', { p_limit: limit });
    if (error) throw toDomainError(error);
    return (data ?? []) as OutboxEventRow[];
  }

  async markCompleted(id: string): Promise<void> {
    const { error } = await this.admin
      .from('outbox_events')
      .update({ status: 'completed', processed_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw toDomainError(error);
  }

  /** Re-queue with backoff — becomes claimable again only after `backoffSeconds`. */
  async markRetry(id: string, lastError: string, backoffSeconds: number): Promise<void> {
    const { error } = await this.admin
      .from('outbox_events')
      .update({
        status: 'pending',
        available_at: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
        last_error: lastError,
      })
      .eq('id', id);
    if (error) throw toDomainError(error);
  }

  async markDead(id: string, lastError: string): Promise<void> {
    const { error } = await this.admin
      .from('outbox_events')
      .update({ status: 'dead', last_error: lastError, processed_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw toDomainError(error);
  }
}
