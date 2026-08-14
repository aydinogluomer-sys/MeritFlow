// Public API for the typed-error architecture (ENGINEERING-03a).
export { DomainError, type DomainErrorOptions } from './domain-error';
export { toDomainError } from './translate';
export { ERROR_CODE_MESSAGES, type MeritFlowErrorCode } from './codes';
