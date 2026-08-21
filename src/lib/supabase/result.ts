import { DomainError, toDomainError } from '@/lib/errors';

type SupabaseResult<T> = { data: T | null; error: unknown };

/**
 * Asserts the result row exists. Throws NOT_FOUND when data is null, throws a typed DomainError
 * when the query itself errored. Use for queries where a missing row is a bug, not a valid state.
 */
export function mustData<T>(result: SupabaseResult<T>): T {
  if (result.error) throw toDomainError(result.error);
  if (result.data === null) throw new DomainError('NOT_FOUND');
  return result.data;
}

/**
 * Returns data or null. Throws a typed DomainError when the query errored. Use when null is a
 * valid domain outcome (e.g. optional FK, upsert-on-miss).
 */
export function optionalData<T>(result: SupabaseResult<T>): T | null {
  if (result.error) throw toDomainError(result.error);
  return result.data ?? null;
}

/**
 * Alias for {@link optionalData}. Use at call sites where not-found is explicitly expected so the
 * intent is legible without needing a comment.
 */
export const notFoundAllowed: typeof optionalData = optionalData;
