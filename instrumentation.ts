import * as Sentry from '@sentry/nextjs';
import { setTelemetryProvider } from '@/lib/telemetry';
import { SentryProvider } from '@/lib/telemetry/sentry-provider';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
    // ENGINEERING-20 (§9A): install the Sentry-backed telemetry provider ONCE at server startup
    // (Node runtime — where server actions / logger run). Without a DSN the default NoOpProvider
    // stays in place. This is the only place the concrete provider is wired.
    if (process.env.SENTRY_DSN) setTelemetryProvider(new SentryProvider());
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
