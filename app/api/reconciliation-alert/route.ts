import { z } from 'zod';
import { captureAlert } from '@/lib/logger/capture';

// Internal reconciliation-alert sink (ENGINEERING-12 / slo.md §4). POST only, no auth — it is an
// internal endpoint fronted by the rate limit below. NOTE for production: network-restrict this
// (or add a shared-secret header). An unauthenticated endpoint that emits to Sentry can be abused
// for quota exhaustion; the in-memory limiter is only a floor.
const schema = z.object({
  severity: z.enum(['CRITICAL', 'WARNING']),
  message: z.string().min(1),
  invariant: z.string().optional(),
});

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 5;
// In-memory only — resets on function cold start; upgrade to a Redis rate-limit for production.
const recentHits = new Map<string, number[]>();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid payload' }, 400);
  }
  const { severity, message, invariant } = parsed.data;

  // Rate limit by invariant: reject the 6th+ occurrence of the same invariant within 60s.
  const key = invariant ?? '__no_invariant__';
  const now = Date.now();
  const recent = (recentHits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    return json({ error: 'rate limited' }, 429);
  }
  recent.push(now);
  recentHits.set(key, recent);

  await captureAlert(message, {
    level: severity === 'CRITICAL' ? 'fatal' : 'warning',
    invariant,
  });

  if (severity === 'CRITICAL') {
    // Also to stderr → visible in Vercel Function logs. Contains no secret (never the DSN).
    console.error(
      `[reconciliation-alert] CRITICAL: ${message}${invariant ? ` [${invariant}]` : ''}`,
    );
  }

  return json({ received: true });
}
