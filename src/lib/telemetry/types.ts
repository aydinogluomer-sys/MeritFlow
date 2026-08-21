// ENGINEERING-20 (§9A) — telemetry abstraction. A vendor-neutral seam between the app and whatever
// observability backend is wired at bootstrap (Sentry today; OTel tomorrow). Domain code never
// imports a concrete provider — it emits through the logger (correlation auto-filled from context)
// or, at the boundary, through captureServerError which delegates to getTelemetryProvider().

/**
 * Request-scoped correlation carried through the whole pipeline:
 *   request → requestId → traceId → correlationId → action → application → repository/RPC → DB.
 * requestId is minted per HTTP request (proxy.ts), traceId per server action (validatedAction),
 * correlationId is the business/command id (e.g. a stable commandId) when one exists.
 */
export interface TelemetryContext {
  requestId?: string; // per-HTTP-request id (proxy.ts x-request-id)
  traceId?: string; // per-server-action id (validatedAction)
  correlationId?: string; // commandId / workflow id
  organizationId?: string;
  action?: string; // server action name
  code?: string; // MeritFlowErrorCode when available
}

/**
 * The backend seam. A provider turns an app-level event into a backend call (Sentry/OTel/no-op).
 * All methods MUST be non-throwing — observability can never break the request path.
 */
export interface TelemetryProvider {
  captureException(err: unknown, ctx?: TelemetryContext): void;
  captureMessage(msg: string, level: 'info' | 'warning' | 'error', ctx?: TelemetryContext): void;
  recordMetric(name: MetricName, value: number, tags?: Record<string, string>): void;
}

/** Closed set of MeritFlow metrics — keeps metric names typo-proof and greppable. */
export type MetricName =
  | 'financial_command_duration_ms'
  | 'financial_command_failure'
  | 'reconciliation_critical_count'
  | 'authz_denied'
  | 'outbox_retry'
  | 'server_action_error'
  | 'duplicate_prevented';
