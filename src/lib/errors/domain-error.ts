import { ERROR_CODE_MESSAGES, type MeritFlowErrorCode } from './codes';

export interface DomainErrorOptions {
  /** Override the default safe message for the code. */
  message?: string;
  /** Field-level validation details (mirrors the zod fieldErrors shape). */
  fieldErrors?: Record<string, string[]>;
  /** The raw underlying error (e.g. a Postgres error) — kept for observability, never surfaced. */
  originalError?: unknown;
}

/**
 * A typed, safe-to-surface domain error (ENGINEERING-03a). Carries a stable `code`; the raw cause
 * is retained on `originalError` for observability (ENGINEERING-04) but is NEVER sent to the
 * client. `validatedAction` returns only `code` (+ optional `fieldErrors`) across the boundary.
 */
export class DomainError extends Error {
  readonly code: MeritFlowErrorCode;
  readonly fieldErrors?: Record<string, string[]>;
  readonly originalError?: unknown;

  constructor(code: MeritFlowErrorCode, options: DomainErrorOptions = {}) {
    super(options.message ?? ERROR_CODE_MESSAGES[code]);
    this.name = 'DomainError';
    this.code = code;
    this.fieldErrors = options.fieldErrors;
    this.originalError = options.originalError;
  }
}
