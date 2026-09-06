import 'server-only';
// Phase P0 — Intelligence telemetry emitter (plan §13 "no feature launches without telemetry";
// anti-pattern §23). A THIN, typed wrapper over the existing telemetry seam (ENGINEERING-20). It
// routes intelligence events to the installed provider as info-level breadcrumbs — the SentryProvider
// forwards them to Sentry when a DSN is set; with no DSN the NoOpProvider makes every emit a safe
// no-op. No new dependency. Every emit is non-throwing (observability never breaks a request).
import { getTelemetryProvider } from '@/lib/telemetry';
import type { InsightSeverity } from '../domain/insight';
import type { InsightStatus } from '../domain/insight-status';
import type { FeatureFlagKey } from '../feature-flags/keys';
import type { ValidationErrorCode } from '../metrics/validator';

/** Closed set of intelligence telemetry events — keeps names typo-proof and greppable. */
export type IntelligenceTelemetryEvent =
  | { type: 'insight_generated'; insightType: string; severity: InsightSeverity; organizationId?: string }
  | { type: 'insight_transitioned'; from: InsightStatus; to: InsightStatus; organizationId?: string }
  | { type: 'feature_flag_evaluated'; flagKey: FeatureFlagKey; enabled: boolean; organizationId?: string }
  | { type: 'semantic_query_validated'; metricCount: number; organizationId?: string }
  | { type: 'semantic_query_rejected'; reasons: ValidationErrorCode[]; organizationId?: string };

/**
 * Emit an intelligence event as an info-level breadcrumb through the telemetry seam. Safe no-op when
 * no observability backend is installed (no DSN). Never throws.
 */
export function emitIntelligenceEvent(event: IntelligenceTelemetryEvent): void {
  try {
    getTelemetryProvider().captureMessage(`intelligence:${event.type}`, 'info', {
      action: 'intelligence',
      organizationId: event.organizationId,
    });
  } catch {
    // observability must never affect the caller
  }
}
