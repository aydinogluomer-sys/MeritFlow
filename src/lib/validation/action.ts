import { z } from 'zod';
import { DomainError } from '@/lib/errors';
import { captureServerError } from '@/lib/logger';
import { runWithContext } from '@/lib/telemetry';

/**
 * Result of a validated Server Action. Never throws to the client; validation and
 * expected domain errors are returned as a discriminated union.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Wrap a Server Action so its input is parsed with Zod at the boundary before the
 * handler runs. Handlers should still perform server-side authz (requirePermission)
 * and rely on RLS as the ultimate guard. Domain schemas arrive with each domain phase.
 */
export function validatedAction<Schema extends z.ZodTypeAny, Result>(
  schema: Schema,
  handler: (input: z.infer<Schema>) => Promise<Result>,
): (raw: unknown) => Promise<ActionResult<Result>> {
  return async (raw: unknown): Promise<ActionResult<Result>> => {
    // ENGINEERING-20 (§9A): open a per-action telemetry context so the logger/capture path
    // auto-attaches correlation ids. requestId comes from the proxy's x-request-id header (best
    // effort — headers() throws outside a request scope, e.g. in unit tests / jobs, which is fine);
    // traceId is fresh per server action.
    let requestId: string | undefined;
    try {
      const { headers } = await import('next/headers');
      requestId = (await headers()).get('x-request-id') ?? undefined;
    } catch {
      // not in an HTTP request scope — no requestId
    }
    const traceId = crypto.randomUUID();

    return runWithContext({ requestId, traceId }, async (): Promise<ActionResult<Result>> => {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: 'VALIDATION_ERROR',
          fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
        };
      }

      try {
        const data = await handler(parsed.data as z.infer<Schema>);
        return { ok: true, data };
      } catch (err) {
        // Typed domain errors cross the boundary as a stable code only — never a raw message.
        // (ENGINEERING-03a foundation; repositories throw DomainError since 03b.)
        if (err instanceof DomainError) {
          // Only unexpected infra failures warrant capture; FORBIDDEN/RLS_DENIED/CONFLICT/
          // NOT_FOUND are expected outcomes. Fire-and-forget so logging never delays the result.
          if (err.code === 'INTERNAL') {
            void captureServerError(err.originalError ?? err, { code: err.code });
          }
          return err.fieldErrors
            ? { ok: false, error: err.code, fieldErrors: err.fieldErrors }
            : { ok: false, error: err.code };
        }
        // Non-DomainError: always unexpected — capture, then surface the message (backward-compat).
        void captureServerError(err);
        const message = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
        return { ok: false, error: message };
      }
    });
  };
}
