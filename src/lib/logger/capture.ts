import 'server-only';
import { scrubValue } from './scrub';
import { logError } from './logger';
import { getContext, getTelemetryProvider } from '@/lib/telemetry';
import type { MeritFlowErrorCode } from '@/lib/errors';

interface CaptureContext {
  code?: MeritFlowErrorCode;
  action?: string;
}

export type AlertLevel = 'fatal' | 'warning';

/**
 * Capture an unexpected server error: always a structured (scrubbed) log, plus a report to the
 * active telemetry provider (Sentry in prod, no-op otherwise — ENGINEERING-20 §9A). capture.ts no
 * longer knows about Sentry directly; the backend lives behind the TelemetryProvider seam. Callers
 * use `void captureServerError(...)` — must never affect the request path. NEVER throws.
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

    // Delegate to the provider with the ambient correlation context (requestId/traceId/…).
    getTelemetryProvider().captureException(err, { ...getContext(), code: ctx.code, action: ctx.action });
  } catch {
    // Logging/telemetry must never break the request path — swallow everything.
  }
}

/**
 * Emit a reconciliation/ops alert through the telemetry provider (CRITICAL → 'error', WARNING →
 * 'warning'). No-op without a configured provider/DSN; never throws. Signature is preserved for the
 * reconciliation-alert route (ENGINEERING-05/12).
 */
export async function captureAlert(
  message: string,
  opts: { level: AlertLevel; invariant?: string },
): Promise<void> {
  try {
    // Map the alert scale to the provider's 3-level scale (fatal → error).
    const level = opts.level === 'fatal' ? 'error' : 'warning';
    getTelemetryProvider().captureMessage(message, level, {
      ...getContext(),
      code: opts.invariant,
    });
  } catch {
    // never throw
  }
}
