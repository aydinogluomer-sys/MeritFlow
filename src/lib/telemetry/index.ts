// Public API for the telemetry abstraction (ENGINEERING-20 §9A). Domain/app code imports ONLY from
// here. The concrete providers (NoOpProvider, SentryProvider) are internal — installed at bootstrap
// via setTelemetryProvider (instrumentation.ts), never imported by feature code.
export type { TelemetryProvider, TelemetryContext, MetricName } from './types';
export { getTelemetryProvider, setTelemetryProvider } from './provider';
export { runWithContext, getContext } from './context';
