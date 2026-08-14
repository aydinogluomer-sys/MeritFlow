import 'server-only';
import { scrubValue } from './scrub';
import { logError } from './logger';
import type { MeritFlowErrorCode } from '@/lib/errors';

interface CaptureContext {
  code?: MeritFlowErrorCode;
  action?: string;
}

/**
 * Capture an unexpected server error: always a structured (scrubbed) log, plus an optional Sentry
 * report. Sentry degrades silently — the @sentry/node SDK is intentionally not installed (Next 16
 * peer-dep gap, Decision C), so the dynamic import is guarded exactly like instrumentation.ts.
 * NEVER throws — callers use `void captureServerError(...)` and must not be affected by logging.
 */
export async function captureServerError(err: unknown, ctx: CaptureContext = {}): Promise<void> {
  try {
    const scrubbed = scrubValue(
      err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
    );

    // 1. Structured log (always).
    logError('unhandled server error', {
      code: ctx.code,
      action: ctx.action,
      originalError: scrubbed,
    });

    // 2. Sentry (optional — SDK not installed; no-op unless a DSN AND the SDK are present).
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) return;

    const mod = '@sentry/node'; // variable specifier — tsc won't statically resolve it
    const Sentry = (await import(mod).catch(() => null)) as {
      captureException?: (e: unknown, opts?: unknown) => void;
    } | null;
    if (typeof Sentry?.captureException === 'function') {
      Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
        tags: { code: ctx.code ?? 'UNKNOWN', action: ctx.action ?? 'unknown' },
      });
    }
  } catch {
    // Logging/Sentry must never break the request path — swallow everything.
  }
}
