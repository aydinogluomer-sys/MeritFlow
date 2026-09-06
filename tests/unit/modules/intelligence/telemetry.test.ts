import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoOpProvider } from '@/lib/telemetry/no-op-provider';
import { setTelemetryProvider } from '@/lib/telemetry';
import type { TelemetryProvider } from '@/lib/telemetry';
import { emitIntelligenceEvent } from '@/modules/intelligence';

// Reset the process-wide provider after each test so an injected mock never leaks.
afterEach(() => setTelemetryProvider(new NoOpProvider()));

describe('emitIntelligenceEvent', () => {
  it('routes an event to the provider as an info-level breadcrumb', () => {
    const captureMessage = vi.fn();
    const mock: TelemetryProvider = {
      captureException: vi.fn(),
      captureMessage,
      recordMetric: vi.fn(),
    };
    setTelemetryProvider(mock);

    emitIntelligenceEvent({
      type: 'insight_generated',
      insightType: 'payout_concentration_spike',
      severity: 'warning',
      organizationId: 'org-1',
    });

    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith('intelligence:insight_generated', 'info', {
      action: 'intelligence',
      organizationId: 'org-1',
    });
  });

  it('is a safe no-op when no backend is installed (no DSN → NoOpProvider)', () => {
    setTelemetryProvider(new NoOpProvider());
    expect(() =>
      emitIntelligenceEvent({ type: 'feature_flag_evaluated', flagKey: 'assist', enabled: false }),
    ).not.toThrow();
  });

  it('never throws even if the provider throws', () => {
    setTelemetryProvider({
      captureException: vi.fn(),
      captureMessage: () => {
        throw new Error('provider down');
      },
      recordMetric: vi.fn(),
    });
    expect(() =>
      emitIntelligenceEvent({
        type: 'semantic_query_rejected',
        reasons: ['metric_permission_denied'],
      }),
    ).not.toThrow();
  });
});
