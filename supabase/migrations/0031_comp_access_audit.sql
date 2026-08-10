-- =============================================================================
-- Migration 0031 — comp/sensitive raw-access audit (log_comp_access)  (Phase post-10-B)
-- Refs: 05_LEDGER_AUDIT_SPEC (comp access audit), Decision Lock AD3 (raw comp/sensitive
--       access is audited), CLAUDE.md (comp access/change → audit). Builds on 0005
--       (audit_logs append-only skeleton + prevent_mutation trigger).
--
-- Scope (post-10-B ONLY): the server-side audit CSV export path (export-audit.ts)
-- records an AD3 access-audit row when a caller who is allowed to see raw sensitive
-- payloads (audit.read + comp.read) actually exports a sensitive row. log_comp_access()
-- (SECURITY DEFINER, server-only) appends ONE append-only audit_logs row with
-- action = 'comp.raw_access', is_sensitive = true. The append-only trigger from 0005
-- still guards UPDATE/DELETE (errcode 23001). No edits to 0001..0030 or existing tests.
-- Local dev/staging only — never production (ADR-014).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- log_comp_access(org, actor, reason): append one AD3 raw-access audit row.
-- SECURITY DEFINER so the INSERT bypasses audit_logs RLS. server-only (revoked from
-- public/anon). Fail-closed: the caller (export-audit.ts) throws on error so no
-- unaudited raw comp/sensitive access can proceed.
-- -----------------------------------------------------------------------------
create function public.log_comp_access(
  p_organization_id uuid,
  p_actor_id        uuid,
  p_reason          text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (
    organization_id, actor_id, action, target_type, is_sensitive, reason
  ) values (
    p_organization_id, p_actor_id, 'comp.raw_access', 'audit_logs', true, p_reason
  );
end;
$$;

comment on function public.log_comp_access(uuid, uuid, text) is
  'AD3: logs raw comp/sensitive audit export access. SECURITY DEFINER, server-only.';

revoke execute on function public.log_comp_access(uuid, uuid, text) from public, anon;
grant execute on function public.log_comp_access(uuid, uuid, text) to authenticated, service_role;
