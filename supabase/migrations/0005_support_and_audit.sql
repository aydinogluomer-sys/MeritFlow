-- =============================================================================
-- Migration 0005 — Support access & audit
-- Phase 3A: support_access_grants, audit_logs (append-only skeleton) + triggers
-- Refs: 14_DATA_DICTIONARY, 16 (support grant machine), Decision Lock D4/AD3
--   - audit_logs is APPEND-ONLY (UPDATE/DELETE blocked by trigger).
--   - audit_logs fields are AD3-forward-compatible (before/after + is_sensitive)
--     so comp masking (later slice) needs no breaking change.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- support_access_grants (tenant-scoped; time-bounded; default no-access — D4)
-- -----------------------------------------------------------------------------
create table public.support_access_grants (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  grantee_id      uuid not null references public.profiles(id),
  scope           text not null,
  granted_by      uuid not null references public.profiles(id),
  expires_at      timestamptz not null,
  status          text not null default 'active',
  revoked_at      timestamptz,
  reason          text,
  created_at      timestamptz not null default now(),
  constraint support_access_grants_status_chk check (status in ('active', 'expired', 'revoked')),
  constraint support_access_grants_expiry_chk check (expires_at > created_at)
);

comment on table public.support_access_grants is
  'Time-bounded, scoped support access (D4). Default = no tenant access. '
  'Every grant + every support access is audited. Sensitivity: audit-critical.';

create index idx_support_grants_lookup
  on public.support_access_grants (organization_id, status, expires_at);

-- -----------------------------------------------------------------------------
-- audit_logs (tenant-scoped, APPEND-ONLY skeleton)
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id        uuid references public.profiles(id),
  action          text not null,
  target_type     text,
  target_id       uuid,
  before          jsonb,
  after           jsonb,
  reason          text,
  is_sensitive    boolean not null default false,
  request_context jsonb,
  created_at      timestamptz not null default now()
);

comment on table public.audit_logs is
  'Append-only audit (UPDATE/DELETE blocked). before/after + is_sensitive are '
  'AD3-forward-compatible for comp masking in a later slice. Sensitivity: audit-critical.';

create index idx_audit_logs_org_action_time
  on public.audit_logs (organization_id, action, created_at);
create index idx_audit_logs_target on public.audit_logs (target_id);

-- APPEND-ONLY enforcement (SI-2 family): block UPDATE/DELETE for everyone,
-- including bypassrls roles (trigger is SECURITY DEFINER and unconditional).
create trigger trg_audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function public.prevent_mutation();

-- -----------------------------------------------------------------------------
-- log_audit(): generic AFTER trigger writing an audit row for sensitive
-- tenant mutations (membership/role assignment, settings, teams, support).
-- SECURITY DEFINER so the audit INSERT bypasses audit_logs RLS.
-- Catalog tables (roles/permissions/role_permissions) are system-managed and
-- audited at the migration/release layer; custom-role row audit is V1.
-- -----------------------------------------------------------------------------
create or replace function public.log_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_actor uuid;
begin
  v_actor := auth.uid();
  v_org := coalesce(
    case when tg_op = 'DELETE' then old.organization_id else new.organization_id end,
    public.current_org()
  );

  insert into public.audit_logs (
    organization_id, actor_id, action, target_type, target_id, before, after
  )
  values (
    v_org,
    v_actor,
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(new.id, old.id),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  return coalesce(new, old);
end;
$$;

comment on function public.log_audit() is
  'Generic audit trigger for sensitive tenant mutations. Writes append-only audit_logs row.';

-- Note: public.current_org() is created in migration 0006; log_audit() resolves
-- it at call time (deferred name resolution), and triggers below only fire on
-- DML which always occurs after 0006/0007 have run. v_org also has a direct
-- NEW/OLD.organization_id source, so current_org() is only a fallback.

create trigger trg_audit_organization_settings
  after insert or update or delete on public.organization_settings
  for each row execute function public.log_audit();

create trigger trg_audit_memberships
  after insert or update or delete on public.memberships
  for each row execute function public.log_audit();

create trigger trg_audit_teams
  after insert or update or delete on public.teams
  for each row execute function public.log_audit();

create trigger trg_audit_team_memberships
  after insert or update or delete on public.team_memberships
  for each row execute function public.log_audit();

create trigger trg_audit_support_access_grants
  after insert or update or delete on public.support_access_grants
  for each row execute function public.log_audit();
