import 'server-only';
// ENGINEERING-20 (§9A) — process-wide provider singleton. Defaults to the no-op provider; the real
// backend is installed ONCE at bootstrap (instrumentation.ts) via setTelemetryProvider, and unit
// tests inject a mock. Callers (capture.ts) read the current provider with getTelemetryProvider().
import type { TelemetryProvider } from './types';
import { NoOpProvider } from './no-op-provider';

let _provider: TelemetryProvider = new NoOpProvider();

/**
 * Install the active provider. Intended for bootstrap (instrumentation.ts startup) or test setup —
 * NOT for per-request use. Last write wins.
 */
export function setTelemetryProvider(provider: TelemetryProvider): void {
  _provider = provider;
}

/** The active provider (no-op until one is installed). */
export function getTelemetryProvider(): TelemetryProvider {
  return _provider;
}
