import 'server-only';
// ENGINEERING-20 (§9A) — the Sentry-backed provider. This is the ONLY module that knows about
// Sentry; capture.ts and domain code go through the TelemetryProvider seam. Installed at bootstrap
// (instrumentation.ts) only when a DSN is present. Every method is non-throwing (observability must
// never affect the request path). Sentry compatibility with Next 16 is already proven by the app
// (@sentry/nextjs is a hard dep, statically loaded in instrumentation.ts), so no separate OTel path
// is needed here.
import type { MetricName, TelemetryContext, TelemetryProvider } from './types';

type SentryLike = {
  captureException?: (e: unknown, ctx?: unknown) => void;
  captureMessage?: (m: string, ctx?: unknown) => void;
  flush?: (timeout: number) => Promise<boolean>;
};

/** Correlation ids as a Sentry "context" block — searchable, never a secret (opaque uuids). */
function correlationContext(ctx: TelemetryContext): Record<string, unknown> {
  return {
    requestId: ctx.requestId,
    traceId: ctx.traceId,
    correlationId: ctx.correlationId,
    organizationId: ctx.organizationId,
  };
}

export class SentryProvider implements TelemetryProvider {
  // Loaded lazily via a *variable* dynamic specifier so tsc never statically resolves it and it is
  // never pulled into a client/unit-test bundle. Resolves the exact global client that
  // instrumentation.ts initializes (same package → same @sentry/core singleton). Cached per process.
  private sentry: Promise<SentryLike | null> | null = null;

  private load(): Promise<SentryLike | null> {
    if (typeof window !== 'undefined' || !process.env.SENTRY_DSN) return Promise.resolve(null);
    if (!this.sentry) {
      const mod = '@sentry/nextjs';
      this.sentry = import(mod)
        .then((m) => m as unknown as SentryLike)
        .catch(() => null);
    }
    return this.sentry;
  }

  captureException(err: unknown, ctx: TelemetryContext = {}): void {
    void this.load()
      .then((S) => {
        if (typeof S?.captureException !== 'function') return;
        S.captureException(err instanceof Error ? err : new Error(String(err)), {
          tags: { code: ctx.code ?? 'UNKNOWN', action: ctx.action ?? 'unknown' },
          contexts: { correlation: correlationContext(ctx) },
        });
      })
      .catch(() => {
        // never throw
      });
  }

  captureMessage(msg: string, level: 'info' | 'warning' | 'error', ctx: TelemetryContext = {}): void {
    void this.load()
      .then(async (S) => {
        if (typeof S?.captureMessage !== 'function') return;
        S.captureMessage(msg, {
          level,
          tags: { code: ctx.code ?? 'UNKNOWN', action: ctx.action ?? 'unknown' },
          contexts: { correlation: correlationContext(ctx) },
        });
        // Best-effort flush so a persistent/edge server does not send lazily after the response.
        if (typeof S.flush === 'function') await S.flush(2000);
      })
      .catch(() => {
        // never throw
      });
  }

  recordMetric(_name: MetricName, _value: number, _tags?: Record<string, string>): void {
    // The Sentry metrics API is unstable across SDK majors; deliberately a no-op here. Metric
    // emission (Prometheus/OTel) is wired by an OtelProvider when/if that backend is chosen.
  }
}
