-- =============================================================================
-- Migration 0039 — ENGINEERING-15: command_log deduplication guard.
-- Generic idempotency table for critical mutations WITHOUT operation-specific DB uniqueness
-- (manual_override → append-only point_ledger; recalculate → RPC takes no idempotency key;
-- export_payout / grant_support_access / invite_member → no business-key unique constraint).
-- One row per (organization_id, operation_type, command_id); a second claim with the same triple
-- is a no-op. SECURITY DEFINER RPC wraps the insert; server-only writes.
--
-- Operations that already have a natural DB guard do NOT write here:
--   run_calculation      → bonus_calculation_runs unique(org, idempotency_key)
--   post_accrual         → bonus_ledger uq(snapshot_id, employee_id, account)
--   mark_paid / resolve_dispute / revoke_support_access → status-machine (transition-once)
-- (see src/lib/commands/command-meta.ts for the full catalog).
--
-- SECURITY DEFINER + fixed search_path = '' (§7A / ADR-014). Local dev/staging only.
-- =============================================================================

create table public.command_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation_type  text not null,
  command_id      uuid not null,
  actor_id        uuid,
  created_at      timestamptz not null default now(),
  constraint command_log_idem_uq unique (organization_id, operation_type, command_id)
);

comment on table public.command_log is
  'Generic deduplication guard (ENGINEERING-15). One row per (org, op, commandId). '
  'A second insert with the same triple is a no-op. Server-only writes via RPC. '
  'SECURITY DEFINER RPC; RLS SELECT for owner/admin only.';

create index idx_command_log_org_op on public.command_log (organization_id, operation_type);

-- =============================================================================
-- RLS (ENABLE + FORCE) — server-only writes; owner/admin read-only observability.
-- =============================================================================
alter table public.command_log enable row level security;
alter table public.command_log force row level security;
revoke all on public.command_log from anon, authenticated;
grant select on public.command_log to authenticated;
grant all on public.command_log to service_role;

create policy command_log_select on public.command_log
  for select to authenticated
  using (
    organization_id = public.current_org()
    and (public.has_role('owner') or public.has_role('admin'))
  );
-- No INSERT/UPDATE/DELETE policy: writes are server-only via the claim_command RPC below.

-- -----------------------------------------------------------------------------
-- claim_command(): atomic first-writer-wins claim. Inserts one (org, op, commandId) row;
-- a duplicate is absorbed by ON CONFLICT DO NOTHING. Returns true on the FIRST execution and
-- false when the command was already seen (idempotent duplicate). Never throws on a duplicate.
-- SECURITY DEFINER so a server action can record the claim regardless of command_log RLS.
-- -----------------------------------------------------------------------------
create or replace function public.claim_command(
  p_organization_id uuid,
  p_operation_type  text,
  p_command_id      uuid,
  p_actor_id        uuid default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.command_log (organization_id, operation_type, command_id, actor_id)
  values (p_organization_id, p_operation_type, p_command_id, p_actor_id)
  on conflict (organization_id, operation_type, command_id) do nothing;
  return found;  -- true = first execution, false = duplicate (already seen)
end;
$$;

comment on function public.claim_command(uuid, text, uuid, uuid) is
  'ENGINEERING-15 idempotency claim: inserts one (org, op, commandId) row, ON CONFLICT DO NOTHING. '
  'Returns true on first execution, false on a duplicate. SECURITY DEFINER; server-only.';

revoke execute on function public.claim_command(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.claim_command(uuid, text, uuid, uuid) to authenticated, service_role;
