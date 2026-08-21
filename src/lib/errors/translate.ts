import { DomainError } from './domain-error';
import type { MeritFlowErrorCode } from './codes';

/** The subset of a Supabase / PostgREST / Postgres error we inspect for translation. */
interface SupabaseLikeError {
  code?: string; // Postgres SQLSTATE ('23505'…) or PostgREST code ('PGRST116'…)
  message?: string;
}

/** Map a Postgres SQLSTATE / PostgREST code (and RLS message) to a stable MeritFlowErrorCode. */
function codeFor(err: SupabaseLikeError): MeritFlowErrorCode {
  // Stryker disable next-line StringLiteral: the '' fallback VALUE is irrelevant — a missing code
  // hits the switch default (INTERNAL) regardless of what the fallback string is. Equivalent mutant.
  const sqlstate = err.code ?? '';
  // Stryker disable next-line StringLiteral: '' only guards `.toLowerCase()` against an undefined
  // message; its VALUE never changes the RLS `.includes('row-level security')` result (false for any
  // non-RLS string). Equivalent mutant.
  const message = (err.message ?? '').toLowerCase();

  // RLS: the policy-violation message is the reliable signal — it can arrive under different
  // SQLSTATEs / PostgREST codes, so message-matching takes priority over the numeric code.
  if (message.includes('row-level security')) return 'RLS_DENIED';

  switch (sqlstate) {
    case '23505': // unique_violation
    case '23503': // foreign_key_violation
      return 'CONFLICT';
    case '23502': // not_null_violation
    case '23514': // check_violation
      return 'CONSTRAINT_VIOLATION';
    case '42501': // insufficient_privilege
      return 'FORBIDDEN';
    case 'PGRST116': // PostgREST: no rows returned for a single()/maybeSingle()
      return 'NOT_FOUND';
    default:
      return 'INTERNAL';
  }
}

/**
 * Translate an infra error (Supabase/Postgres) into a typed DomainError with a safe code. An error
 * that is already a DomainError is returned unchanged. The raw error is preserved on
 * `originalError` for observability and NEVER surfaced to the client.
 */
export function toDomainError(err: unknown): DomainError {
  if (err instanceof DomainError) return err;

  const supa = (typeof err === 'object' && err !== null ? err : {}) as SupabaseLikeError;
  return new DomainError(codeFor(supa), { originalError: err });
}
