-- =============================================================================
-- Migration 0009 — Point ledger (append-only) + team_of() helper   (Phase 3B-B)
-- Refs: 18_PHASE_3B... §5.3/§5.5/§6.3/§7, 14_DATA_DICTIONARY (point_ledger),
--       15_RLS_POLICY_MATRIX (point_ledger), 16 (SI-1/SI-2/SI-7), ADR-005/ADR-012,
--       Decision Lock. Phase 3B-B ONLY.
--
-- Scope: team_of() helper, point_ledger table (append-only), its RLS (ENABLE +
-- FORCE) + SELECT-only grant + policy, the conditional audit trigger for the two
-- 3B event types, and same-org composite-FK integrity. Plus an ADDITIVE
-- unique (id, organization_id) on scoring_policy_versions so point_ledger can
-- reference it with a same-org composite FK (allowed additive ALTER per the gate).
--
-- DELIBERATELY ABSENT (gated): task_id, bonus_period_id, updated_at, and the event
-- types task_approved / dispute_adjustment / anomaly_* / period_locked (no producer
-- exists yet — each later phase widens the CHECK). point_ledger writes are
-- SERVER-ONLY: no authenticated INSERT/UPDATE/DELETE privilege or policy (§5.5
-- decision 2; ADR-012). Correction = reversal row (append-only, ADR-005/SI-2).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- team_of(employee): the employee's PRIMARY team id within current_org(), else
-- null. Canonical source = team_memberships.is_primary (AD9); NEVER
-- memberships.primary_team_id (which does not exist). SECURITY DEFINER + fixed
-- search_path so reading team_memberships does not re-enter RLS (no recursion,
-- same guarantee as the 3A helpers). Anchored on current_org() => cannot resolve
-- a primary team across tenants, and returns null when there is no org context.
-- -----------------------------------------------------------------------------
create or replace function public.team_of(p_employee uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tm.team_id
  from public.team_memberships tm
  where tm.profile_id = p_employee
    and tm.organization_id = public.current_org()
    and tm.is_primary = true
  limit 1;
$$;

comment on function public.team_of(uuid) is
  'Primary team id of the employee within current_org() (team_memberships.is_primary, '
  'AD9); null if none / other org / no org context. SECURITY DEFINER + fixed search_path.';

revoke execute on function public.team_of(uuid) from public, anon;
grant execute on function public.team_of(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Additive: scoring_policy_versions needs unique (id, organization_id) so a
-- same-org composite FK from point_ledger can target it. (Additive ALTER on an
-- earlier table, permitted by the slice rules.)
-- -----------------------------------------------------------------------------
alter table public.scoring_policy_versions
  add constraint scoring_policy_versions_id_org_uq unique (id, organization_id);

-- -----------------------------------------------------------------------------
-- point_ledger (append-only, single-entry — ADR-005). NO task_id/bonus_period_id.
-- -----------------------------------------------------------------------------
create table public.point_ledger (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations(id) on delete cascade,
  employee_id               uuid not null references public.profiles(id),
  event_type                text not null,
  points_delta              numeric not null,
  reason                    text not null,
  scoring_policy_version_id uuid,
  reverses_entry_id         uuid,
  metadata                  jsonb,
  created_by                uuid not null references public.profiles(id),
  created_at                timestamptz not null default now(),
  -- Phase 3B minimal event vocabulary (§5.5 decision 4): only producible events.
  constraint point_ledger_event_type_chk
    check (event_type in ('manual_adjustment', 'reversal')),
  constraint point_ledger_reason_nonempty_chk
    check (btrim(reason) <> ''),
  -- A reversal must reference the entry it reverses; a manual_adjustment must not.
  constraint point_ledger_reversal_ref_chk
    check (event_type <> 'reversal' or reverses_entry_id is not null),
  constraint point_ledger_manual_no_ref_chk
    check (event_type <> 'manual_adjustment' or reverses_entry_id is null),
  -- Composite-unique so a reversal self-FK can enforce same-org linkage.
  constraint point_ledger_id_org_uq unique (id, organization_id),
  -- Same-org reversal linkage: a reversal cannot point across tenants (MATCH
  -- SIMPLE => not enforced when reverses_entry_id is null).
  constraint point_ledger_reverses_fk
    foreign key (reverses_entry_id, organization_id)
    references public.point_ledger (id, organization_id),
  -- Same-org policy-version linkage: nullable; when set it must be the same org
  -- (MATCH SIMPLE => not enforced when scoring_policy_version_id is null).
  constraint point_ledger_policy_version_fk
    foreign key (scoring_policy_version_id, organization_id)
    references public.scoring_policy_versions (id, organization_id)
);

comment on table public.point_ledger is
  'Append-only, single-entry point ledger (ADR-005). Employee totals derive from '
  'rows; no mutable total. Phase 3B events: manual_adjustment, reversal. '
  'Server-only writes (no client INSERT). Sensitivity: audit-critical, financial-critical.';

create index idx_point_ledger_org_employee on public.point_ledger (organization_id, employee_id);
create index idx_point_ledger_employee_created on public.point_ledger (employee_id, created_at);

-- Append-only (SI-2): block UPDATE/DELETE for everyone (trigger is SECURITY
-- DEFINER & unconditional). Correction = reversal row. Reuses the 3A function.
create trigger trg_point_ledger_append_only
  before update or delete on public.point_ledger
  for each row execute function public.prevent_mutation();

-- Conditional audit (INSERT only), Phase 3B event types only. The CHECK already
-- limits event_type to these two, but the WHEN clause is explicit and forward-safe.
create trigger trg_audit_point_ledger
  after insert on public.point_ledger
  for each row
  when (new.event_type in ('manual_adjustment', 'reversal'))
  execute function public.log_audit();

-- =============================================================================
-- RLS (ENABLE + FORCE) + SELECT-only grant + SELECT policy  (§6.3)
--   Writes are SERVER-ONLY: no INSERT/UPDATE/DELETE privilege or policy for
--   authenticated. service_role (bypassrls) is the trusted writer.
-- =============================================================================
alter table public.point_ledger enable row level security;
alter table public.point_ledger force row level security;
revoke all on public.point_ledger from anon, authenticated;
grant select on public.point_ledger to authenticated;   -- SELECT only; no I/U/D
grant all on public.point_ledger to service_role;

-- Support read is TOP-LEVEL (org-scoped, never nested under current_org so a
-- support actor with no membership still resolves). Finance has NO branch =>
-- no raw org-wide point_ledger access (SI-12). Employee = own rows; Manager =
-- managed primary-team members via team_of(); Owner/Admin/HR/Auditor = org rows.
create policy point_ledger_select on public.point_ledger
  for select to authenticated
  using (
    public.has_support_grant(organization_id)
    or (
      organization_id = public.current_org()
      and (
        employee_id = auth.uid()
        or public.manages_team(public.team_of(employee_id))
        or public.has_role('owner')
        or public.has_role('admin')
        or public.has_role('hr')
        or public.has_role('auditor')
      )
    )
  );
-- INSERT/UPDATE/DELETE: no policy and no privilege (server-only; append-only).
