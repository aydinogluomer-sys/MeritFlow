import { describe, expect, it, vi } from 'vitest';
import { OutboxRepository } from '@/modules/outbox';
import { FakeClock } from '@/lib/time';

// ENGINEERING-24 — proves the injected Clock (not the wall clock) drives the outbox timestamps.
// Mocks the admin client so `from('outbox_events').update({...}).eq('id', id)` resolves and captures
// the update payload for assertion. (OutboxRepository imports the admin client type-only, so no real
// Supabase / env is touched.)
function mockAdmin() {
  const captured: { table?: string; payload?: Record<string, unknown> } = {};
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn((payload: Record<string, unknown>) => {
    captured.payload = payload;
    return { eq };
  });
  const from = vi.fn((table: string) => {
    captured.table = table;
    return { update };
  });
  return { admin: { from } as never, captured };
}

describe('OutboxRepository — deterministic clock', () => {
  it('markRetry sets available_at = clock.now() + backoff seconds', async () => {
    const clock = new FakeClock('2024-06-15T12:00:00Z');
    const { admin, captured } = mockAdmin();
    const repo = new OutboxRepository(admin, clock);

    await repo.markRetry('id-1', 'boom', 30);

    expect(captured.table).toBe('outbox_events');
    expect(captured.payload).toMatchObject({ status: 'pending', last_error: 'boom' });
    expect(captured.payload!.available_at).toBe('2024-06-15T12:00:30.000Z');
  });

  it('markRetry with 0 backoff sets available_at = now (not in the past)', async () => {
    const clock = new FakeClock('2024-06-15T12:00:00Z');
    const { admin, captured } = mockAdmin();
    const repo = new OutboxRepository(admin, clock);

    await repo.markRetry('id-1', 'boom', 0);
    expect(captured.payload!.available_at).toBe('2024-06-15T12:00:00.000Z');
  });

  it('advancing the clock moves the next backoff window forward', async () => {
    const clock = new FakeClock('2024-06-15T12:00:00Z');
    const { admin, captured } = mockAdmin();
    const repo = new OutboxRepository(admin, clock);

    clock.advance(5000); // +5s
    await repo.markRetry('id-1', 'boom', 30);
    expect(captured.payload!.available_at).toBe('2024-06-15T12:00:35.000Z'); // 12:00:05 + 30s
  });

  it('markCompleted sets processed_at = clock.now()', async () => {
    const clock = new FakeClock('2024-06-15T12:00:00Z');
    const { admin, captured } = mockAdmin();
    const repo = new OutboxRepository(admin, clock);

    await repo.markCompleted('id-1');
    expect(captured.payload).toMatchObject({
      status: 'completed',
      processed_at: '2024-06-15T12:00:00.000Z',
    });
  });

  it('markDead sets processed_at = clock.now()', async () => {
    const clock = new FakeClock('2024-06-15T12:00:00Z');
    const { admin, captured } = mockAdmin();
    const repo = new OutboxRepository(admin, clock);

    await repo.markDead('id-1', 'permanent');
    expect(captured.payload).toMatchObject({
      status: 'dead',
      last_error: 'permanent',
      processed_at: '2024-06-15T12:00:00.000Z',
    });
  });

  it('defaults to the system clock when none is injected (backward-compatible)', async () => {
    const { admin, captured } = mockAdmin();
    const repo = new OutboxRepository(admin); // no clock arg

    await repo.markRetry('id-1', 'boom', 30);
    expect(typeof captured.payload!.available_at).toBe('string');
    expect(String(captured.payload!.available_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
