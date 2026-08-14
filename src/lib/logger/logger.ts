import 'server-only';
import { scrubString, scrubValue } from './scrub';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  ts: string; // ISO-8601
  msg: string;
  code?: string; // MeritFlowErrorCode when available
  action?: string; // server action name (optional, caller-provided)
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

export function logError(
  msg: string,
  extras: Omit<LogEntry, 'level' | 'ts' | 'msg'> = {},
): void {
  emit({
    level: 'error',
    ts: new Date().toISOString(),
    msg: scrubString(msg),
    ...(scrubValue(extras) as Record<string, unknown>),
  } as LogEntry);
}
