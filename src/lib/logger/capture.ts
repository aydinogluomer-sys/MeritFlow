import 'server-only';
import { scrubValue } from './scrub';
import { logError } from './logger';
import type { MeritFlowErrorCode } from '@/lib/errors';

interface CaptureContext {
  code?: MeritFlowErrorCode;
  action?: string;
}

export type AlertLevel = 'fatal' | 'warning';

type SentryLike = {
  captureException?: (e: unknown, ctx?: unknown) => void;
  captureMessage?: (m: string, ctx?: unknown) => void;
};

/**
 * Sentry is loaded via a *variable* dynamic specifier so tsc never statically resolves it and it is
 * never pulled into client/unit-test bundles. At runtime `@sentry/nextjs` resolves and shares the
 * exact global client initialized in instrumentation.ts (same package, so the same
 * `@sentry/core` singleton). Server-only (`import 'server-only'` blocks client import at build; the runtime
 * window guard is belt-and-suspenders). Degrades to a no-op without a DSN. NEVER throws.
 */
async function loadSentry(): Promise<SentryLike | null> {
  if (typeof window !== 'undefined' || !process.env.SENTRY_DSN) return null;
  // '@sentry/nextjs' (not '@sentry/node') so capture uses the exact same global client that
  // instrumentation.ts initializes. Variable specifier — tsc won't statically resolve it.
  const mod = '@sentry/nextjs';
  return (await import(mod).catch(() => null)) as SentryLike | null;
}

/**
 * Capture an unexpected server error: always a structured (scrubbed) log, plus an optional Sentry
 * report. Callers use `void captureServerError(...)` — must never affect the request path.
 */
export async function captureServerError(err: unknown, ctx: CaptureContext = {}): Promise<void> {
  try {
    const scrubbed = scrubValue(
      err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
    );
    logError('unhandled server error', {
      code: ctx.code,
      action: ctx.action,
      originalError: scrubbed,
    });

    const Sentry = await loadSentry();
    if (typeof Sentry?.captureException === 'function') {
      Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
        tags: { code: ctx.code ?? 'UNKNOWN', action: ctx.action ?? 'unknown' },
      });
    }
  } catch {
    // Logging/Sentry must never break the request path — swallow everything.
  }
}

/**
 * Emit a reconciliation/ops alert to Sentry as a message event (CRITICAL → 'fatal', WARNING →
 * 'warning'). No-op without a DSN; never throws.
 */
export async function captureAlert(
  message: string,
  opts: { level: AlertLevel; invariant?: string },
): Promise<void> {
  try {
    const Sentry = await loadSentry();
    if (typeof Sentry?.captureMessage === 'function') {
      Sentry.captureMessage(message, {
        level: opts.level,
        extra: { invariant: opts.invariant },
      });
      // Give Sentry up to 2s to flush the event before the route returns (the transport batches
      // and the persistent server would otherwise send it lazily / after the response).
      if (typeof (Sentry as { flush?: (t: number) => Promise<boolean> }).flush === 'function') {
        await (Sentry as { flush: (t: number) => Promise<boolean> }).flush(2000);
      }
    }
  } catch {
    // never throw
  }
}
