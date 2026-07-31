// Server instrumentation hook (Next.js `register`). Decision C: Sentry is scaffolded —
// the env vars (SENTRY_DSN / SENTRY_ENV), the gate, and this hook are in place — but it
// is a strict no-op today: it never runs without a DSN, and the @sentry/nextjs SDK is
// intentionally not installed because it does not yet support Next.js 16 (peer caps at
// Next 15). No client instrumentation, no session replay, no performance tracing, PII
// disabled (data minimization — MeritFlow does not monitor employees; errors only).
//
// To enable later: install a Next-16-compatible @sentry/nextjs, set SENTRY_DSN, then
// initialize inside the guard below.
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // no-op unless a DSN is configured

  // Deferred until @sentry/nextjs supports Next 16:
  //   const Sentry = await import('@sentry/nextjs');
  //   Sentry.init({
  //     dsn,
  //     environment: process.env.SENTRY_ENV ?? 'development',
  //     tracesSampleRate: 0,
  //     sendDefaultPii: false,
  //   });
}
