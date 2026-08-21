import 'server-only';
import { scrubString, scrubValue } from './scrub';
import { getContext } from '@/lib/telemetry';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  ts: string; // ISO-8601
  msg: string;
  code?: string; // MeritFlowErrorCode when available
  action?: string; // server action name (optional, caller-provided)
  requestId?: string; // per-HTTP-request id (ENGINEERING-20 — from telemetry context)
  traceId?: string; // per-server-action id (ENGINEERING-20 — from telemetry context)
  correlationId?: string; // commandId / workflow id (ENGINEERING-20 — from telemetry context)
  originalError?: unknown; // scrubbed raw infra error
  [key: string]: unknown;
}

function emit(entry: LogEntry): void {
  try {
    // Structured single-line JSON — the only place in the app that writes to the console.
    console.error(JSON.stringify(entry));
  } catch {
    console.error('[logger] failed to serialize log entry');
  }
}

/**
 * Merge the ambient telemetry context (requestId/traceId/correlationId/org/action — opaque ids,
 * NOT scrubbed) with the caller's scrubbed extras. Caller extras win on conflict. Outside any
 * request scope getContext() is empty, so nothing is added (existing callers are unaffected).
 */
function withCorrelation(extras: Record<string, unknown>): Record<string, unknown> {
  const ctx = getContext();
  const base: Record<string, unknown> = {};
  if (ctx.requestId !== undefined) base.requestId = ctx.requestId;
  if (ctx.traceId !== undefined) base.traceId = ctx.traceId;
  if (ctx.correlationId !== undefined) base.correlationId = ctx.correlationId;
  if (ctx.organizationId !== undefined) base.organizationId = ctx.organizationId;
  if (ctx.action !== undefined) base.action = ctx.action;
  return { ...base, ...(scrubValue(extras) as Record<string, unknown>) };
}

export function logError(
  msg: string,
  extras: Omit<LogEntry, 'level' | 'ts' | 'msg'> = {},
): void {
  emit({
    level: 'error',
    ts: new Date().toISOString(),
    msg: scrubString(msg),
    ...withCorrelation(extras),
  } as LogEntry);
}

/**
 * Structured info-level telemetry (ENGINEERING-15 command tracing). Same scrubbed, single-line
 * JSON sink as {@link logError}; used to record a stable commandId/correlationId per critical
 * mutation so a retry is traceable end-to-end (never carries a secret — extras are scrubbed).
 */
export function logInfo(
  msg: string,
  extras: Omit<LogEntry, 'level' | 'ts' | 'msg'> = {},
): void {
  emit({
    level: 'info',
    ts: new Date().toISOString(),
    msg: scrubString(msg),
    ...withCorrelation(extras),
  } as LogEntry);
}
