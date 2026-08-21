import 'server-only';
// ENGINEERING-20 (§9A) — request-scoped telemetry context via AsyncLocalStorage. A server action
// opens a scope with runWithContext({ requestId, traceId }); everything it awaits (application →
// repository → RPC → logger) reads the same context with getContext(), so correlation ids are
// attached WITHOUT threading them through every function signature.
//
// NOTE: AsyncLocalStorage is a Node.js primitive — it does NOT work in the Edge runtime. proxy.ts
// runs on the Edge and MUST NOT import this module; it mints the requestId into the x-request-id
// header, which validatedAction reads (Node runtime) and puts into a context scope here.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { TelemetryContext } from './types';

const storage = new AsyncLocalStorage<TelemetryContext>();

/** Run `fn` with `ctx` as the ambient telemetry context for its whole async subtree. */
export function runWithContext<T>(ctx: TelemetryContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The ambient telemetry context, or an empty object when called outside any scope. */
export function getContext(): TelemetryContext {
  return storage.getStore() ?? {};
}
