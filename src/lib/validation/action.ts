import { z } from 'zod';

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
      const message = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
      return { ok: false, error: message };
    }
  };
}
