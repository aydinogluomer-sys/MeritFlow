import { describe, expect, it } from 'vitest';
import { toDomainError, DomainError, ERROR_CODE_MESSAGES } from '@/lib/errors';

describe('DomainError', () => {
  it('defaults to the safe message for its code', () => {
    const err = new DomainError('FORBIDDEN');
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toBe(ERROR_CODE_MESSAGES.FORBIDDEN);
    expect(err).toBeInstanceOf(Error);
  });

  it('accepts an override message + fieldErrors + originalError', () => {
    const raw = new Error('pg');
    const err = new DomainError('VALIDATION_ERROR', {
      message: 'custom',
      fieldErrors: { name: ['bad'] },
      originalError: raw,
    });
    expect(err.message).toBe('custom');
    expect(err.fieldErrors).toEqual({ name: ['bad'] });
    expect(err.originalError).toBe(raw);
  });
});

describe('toDomainError', () => {
  it('passes a DomainError through unchanged (idempotent)', () => {
    const de = new DomainError('CONFLICT');
    expect(toDomainError(de)).toBe(de);
  });

  it.each([
    ['23505', 'CONFLICT'],
    ['23503', 'CONFLICT'],
    ['23502', 'CONSTRAINT_VIOLATION'],
    ['23514', 'CONSTRAINT_VIOLATION'],
    ['42501', 'FORBIDDEN'],
    ['PGRST116', 'NOT_FOUND'],
  ])('maps SQLSTATE/code %s -> %s', (code, expected) => {
    expect(toDomainError({ code, message: 'x' }).code).toBe(expected);
  });

  it('maps a row-level-security message -> RLS_DENIED (message beats the numeric code)', () => {
    const de = toDomainError({
      code: '42501',
      message: 'new row violates row-level security policy for table "tasks"',
    });
    expect(de.code).toBe('RLS_DENIED');
  });

  it('unknown SQLSTATE -> INTERNAL and preserves originalError', () => {
    const raw = { code: 'ZZZ', message: 'weird' };
    const de = toDomainError(raw);
    expect(de.code).toBe('INTERNAL');
    expect(de.originalError).toBe(raw);
  });

  it('non-object input -> INTERNAL (no throw)', () => {
    expect(toDomainError('boom').code).toBe('INTERNAL');
    expect(toDomainError(undefined).code).toBe('INTERNAL');
    expect(toDomainError(null).code).toBe('INTERNAL');
  });
});
