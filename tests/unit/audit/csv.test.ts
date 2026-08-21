import { describe, expect, it } from 'vitest';
import { csvField, jsonbField } from '@/modules/audit';

// ENGINEERING-21 — mutation-killing unit coverage for the pure CSV/jsonb field encoders. The audit
// export action test exercises these indirectly (comma/quote escaping); these pin the null path and
// the exact quoting so a mutated guard / dropped quote is caught.
describe('csvField', () => {
  it('null and undefined become the empty field (RFC-4180)', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });

  it('wraps a plain value in double quotes', () => {
    expect(csvField('abc')).toBe('"abc"');
    expect(csvField(42)).toBe('"42"');
    expect(csvField(0)).toBe('"0"');
    expect(csvField(false)).toBe('"false"');
  });

  it('doubles internal double-quotes', () => {
    expect(csvField('a"b')).toBe('"a""b"');
    expect(csvField('a,"b"')).toBe('"a,""b"""');
  });
});

describe('jsonbField', () => {
  it('null and undefined become the empty field', () => {
    expect(jsonbField(null)).toBe('');
    expect(jsonbField(undefined)).toBe('');
  });

  it('serializes a jsonb value to a JSON string', () => {
    expect(jsonbField({ x: 1 })).toBe('{"x":1}');
    expect(jsonbField([1, 2])).toBe('[1,2]');
    expect(jsonbField('s')).toBe('"s"');
  });
});
