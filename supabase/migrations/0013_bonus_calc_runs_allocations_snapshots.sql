-- =============================================================================
-- Migration 0013 — bonus_calculation_runs + bonus_allocations +
--                   bonus_allocation_snapshots foundation  (Phase 3)
-- Refs: 14_DATA_DICTIONARY (bonus_calculation_runs / bonus_allocations /
--       bonus_allocation_snapshots), 15_RLS_POLICY_MATRIX (bonus_* §104-110),
--       16 (§4 run machine, §5 allocation machine, SI-3/SI-4/SI-6/SI-7/SI-12/
--       SI-13/SI-14), ADR-006/007/017/018, Decision Lock D1/D6/D10/AD6/AD7/AD8/AD9/
--       AD10. Phase 3 slice ONLY.
--
-- Scope: the calculation SCAFFOLDING — run header + per-employee allocation rows +
-- an immutable thin freeze marker (snapshot). Constraints/indexes, RLS (ENABLE +
-- FORCE) + least-privilege grants + policies, audit (run + snapshot), the run state
-- machine (running/completed/superseded) with AD10 locked-period guard, structural
-- same-org composite FKs, per-row cap-not-exceeded CHECK, cap_applied enum (incl.
-- pending_missing_cap_basis), allocation freeze once the run leaves 'running', and a
-- guard deferring approved/exported/paid to a later phase.
--
-- Confirmed design decisions (this slice):
--   (1) bonus_allocation_snapshots is a THIN freeze marker/metadata table (run-level
--       frozen fields + undistributed_remainder + calculation_metadata) — it does NOT
--       duplicate the per-employee rows (those live in bonus_allocations and freeze
--       with the run). This intentionally diverges from doc 14's `allocations jsonb`
--       (thick-snapshot) sketch; the freeze guarantee (SI-14/AD7) is met by (a) an
--       append-only immutable snapshot row + (b) allocations frozen once run completed.
--   (2) Σ(final_amount_minor) + undistributed_remainder = pool (SI-13/INV-4) is a
--       cross-row aggregate: it is NOT a hard DB CHECK/trigger here — only documented
--       and seed/test-verified. Real enforcement is calculation-engine-time (Phase 6).
--   (3) status enum defines approved/exported/paid for forward-compat, but writing
--       those values is BLOCKED by trigger in this slice (approval/export/payout are
--       later phases).
--
-- DELIBERATELY ABSENT (gated / later): the calculation ENGINE/math (pro-rata,
-- rounding/largest-remainder, T_org application, top-up decision, deriving
-- adjusted_score from point_ledger, reading cap_basis from compensation_records — no
-- table is auto-populated here), bonus_ledger + approve->accrual, payout/export +
-- v_finance_* views, dispute->new-run wiring, scoring engine, app/UI/API,
-- notifications. No edits to 0001..0012 / existing tests. Local dev/staging only —
-- never production (ADR-014).
-- =============================================================================

-- Note: the same-org composite FK to the locked policy version (AD7) reuses the
-- EXISTING scoring_policy_versions unique(id, organization_id) constraint added by
-- migration 0009 (scoring_policy_versions_id_org_uq) — no additional ALTER needed.

-- -----------------------------------------------------------------------------
-- validate_calculation_run(): enforce the doc-16 §4 run state machine + AD10.
-- On INSERT a run must start 'running' and BOTH its parent bonus_period AND the
-- referenced bonus_pool must be locked — a run cannot start on an 'open' period nor on
-- a draft/superseded pool (AD10). The pool check is independent of the period's AD10
-- guard: although a locked period implies SOME locked pool exists, the run points at a
-- SPECIFIC bonus_pool_id, which must itself be 'locked'. On UPDATE only
-- running->completed and completed->superseded are allowed. SECURITY DEFINER so the
-- period/pool lookups bypass RLS; org-scoped by the run row itself.
-- -----------------------------------------------------------------------------
create or replace function public.validate_calculation_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_status text;
  v_pool_status   text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'running' then
      raise exception 'bonus_calculation_run must start in status running (got %)', new.status
        using errcode = '23514';
    end if;
    select status into v_period_status from public.bonus_periods where id = new.bonus_period_id;
    if v_period_status not in ('locked', 'calculated', 'approved', 'exported') then
      raise exception 'bonus_calculation_run requires a locked bonus_period (AD10; period status is %)',
        coalesce(v_period_status, '<none>') using errcode = '23514';
    end if;
    select status into v_pool_status from public.bonus_pools where id = new.bonus_pool_id;
    if v_pool_status is distinct from 'locked' then
      raise exception 'bonus_calculation_run requires a locked bonus_pool (AD10; pool status is %)',
        coalesce(v_pool_status, '<none>') using errcode = '23514';
    end if;
    return new;
  end if;

  -- UPDATE: non-status field changes (completed_at/superseded_by/notes) are allowed.
  if new.status = old.status then
    return new;
  end if;
  if not (
       (old.status = 'running'   and new.status = 'completed')
    or (old.status = 'completed' and new.status = 'superseded')
  ) then
    raise exception 'invalid bonus_calculation_run transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.validate_calculation_run() is
  'Enforces the bonus_calculation_run state machine (doc 16 §4) + AD10 locked-period-before-run guard.';

-- -----------------------------------------------------------------------------
-- prevent_mutation_on_completed_run(): an allocation is a calculation output tied to
-- its run. It may be written/edited only while the parent run is 'running'; once the
-- run is 'completed' or 'superseded', allocation rows are IMMUTABLE (a change needs a
-- new run — SI-4/SI-14). Blocks INSERT and UPDATE. SECURITY DEFINER so it can read
-- bonus_calculation_runs regardless of RLS. (DELETE is separately blocked.)
-- -----------------------------------------------------------------------------
create or replace function public.prevent_mutation_on_completed_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.bonus_calculation_runs
  where id = coalesce(new.calculation_run_id, old.calculation_run_id);

  if v_status is distinct from 'running' then
    raise exception 'bonus_allocations is immutable once its calculation_run is not running (completed/superseded — new run required; SI-4/SI-14)'
      using errcode = '23001';
  end if;
  return coalesce(new, old);
end;
$$;

comment on function public.prevent_mutation_on_completed_run() is
  'Freezes bonus_allocations rows once the parent calculation_run leaves running (SI-4/SI-14).';

-- -----------------------------------------------------------------------------
-- validate_allocation_status(): in THIS slice, allocations may only be draft /
-- calculated / pending_missing_cap_basis. Writing approved / exported / paid is
-- deferred to a later phase (approval/export/payout) and is rejected here — the enum
-- keeps those values only for forward-compatibility. (Decision 3.)
-- -----------------------------------------------------------------------------
create or replace function public.validate_allocation_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('approved', 'exported', 'paid') then
    raise exception 'bonus_allocations status % (approval/export/payout) is deferred to a later phase — not writable in this slice',
      new.status using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.validate_allocation_status() is
  'Blocks approved/exported/paid allocation statuses in this slice (forward-compat enum; later phase).';

-- =============================================================================
-- bonus_calculation_runs (run header; idempotent — one snapshot per run). Financial.
-- =============================================================================
create table public.bonus_calculation_runs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  bonus_period_id   uuid not null,
  bonus_pool_id     uuid not null,
  policy_version_id uuid,                                  -- locked scoring policy version (AD7); null ok
  status            text not null default 'running',
  idempotency_key   text not null,                         -- re-trigger with same key => no new run
  t_org             numeric,                               -- snapshot of pool T_org at run time
  top_up_applied    boolean not null default false,       -- AD8
  notes             text,
  superseded_by     uuid references public.bonus_calculation_runs(id),
  triggered_by      uuid not null references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz,
  constraint bonus_calculation_runs_status_chk check (status in ('running', 'completed', 'superseded')),
  constraint bonus_calculation_runs_torg_chk   check (t_org is null or t_org in (0, 0.5, 0.75, 1, 1.2)),
  -- Idempotency: one run per (org, idempotency_key) — a second identical trigger fails.
  constraint bonus_calculation_runs_idem_uq unique (organization_id, idempotency_key),
  -- composite unique so children (allocations/snapshots) reference (id, org) same-org.
  constraint bonus_calculation_runs_id_org_uq unique (id, organization_id),
  constraint bonus_calculation_runs_period_org_fk
    foreign key (bonus_period_id, organization_id)
    references public.bonus_periods (id, organization_id) on delete cascade,
  constraint bonus_calculation_runs_pool_org_fk
    foreign key (bonus_pool_id, organization_id)
    references public.bonus_pools (id, organization_id) on delete cascade,
  constraint bonus_calculation_runs_policy_org_fk
    foreign key (policy_version_id, organization_id)
    references public.scoring_policy_versions (id, organization_id)
);

comment on table public.bonus_calculation_runs is
  'Bonus calculation run header (doc 16 §4): running->completed->superseded. Idempotent per '
  '(org, idempotency_key). Starts only on a locked period (AD10). Server-only writes; DELETE '
  'forbidden. RLS read HR/Finance/Auditor. Sensitivity: financial-critical, audit-critical.';

create index idx_bonus_calc_runs_period_status on public.bonus_calculation_runs (bonus_period_id, status);

create trigger trg_bonus_calc_runs_set_updated_at
  before update on public.bonus_calculation_runs
  for each row execute function public.set_updated_at();

create trigger trg_bonus_calc_runs_validate
  before insert or update on public.bonus_calculation_runs
  for each row execute function public.validate_calculation_run();

create trigger trg_bonus_calc_runs_prevent_delete
  before delete on public.bonus_calculation_runs
  for each row execute function public.prevent_delete();

create trigger trg_audit_bonus_calc_runs
  after insert or update on public.bonus_calculation_runs
  for each row execute function public.log_audit();

-- =============================================================================
-- bonus_allocations (per-employee computed line items). Financial-critical.
-- Calculation OUTPUT: rows are STORED here by the (future) engine; this slice only
-- provides the container + guarantees. Server-only writes. Frozen once run completed.
-- =============================================================================
create table public.bonus_allocations (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations(id) on delete cascade,
  calculation_run_id        uuid not null,
  bonus_period_id           uuid not null,
  employee_id               uuid not null,
  primary_team_id           uuid,                          -- derived is_primary snapshot (AD9)
  adjusted_score            numeric not null,
  raw_share_minor           bigint not null,
  final_amount_minor        bigint not null,
  cap_basis_minor           bigint,
  cap_minor                 bigint,
  cap_applied               text not null default 'no',
  rounding_adjustment_minor bigint not null default 0,
  factors                   jsonb not null default '{}'::jsonb,  -- role/quality/team/eligibility/proration
  status                    text not null default 'draft',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint bonus_allocations_status_chk
    check (status in ('draft', 'calculated', 'pending_missing_cap_basis', 'approved', 'exported', 'paid')),
  constraint bonus_allocations_cap_applied_chk
    check (cap_applied in ('yes', 'no', 'pending_missing_cap_basis')),
  constraint bonus_allocations_amounts_nonneg_chk
    check (raw_share_minor >= 0 and final_amount_minor >= 0),
  -- Per-row cap-not-exceeded (INV-4): when a cap is applied, final <= cap.
  constraint bonus_allocations_cap_not_exceeded_chk
    check (cap_applied <> 'yes' or (cap_minor is not null and final_amount_minor <= cap_minor)),
  -- A pending_missing_cap_basis allocation must carry the pending cap marker (AD6).
  constraint bonus_allocations_pending_mirror_chk
    check (status <> 'pending_missing_cap_basis' or cap_applied = 'pending_missing_cap_basis'),
  constraint bonus_allocations_run_emp_uq unique (calculation_run_id, employee_id),
  constraint bonus_allocations_run_org_fk
    foreign key (calculation_run_id, organization_id)
    references public.bonus_calculation_runs (id, organization_id) on delete cascade,
  constraint bonus_allocations_period_org_fk
    foreign key (bonus_period_id, organization_id)
    references public.bonus_periods (id, organization_id) on delete cascade,
  -- Same-org employee: must be a member of the allocation org (SI-7).
  constraint bonus_allocations_employee_org_fk
    foreign key (organization_id, employee_id)
    references public.memberships (organization_id, profile_id),
  -- Same-org primary team (structural); AD9 is_primary enforced by trigger below.
  constraint bonus_allocations_team_org_fk
    foreign key (primary_team_id, organization_id)
    references public.teams (id, organization_id)
);

comment on table public.bonus_allocations is
  'Per (run, employee) computed allocation (doc 16 §5). status draft/calculated/'
  'pending_missing_cap_basis reachable here; approved/exported/paid deferred (trigger). Same-org '
  'employee (memberships FK) + same-org is_primary team (teams FK + AD9 trigger). Frozen once run '
  'leaves running (SI-4/SI-14). Server-only writes; DELETE forbidden. RLS read employee-own + '
  'HR/Auditor (Finance view-only, SI-12). Sensitivity: financial-critical.';

create index idx_bonus_allocations_period_emp on public.bonus_allocations (bonus_period_id, employee_id);
create index idx_bonus_allocations_run_status on public.bonus_allocations (calculation_run_id, status);

-- Freeze first (alphabetical trg name ordering) so a completed-run edit surfaces the
-- freeze (23001) before status/team validation.
create trigger trg_bonus_allocations_freeze_on_completed_run
  before insert or update on public.bonus_allocations
  for each row execute function public.prevent_mutation_on_completed_run();

create trigger trg_bonus_allocations_set_updated_at
  before update on public.bonus_allocations
  for each row execute function public.set_updated_at();

create trigger trg_bonus_allocations_validate_status
  before insert or update on public.bonus_allocations
  for each row execute function public.validate_allocation_status();

-- Reuse the AD9 is_primary validator (generic NEW-row check on org/employee/team).
create trigger trg_bonus_allocations_validate_team
  before insert or update on public.bonus_allocations
  for each row execute function public.validate_eligibility_primary_team();

create trigger trg_bonus_allocations_prevent_delete
  before delete on public.bonus_allocations
  for each row execute function public.prevent_delete();

-- =============================================================================
-- bonus_allocation_snapshots (THIN immutable freeze marker — one per run). Financial.
-- Append-only + immutable (INV-6/SI-14): no UPDATE/DELETE. Per-employee detail is NOT
-- duplicated here (it lives in bonus_allocations, frozen with the run — decision 1).
-- =============================================================================
create table public.bonus_allocation_snapshots (
  id                            uuid primary key default gen_random_uuid(),
  organization_id               uuid not null references public.organizations(id) on delete cascade,
  calculation_run_id            uuid not null,
  bonus_period_id               uuid not null,
  bonus_pool_id                 uuid not null,
  policy_version_id             uuid,
  t_org                         numeric,
  top_up_applied                boolean not null default false,
  undistributed_remainder_minor bigint not null default 0,
  calculation_metadata          jsonb not null default '{}'::jsonb,
  approved_by                   uuid references public.profiles(id),   -- forward-compat (approval later phase)
  approved_at                   timestamptz,
  created_at                    timestamptz not null default now(),
  constraint bonus_allocation_snapshots_torg_chk
    check (t_org is null or t_org in (0, 0.5, 0.75, 1, 1.2)),
  constraint bonus_allocation_snapshots_remainder_nonneg_chk
    check (undistributed_remainder_minor >= 0),
  -- One snapshot per run (idempotent freeze).
  constraint bonus_allocation_snapshots_run_uq unique (calculation_run_id),
  constraint bonus_allocation_snapshots_run_org_fk
    foreign key (calculation_run_id, organization_id)
    references public.bonus_calculation_runs (id, organization_id) on delete cascade,
  constraint bonus_allocation_snapshots_period_org_fk
    foreign key (bonus_period_id, organization_id)
    references public.bonus_periods (id, organization_id) on delete cascade,
  constraint bonus_allocation_snapshots_pool_org_fk
    foreign key (bonus_pool_id, organization_id)
    references public.bonus_pools (id, organization_id) on delete cascade,
  constraint bonus_allocation_snapshots_policy_org_fk
    foreign key (policy_version_id, organization_id)
    references public.scoring_policy_versions (id, organization_id)
);

comment on table public.bonus_allocation_snapshots is
  'Thin immutable freeze marker per calculation run (INV-6/SI-14/AD7): run-level frozen fields '
  '(t_org/top_up/policy_version) + undistributed_remainder + calculation_metadata. Per-employee '
  'detail lives in bonus_allocations (frozen with the run), not duplicated here. Append-only '
  '(no UPDATE/DELETE). Server-only writes. RLS read HR/Finance/Auditor. Sensitivity: '
  'financial-critical, audit-critical.';

create index idx_bonus_allocation_snapshots_period on public.bonus_allocation_snapshots (bonus_period_id);

-- Append-only: block UPDATE and DELETE entirely (immutable proof).
create trigger trg_bonus_allocation_snapshots_append_only
  before update or delete on public.bonus_allocation_snapshots
  for each row execute function public.prevent_mutation();

create trigger trg_audit_bonus_allocation_snapshots
  after insert on public.bonus_allocation_snapshots
  for each row execute function public.log_audit();

-- =============================================================================
-- RLS (ENABLE + FORCE) + least-privilege grants + policies
-- All three tables: SERVER-ONLY writes (calculation is trusted/server; no client
-- write path in this slice). authenticated gets SELECT only.
-- =============================================================================

-- bonus_calculation_runs: read HR/Finance/Auditor (financial; Employee/Manager excluded).
alter table public.bonus_calculation_runs enable row level security;
alter table public.bonus_calculation_runs force row level security;
revoke all on public.bonus_calculation_runs from anon, authenticated;
grant select on public.bonus_calculation_runs to authenticated;                  -- SELECT only
grant all on public.bonus_calculation_runs to service_role;

create policy bonus_calc_runs_select on public.bonus_calculation_runs
  for select to authenticated
  using (
    public.has_support_grant(organization_id)
    or (organization_id = public.current_org()
        and (public.has_role('hr') or public.has_role('finance') or public.has_role('auditor')))
  );
-- No INSERT/UPDATE/DELETE policy and no privilege (server-only writes).

-- bonus_allocations: read employee-own + HR + Auditor. Finance is VIEW-ONLY (SI-12) —
-- excluded from raw allocation SELECT (v_finance_* is a later slice).
alter table public.bonus_allocations enable row level security;
alter table public.bonus_allocations force row level security;
revoke all on public.bonus_allocations from anon, authenticated;
grant select on public.bonus_allocations to authenticated;                        -- SELECT only
grant all on public.bonus_allocations to service_role;

create policy bonus_allocations_select on public.bonus_allocations
  for select to authenticated
  using (
    public.has_support_grant(organization_id)
    or (organization_id = public.current_org()
        and (employee_id = auth.uid() or public.has_role('hr') or public.has_role('auditor')))
  );
-- No INSERT/UPDATE/DELETE policy and no privilege (server-only writes).

-- bonus_allocation_snapshots: read HR/Finance/Auditor (financial summary marker).
alter table public.bonus_allocation_snapshots enable row level security;
alter table public.bonus_allocation_snapshots force row level security;
revoke all on public.bonus_allocation_snapshots from anon, authenticated;
grant select on public.bonus_allocation_snapshots to authenticated;               -- SELECT only
grant all on public.bonus_allocation_snapshots to service_role;

create policy bonus_allocation_snapshots_select on public.bonus_allocation_snapshots
  for select to authenticated
  using (
    public.has_support_grant(organization_id)
    or (organization_id = public.current_org()
        and (public.has_role('hr') or public.has_role('finance') or public.has_role('auditor')))
  );
-- No INSERT/UPDATE/DELETE policy and no privilege (server-only, append-only writes).
