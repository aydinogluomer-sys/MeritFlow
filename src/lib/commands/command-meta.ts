import 'server-only';

// =============================================================================
// ENGINEERING-15 — stable command idempotency.
//
// Every critical mutation carries a stable commandId, minted ONCE per user intent at the action
// boundary via newCommand(). A network retry of the same Server Action re-runs the same handler
// but — because the UI/runtime resends the same request — the DB is the ultimate duplicate guard:
// either an existing unique constraint absorbs the commandId, or the command_log table (0039) does.
//
// CRITICAL COMMAND CATALOG (10 operations) — how each is de-duplicated:
//
//   run_calculation      existing constraint  bonus_calculation_runs unique(org, idempotency_key)
//                        → commandId IS the idempotency_key (replaces the old Date.now() key)
//   recalculate          command_log          recalculate_bonus_after_dispute RPC takes NO
//                        idempotency param → claim_command guards the retry
//   post_accrual         status/natural       bonus_ledger uq(snapshot_id, employee_id, account)
//                        → accrual is idempotent per snapshot; commandId → telemetry
//   export_payout        command_log          exports has no business-key uniqueness → claim_command
//   mark_paid            status machine       allocation/export status exported→paid; telemetry
//   resolve_dispute      status machine       dispute status open→resolved (resolve-once); telemetry
//   manual_override      command_log          point_ledger is append-only (two calls = two rows)
//   invite_member        telemetry (deferred) invitations only unique(token); NON-financial, low
//                        duplicate harm → command_log DEFERRED (would change the return type and
//                        break the invite-form UI consumer, out of scope). commandId → telemetry.
//   grant_support_access telemetry (deferred) support_access_grants has no (org,grantee) uniqueness;
//                        NON-financial, D4-audited + time-bounded (a duplicate is visible + expires)
//                        → command_log DEFERRED (the admin characterization test does not mock a
//                        service_role client, out of scope). commandId → telemetry.
//   revoke_support_access status machine      grant status active→revoked (revoke-once); telemetry
//
// command_log operations call claim_command() BEFORE the mutation and return { alreadyProcessed:
// true } (idempotent success, NOT an error) when it reports a duplicate. The others mint commandId
// for correlation/telemetry only. See docs — this comment is the DoD "command catalog".
// =============================================================================

export type CommandMeta = {
  commandId: string; // UUID, minted once at the UI/action boundary; same on retry
  correlationId: string; // same as commandId unless chaining (outbox → next step)
};

export function newCommand(): CommandMeta {
  const id = crypto.randomUUID();
  return { commandId: id, correlationId: id };
}

// DESIGN CHOICE (spec §3 "document your choice"): commandId is a UI-SUPPLIED optional schema
// field, resolved at the action boundary via commandFrom(). Rationale: a stable commandId must
// survive a network RETRY of the Server Action — and a Server-Action retry re-runs the handler
// from scratch, so minting inside the action would produce a NEW id every time (exactly the
// Date.now() bug in a different costume). The UI mints once per user intent and RESENDS the same
// id on retry; only then does claim_command / the unique constraint actually de-duplicate.
// The field is OPTIONAL with a fallback mint so existing callers keep working during rollout —
// dedup across retries is only guaranteed once the caller supplies a stable commandId.

/** Resolve CommandMeta from an optional UI-supplied commandId; mints a stable one if absent. */
export function commandFrom(suppliedId?: string): CommandMeta {
  return suppliedId ? { commandId: suppliedId, correlationId: suppliedId } : newCommand();
}

/**
 * operation_type values written to command_log / emitted in telemetry. Stable strings — do not
 * rename without a data migration (they key the command_log dedup rows).
 */
export const COMMAND_OPERATIONS = {
  runCalculation: 'run_calculation',
  recalculate: 'recalculate',
  postAccrual: 'post_accrual',
  exportPayout: 'export_payout',
  markPaid: 'mark_paid',
  resolveDispute: 'resolve_dispute',
  manualOverride: 'manual_override',
  inviteMember: 'invite_member',
  grantSupportAccess: 'grant_support_access',
  revokeSupportAccess: 'revoke_support_access',
} as const;

export type CommandOperation = (typeof COMMAND_OPERATIONS)[keyof typeof COMMAND_OPERATIONS];
