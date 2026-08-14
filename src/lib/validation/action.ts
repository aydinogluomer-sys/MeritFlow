import { z } from 'zod';
import { DomainError } from '@/lib/errors';

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
      // (ENGINEERING-03a foundation; repositories start throwing DomainError in 03b.)
      if (err instanceof DomainError) {
        return err.fieldErrors
          ? { ok: false, error: err.code, fieldErrors: err.fieldErrors }
          : { ok: false, error: err.code };
      }
      // Backward-compatible fallback: until 03b migrates repositories, plain Errors still
      // surface their message (preserves existing behavior/tests).
      const message = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
      return { ok: false, error: message };
    }
  };
}
