import { describe, expect, it } from 'vitest';
import { scrubString, scrubValue } from '@/lib/logger/scrub';

describe('scrubString', () => {
  it('redacts a Bearer JWT', () => {
    expect(scrubString('header Bearer aaa.bbb.ccc trailing')).toBe('header [REDACTED:jwt] trailing');
  });

  it('redacts an email address', () => {
    const out = scrubString('notify ada@example.com now');
    expect(out).toContain('[REDACTED:email]');
    expect(out).not.toContain('ada@example.com');
  });

  it('redacts the service-role key value (SI-11)', () => {
    const prev = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'super-secret-service-key-123';
    try {
      expect(scrubString('leaked super-secret-service-key-123 here')).toBe('leaked [REDACTED:secret] here');
    } finally {
      process.env.SUPABASE_SERVICE_ROLE_KEY = prev;
    }
  });

  it('leaves a safe string unchanged', () => {
    expect(scrubString('task 42 was approved on time')).toBe('task 42 was approved on time');
  });
});

describe('scrubValue', () => {
  it('redacts comp-sensitive keys by name', () => {
    const out = scrubValue({ salary: 100000, payout: 5, note: 'ok' }) as Record<string, unknown>;
    expect(out.salary).toBe('[REDACTED:comp]');
    expect(out.payout).toBe('[REDACTED:comp]');
    expect(out.note).toBe('ok');
  });

  it('recurses into nested objects (and scrubs a nested email)', () => {
    const out = scrubValue({ a: { b: { contact: 'ada@example.com' } } }) as {
      a: { b: { contact: string } };
    };
    expect(out.a.b.contact).toBe('[REDACTED:email]');
  });

  it('scrubs array elements', () => {
    const out = scrubValue(['ada@example.com', 'safe']) as string[];
    expect(out[0]).toContain('[REDACTED:email]');
    expect(out[1]).toBe('safe');
  });

  it('caps recursion depth at 6', () => {
    let obj: unknown = 'deep';
    for (let i = 0; i < 8; i++) obj = { nest: obj };
    expect(JSON.stringify(scrubValue(obj))).toContain('[DEPTH_LIMIT]');
  });

  it('passes numbers/booleans/null through unchanged', () => {
    expect(scrubValue(42)).toBe(42);
    expect(scrubValue(true)).toBe(true);
    expect(scrubValue(null)).toBeNull();
  });
});
