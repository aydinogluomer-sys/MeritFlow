// ENGINEERING-20 (§9A) — the default provider: does nothing. Used until a real backend is wired at
// bootstrap (instrumentation.ts), and injected by unit tests. NO 'server-only' — tests import it.
import type { MetricName, TelemetryContext, TelemetryProvider } from './types';

export class NoOpProvider implements TelemetryProvider {
  captureException(_err: unknown, _ctx?: TelemetryContext): void {
    // no-op
  }

  captureMessage(
    _msg: string,
    _level: 'info' | 'warning' | 'error',
    _ctx?: TelemetryContext,
  ): void {
    // no-op
  }

  recordMetric(_name: MetricName, _value: number, _tags?: Record<string, string>): void {
    // no-op
  }
}
