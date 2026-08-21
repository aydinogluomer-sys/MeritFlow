import { describe, expect, it } from 'vitest';
import { DomainError } from '@/lib/errors/domain-error';
import { mustData, notFoundAllowed, optionalData } from '@/lib/supabase/result';

// ENGINEERING-26 (§15) — data-access helper contract.

describe('mustData', () => {
  it('returns data on happy path', () => {
    expect(mustData({ data: { id: 1 }, error: null })).toEqual({ id: 1 });
  });

  it('throws NOT_FOUND when data is null and no error', () => {
    let caught: unknown;
    try { mustData({ data: null, error: null }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe('NOT_FOUND');
  });

  it('throws DomainError (FORBIDDEN) on privilege error', () => {
    let caught: unknown;
    try { mustData({ data: null, error: { code: '42501', message: 'permission denied' } }); }
    catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe('FORBIDDEN');
  });

  it('throws DomainError (CONFLICT) on unique-violation error', () => {
    let caught: unknown;
    try { mustData({ data: null, error: { code: '23505', message: 'duplicate key' } }); }
    catch (e) { caught = e; }
    expect((caught as DomainError).code).toBe('CONFLICT');
  });

  it('throws DomainError (INTERNAL) on unknown DB error', () => {
    let caught: unknown;
    try { mustData({ data: null, error: { code: undefined, message: 'connection reset' } }); }
    catch (e) { caught = e; }
    expect((caught as DomainError).code).toBe('INTERNAL');
  });

  it('re-throws an existing DomainError unchanged', () => {
    const original = new DomainError('NOT_FOUND');
    let caught: unknown;
    try { mustData({ data: null, error: original }); } catch (e) { caught = e; }
    expect(caught).toBe(original);
  });
});

describe('optionalData', () => {
  it('returns data on happy path', () => {
    expect(optionalData({ data: 'hello', error: null })).toBe('hello');
  });

  it('returns null when data is null and no error', () => {
    expect(optionalData({ data: null, error: null })).toBeNull();
  });

  it('throws DomainError when error is present (does not swallow)', () => {
    let caught: unknown;
    try { optionalData({ data: null, error: { code: '42501', message: '' } }); }
    catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe('FORBIDDEN');
  });
});

describe('notFoundAllowed', () => {
  it('is a reference alias for optionalData', () => {
    expect(notFoundAllowed).toBe(optionalData);
  });

  it('returns null on not-found without throwing', () => {
    expect(notFoundAllowed({ data: null, error: null })).toBeNull();
  });

  it('throws DomainError on real DB error (not masked as not-found)', () => {
    let caught: unknown;
    try { notFoundAllowed({ data: null, error: { code: '23502', message: 'null constraint' } }); }
    catch (e) { caught = e; }
    expect((caught as DomainError).code).toBe('CONSTRAINT_VIOLATION');
  });
});
