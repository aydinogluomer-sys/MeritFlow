/**
 * Stable, safe-to-surface error codes (ENGINEERING-03a). These are the ONLY error identifiers
 * that cross the server-action boundary to the client — raw PG/Supabase messages never do.
 * Keep this union small and semantic; add codes deliberately.
 */
export type MeritFlowErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_AUTHENTICATED'
  | 'FORBIDDEN'
  | 'RLS_DENIED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'CONSTRAINT_VIOLATION'
  | 'INTERNAL';

/**
 * Human-readable, non-leaking default message per code. The UI may override or i18n these; the
 * point is that a DomainError always has a safe message and never carries a raw Postgres string.
 */
export const ERROR_CODE_MESSAGES: Record<MeritFlowErrorCode, string> = {
  VALIDATION_ERROR: 'The submitted data is invalid.',
  NOT_AUTHENTICATED: 'You must be signed in to perform this action.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  RLS_DENIED: 'You do not have access to this resource.',
  NOT_FOUND: 'The requested resource was not found.',
  CONFLICT: 'This action conflicts with the current state of the data.',
  CONSTRAINT_VIOLATION: 'The request violates a data constraint.',
  INTERNAL: 'Something went wrong. Please try again.',
};
