import { describe, expect, it } from 'vitest';
import { scrubValue } from '@/lib/logger/scrub';

// ENGINEERING-20 (§9A) PII expansion. The ENGINEERING-04 scrub tests (JWT/email/comp/service-key)
// already exist in tests/unit/logger/scrub.test.ts; these pin the NEW key-based redactions and,
// critically, that opaque correlation ids survive scrubbing (so a request stays traceable).
describe('scrubValue — ENGINEERING-20 PII keys', () => {
  it('masks a password value', () => {
    const out = scrubValue({ password: 'hunter2', ok: 'keep' }) as Record<string, unknown>;
    expect(out.password).toBe('[REDACTED:pii]');
    expect(out.ok).toBe('keep');
  });

  it('masks a raw dispute narrative', () => {
    const out = scrubValue({ narrative: 'the employee alleged bias in review' }) as Record<
      string,
      unknown
    >;
    expect(out.narrative).toBe('[REDACTED:pii]');
  });

  it('masks full_name and display_name (full employee-name payload)', () => {
    const out = scrubValue({ full_name: 'Ada Lovelace', display_name: 'ada' }) as Record<
      string,
      unknown
    >;
    expect(out.full_name).toBe('[REDACTED:pii]');
    expect(out.display_name).toBe('[REDACTED:pii]');
  });

  it('does NOT mask correlation ids (opaque uuids must stay traceable)', () => {
    const ids = { requestId: 'req-uuid', traceId: 'trace-uuid', correlationId: 'corr-uuid' };
    const out = scrubValue(ids) as typeof ids;
    expect(out).toEqual(ids);
  });
});
