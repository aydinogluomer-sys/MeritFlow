import { Client } from 'pg';

// ENGINEERING-16 — real multi-session concurrency harness. Uses raw pg.Client sessions (NOT the
// Supabase JS client, NOT mocks) so two INDEPENDENT PostgreSQL backends hit the same critical
// section simultaneously. Local Supabase DB port is 54322 (supabase/config.toml).

export const TEST_DB_URL =
  process.env.TEST_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export async function connect(): Promise<Client> {
  const c = new Client({ connectionString: TEST_DB_URL });
  await c.connect();
  return c;
}

// Fixed advisory-lock key for this harness. The gate holds an EXCLUSIVE lock on it; the two race
// sessions each take a SHARED lock on the same key (shared conflicts with exclusive), so both block
// until the gate releases — then they unblock together and race into the critical section. This is
// the ONLY race-synchronization mechanism (no sleep-based timing).
const GATE_KEY = 16_161;

/**
 * Bring two independent sessions to the same critical point, then release them simultaneously.
 * Returns the settled results of both. The gate polls pg_locks for readiness with a bounded 20ms×50
 * loop — this is INFRASTRUCTURE-SETUP polling (waiting for both backends to be parked on the gate),
 * NOT race timing; the prohibition is on using sleep AS the synchronization mechanism.
 */
export async function race<T>(
  fn1: (c: Client) => Promise<T>,
  fn2: (c: Client) => Promise<T>,
): Promise<[PromiseSettledResult<T>, PromiseSettledResult<T>]> {
  const gate = await connect();
  await gate.query('SELECT pg_advisory_lock($1)', [GATE_KEY]);

  const wrap = async (fn: (c: Client) => Promise<T>) => {
    const c = await connect();
    // Blocks here until the gate's exclusive lock is released.
    await c.query('SELECT pg_advisory_lock_shared($1)', [GATE_KEY]);
    try {
      return await fn(c);
    } finally {
      await c.query('SELECT pg_advisory_unlock_shared($1)', [GATE_KEY]);
      await c.end();
    }
  };

  const p1 = wrap(fn1);
  const p2 = wrap(fn2);

  // Poll until both sessions are parked on the gate (granted = false) — infra-setup only.
  for (let i = 0; i < 50; i++) {
    const { rows } = await gate.query(
      `SELECT count(*) AS n FROM pg_locks
        WHERE locktype = 'advisory' AND objid = $1 AND granted = false`,
      [GATE_KEY],
    );
    if (Number(rows[0]!.n) >= 2) break;
    await new Promise<void>((r) => setTimeout(r, 20)); // infra-setup poll only
  }

  // Release the gate — both sessions unblock and race.
  await gate.query('SELECT pg_advisory_unlock($1)', [GATE_KEY]);
  await gate.end();

  return Promise.allSettled([p1, p2]);
}
