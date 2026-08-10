/**
 * Next.js instrumentation hook (Phase 10-A). Initializes Sentry on the Node.js
 * runtime only, and only when a DSN is configured. The SDK is optional at build
 * time: `@sentry/node` is not a dependency, so we import it via a *variable*
 * module specifier — TypeScript treats the result as dynamic `any` and does not
 * try to resolve the module (no TS2307), and at runtime a missing SDK degrades
 * to a silent no-op.
 *
 * Decision C: `withSentryConfig` in next.config.ts is deferred (Next 16).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  try {
    const moduleName = '@sentry/node'; // variable specifier → tsc won't resolve statically
    const Sentry = await import(moduleName).catch(() => null);
    if (Sentry && typeof Sentry.init === 'function') {
      Sentry.init({ dsn, environment: process.env.SENTRY_ENV ?? 'production' });
    }
  } catch {
    // SDK not installed — continue silently (Decision C: withSentryConfig deferred, Next 16).
  }
}
