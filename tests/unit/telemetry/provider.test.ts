import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoOpProvider } from '@/lib/telemetry/no-op-provider';
import { getTelemetryProvider, setTelemetryProvider } from '@/lib/telemetry';
import type { TelemetryProvider } from '@/lib/telemetry';
import { captureServerError } from '@/lib/logger/capture';

// Reset the process-wide singleton after each test so an injected mock never leaks between cases.
afterEach(() => setTelemetryProvider(new NoOpProvider()));

describe('NoOpProvider', () => {
  it('every method is a safe no-op (never throws)', () => {
    const p = new NoOpProvider();
    expect(() => p.captureException(new Error('x'), { requestId: 'r' })).not.toThrow();
    expect(() => p.captureMessage('m', 'error')).not.toThrow();
    expect(() => p.recordMetric('server_action_error', 1)).not.toThrow();
  });
});

describe('telemetry provider singleton', () => {
  it('defaults to a defined provider', () => {
    expect(getTelemetryProvider()).toBeDefined();
  });

  it('setTelemetryProvider installs a custom provider; getTelemetryProvider returns it', () => {
    const captureException = vi.fn();
    const mock: TelemetryProvider = {
      captureException,
      captureMessage: vi.fn(),
      recordMetric: vi.fn(),
    };
    setTelemetryProvider(mock);

    expect(getTelemetryProvider()).toBe(mock);
    getTelemetryProvider().captureException(new Error('boom'), { code: 'INTERNAL' });
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});

describe('captureServerError provider fallback', () => {
  it('still logs and never throws when the provider itself throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setTelemetryProvider({
      captureException: () => {
        throw new Error('provider down');
      },
      captureMessage: vi.fn(),
      recordMetric: vi.fn(),
    });

    await expect(captureServerError(new Error('x'), { code: 'INTERNAL' })).resolves.toBeUndefined();
    // logError ran BEFORE the provider call, so the structured log is still emitted.
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });
});
