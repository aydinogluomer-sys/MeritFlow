import { describe, expect, it } from 'vitest';
import { getContext, runWithContext } from '@/lib/telemetry';

describe('telemetry context (AsyncLocalStorage)', () => {
  it('getContext returns the fields set by runWithContext', () => {
    runWithContext({ requestId: 'req-1', traceId: 'trace-1' }, () => {
      expect(getContext().requestId).toBe('req-1');
      expect(getContext().traceId).toBe('trace-1');
    });
  });

  it('nested runWithContext: the inner scope wins, then the outer is restored', () => {
    runWithContext({ requestId: 'outer', traceId: 'outer-t' }, () => {
      runWithContext({ requestId: 'inner', traceId: 'inner-t' }, () => {
        expect(getContext().requestId).toBe('inner');
        expect(getContext().traceId).toBe('inner-t');
      });
      expect(getContext().requestId).toBe('outer');
      expect(getContext().traceId).toBe('outer-t');
    });
  });

  it('getContext outside any scope is an empty object', () => {
    expect(getContext()).toEqual({});
  });

  it('context propagates across awaits', async () => {
    await runWithContext({ traceId: 'async-trace' }, async () => {
      await Promise.resolve();
      expect(getContext().traceId).toBe('async-trace');
    });
  });
});
