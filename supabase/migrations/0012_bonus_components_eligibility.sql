-- =============================================================================
-- Migration 0012 — bonus_pool_components + bonus_pool_eligibility  (Phase 3)
-- Refs: 14_DATA_DICTIONARY (bonus_pool_components / bonus_pool_eligibility),
--       15_RLS_POLICY_MATRIX (bonus_* §), 16 (SI-4/SI-6/SI-7), ADR-002/006/018,
--       Decision Lock D1/D10/AD9/AD10. Phase 3 slice ONLY.
--
-- Scope: bonus_pool_components (weight model — MVP Safe Pro-Rata: individual=1.0)
-- and bonus_pool_eligibility (period/pool eligibility rows), with constraints/
-- indexes, RLS (ENABLE + FORCE) + least-privilege grants + policies, audit
-- (components), the AD9 primary-team-derivation guard, structural same-org linkage
-- for employee + team, and locked-pool immutability of the calculation factors/inputs.
--
-- Integrity (this revision):
--   * eligibility.employee_id is structurally bound to the SAME org via a composite
--     FK -> memberships(organization_id, profile_id): the employee must be a member
--     of the eligibility organization (no cross-tenant employee, SI-7).
--   * eligibility.primary_team_id (when set) is structurally same-org via a composite
--     FK -> teams(id, organization_id), AND must be the employee's is_primary team
--     via the AD9 trigger (team_memberships.is_primary).
--   * Once the parent bonus_pool is no longer 'draft' (locked/superseded), component
--     and eligibility rows are IMMUTABLE (UPDATE blocked; DELETE already blocked) —
--     calculation factors/inputs cannot silently mutate after lock (SI-4/AD10). A
--     change requires a new pool version. Eligibility must therefore be populated
--     while the pool is draft (calc-input-before-lock model).
--
-- Chosen enforcement (D1): components CHECK (component='individual' AND weight=1.0)
-- + unique(pool,component) => Σweight=1.0 per pool trivially for MVP. Multi-component
-- Σweight=1.0 (Hybrid, ADR-002) is a V1 relaxation, not implemented here.
--
-- DELIBERATELY ABSENT (gated / later): bonus_calculation_runs, bonus_allocations,
-- bonus_allocation_snapshots, bonus_ledger, payout exports, the calculation engine,
-- tasks, disputes, anti-gaming, notifications, app/UI. No calc engine — eligibility
-- rows are STORED evidence/inputs. No edits to 0001..0011 / existing tests. Local
-- dev/staging only — never production (ADR-014).
-- =============================================================================

-- Additive (permitted ALTER on earlier tables; mirrors the 0009 pattern):
--   * bonus_pools unique(id, organization_id) — for child same-org composite FKs.
--   * teams unique(id, organization_id) — for the eligibility same-org team FK.
alter table public.bonus_pools
  add constraint bonus_pools_id_org_uq unique (id, organization_id);
alter table public.teams
  add constraint teams_id_org_uq unique (id, organization_id);

-- -----------------------------------------------------------------------------
-- validate_eligibility_primary_team(): if primary_team_id is set, it MUST be the
-- employee's primary team within the same org, sourced from team_memberships.is_primary
-- (AD9) — never from a memberships.primary_team_id (which does not exist). SECURITY
-- DEFINER so it can read team_memberships regardless of RLS.
-- -----------------------------------------------------------------------------
create or replace function public.validate_eligibility_primary_team()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.primary_team_id is not null then
    if not exists (
      select 1 from public.team_memberships tm
      where tm.profile_id = new.employee_id
        and tm.organization_id = new.organization_id
        and tm.team_id = new.primary_team_id
        and tm.is_primary = true
    ) then
      raise exception 'primary_team_id must be the employee primary team (team_memberships.is_primary; AD9)'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.validate_eligibility_primary_team() is
  'Ensures bonus_pool_eligibility.primary_team_id is the employee primary team from team_memberships.is_primary (AD9).';

-- -----------------------------------------------------------------------------
-- prevent_mutation_on_locked_pool(): a component/eligibility row is a calculation
-- factor/input tied to its bonus_pool. Once the parent pool is no longer 'draft'
-- (locked or superseded), the row is IMMUTABLE — a change requires a new pool
-- version (SI-4/AD10). Allowed only while the pool is draft. SECURITY DEFINER so it
-- can read bonus_pools regardless of RLS. (DELETE is separately globally blocked.)
-- -----------------------------------------------------------------------------
create or replace function public.prevent_mutation_on_locked_pool()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.bonus_pools
  where id = coalesce(new.bonus_pool_id, old.bonus_pool_id);

  if v_status is distinct from 'draft' then
    raise exception '% is immutable while its bonus_pool is not draft (locked/superseded — new pool version required; SI-4/AD10)',
      tg_table_name using errcode = '23001';
  end if;
  return coalesce(new, old);
end;
$$;

comment on function public.prevent_mutation_on_locked_pool() is
  'Freezes bonus_pool_components / bonus_pool_eligibility rows once the parent pool leaves draft (SI-4/AD10).';

-- -----------------------------------------------------------------------------
-- bonus_pool_components (weight model). MVP: individual = 1.0 only (D1). Financial.
-- -----------------------------------------------------------------------------
create table public.bonus_pool_components (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bonus_pool_id   uuid not null,
  component       text not null,
  weight          numeric not null,
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint bonus_pool_components_component_chk check (component in ('individual','team','quality','winner')),
  constraint bonus_pool_components_weight_chk    check (weight > 0 and weight <= 1),
  -- MVP Safe Pro-Rata (D1): only the individual component at weight 1.0. V1 (Hybrid,
  -- ADR-002) relaxes this to allow team/quality/winner with Σweight = 1.0 per pool.
  constraint bonus_pool_components_mvp_chk       check (component = 'individual' and weight = 1.0),
  constraint bonus_pool_components_unique unique (bonus_pool_id, component),
  constraint bonus_pool_components_pool_org_fk
    foreign key (bonus_pool_id, organization_id)
    references public.bonus_pools (id, organization_id) on delete cascade
);

comment on table public.bonus_pool_components is
  'Bonus pool weight model. MVP: single individual=1.0 component per pool (Safe Pro-Rata, D1); '
  'unique(pool,component) => Σweight=1.0 trivially. Immutable once parent pool leaves draft (SI-4/AD10). '
  'DELETE forbidden. RLS read HR/Finance/Auditor; write pool.create (Finance). Sensitivity: financial-critical.';

create index idx_bonus_pool_components_pool on public.bonus_pool_components (bonus_pool_id);

create trigger trg_bonus_pool_components_set_updated_at
  before update on public.bonus_pool_components
  for each row execute function public.set_updated_at();

create trigger trg_bonus_pool_components_locked_immutable
  before update on public.bonus_pool_components
  for each row execute function public.prevent_mutation_on_locked_pool();

create trigger trg_bonus_pool_components_prevent_delete
  before delete on public.bonus_pool_components
  for each row execute function public.prevent_delete();

create trigger trg_audit_bonus_pool_components
  after insert or update on public.bonus_pool_components
  for each row execute function public.log_audit();

-- -----------------------------------------------------------------------------
-- bonus_pool_eligibility (period/pool eligibility rows — D10). Confidential + financial.
-- Calculation input: STORED evidence here (no calc engine yet). Server-only writes.
-- -----------------------------------------------------------------------------
create table public.bonus_pool_eligibility (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  bonus_pool_id      uuid not null,
  employee_id        uuid not null,
  eligible           boolean not null,
  days_active        integer not null,
  eligibility_factor integer not null,
  proration_factor   numeric,                              -- factor over the cap (D10); 0..1
  primary_team_id    uuid,                                 -- derived from team_memberships.is_primary (AD9)
  reason             text,
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint bonus_pool_eligibility_factor_chk check (eligibility_factor in (0, 1)),
  constraint bonus_pool_eligibility_days_chk   check (days_active >= 0),
  -- eligibility_factor mirrors the eligible flag.
  constraint bonus_pool_eligibility_factor_mirror_chk
    check ((eligible and eligibility_factor = 1) or (not eligible and eligibility_factor = 0)),
  -- 15 active calendar days rule (D10): eligible => days_active >= 15 (evidence field;
  -- the active-membership part is verified by the producer at write time).
  constraint bonus_pool_eligibility_15day_chk
    check (not eligible or days_active >= 15),
  constraint bonus_pool_eligibility_proration_chk
    check (proration_factor is null or (proration_factor >= 0 and proration_factor <= 1)),
  constraint bonus_pool_eligibility_unique unique (bonus_pool_id, employee_id),
  constraint bonus_pool_eligibility_pool_org_fk
    foreign key (bonus_pool_id, organization_id)
    references public.bonus_pools (id, organization_id) on delete cascade,
  -- Same-org employee: the employee must be a member of the eligibility org (SI-7).
  constraint bonus_pool_eligibility_employee_org_fk
    foreign key (organization_id, employee_id)
    references public.memberships (organization_id, profile_id),
  -- Same-org primary team (structural); AD9 is-primary check enforced by trigger below.
  constraint bonus_pool_eligibility_team_org_fk
    foreign key (primary_team_id, organization_id)
    references public.teams (id, organization_id)
);

comment on table public.bonus_pool_eligibility is
  'Per (pool, employee) eligibility (D10): eligible + days_active (>=15 evidence) + eligibility_factor '
  '(mirrors eligible) + proration_factor (cap support) + derived primary_team_id. Employee is same-org '
  '(FK -> memberships); primary team is same-org (FK -> teams) and is_primary (AD9 trigger). Immutable '
  'once parent pool leaves draft (SI-4/AD10). Server-only writes; DELETE forbidden. RLS read '
  'HR/Finance/Auditor + employee-own. Sensitivity: confidential, financial-critical.';

create index idx_bonus_pool_eligibility_pool_emp
  on public.bonus_pool_eligibility (bonus_pool_id, employee_id);

create trigger trg_bonus_pool_eligibility_locked_immutable
  before update on public.bonus_pool_eligibility
  for each row execute function public.prevent_mutation_on_locked_pool();

create trigger trg_bonus_pool_eligibility_validate_team
  before insert or update on public.bonus_pool_eligibility
  for each row execute function public.validate_eligibility_primary_team();

create trigger trg_bonus_pool_eligibility_set_updated_at
  before update on public.bonus_pool_eligibility
  for each row execute function public.set_updated_at();

create trigger trg_bonus_pool_eligibility_prevent_delete
  before delete on public.bonus_pool_eligibility
  for each row execute function public.prevent_delete();

create trigger trg_audit_bonus_pool_eligibility
  after insert or update on public.bonus_pool_eligibility
  for each row execute function public.log_audit();

-- =============================================================================
-- RLS (ENABLE + FORCE) + least-privilege grants + policies
-- =============================================================================

-- bonus_pool_components: read HR/Finance/Auditor; write pool.create (Finance). No DELETE.
alter table public.bonus_pool_components enable row level security;
alter table public.bonus_pool_components force row level security;
revoke all on public.bonus_pool_components from anon, authenticated;
grant select, insert, update on public.bonus_pool_components to authenticated;   -- NO delete
grant all on public.bonus_pool_components to service_role;

create policy bonus_pool_components_select on public.bonus_pool_components
  for select to authenticated
  using (
    public.has_support_grant(organization_id)
    or (organization_id = public.current_org()
        and (public.has_role('hr') or public.has_role('finance') or public.has_role('auditor')))
  );

create policy bonus_pool_components_insert on public.bonus_pool_components
  for insert to authenticated
  with check (organization_id = public.current_org() and public.has_permission('pool.create'));

create policy bonus_pool_components_update on public.bonus_pool_components
  for update to authenticated
  using (organization_id = public.current_org() and public.has_permission('pool.create'))
  with check (organization_id = public.current_org() and public.has_permission('pool.create'));

-- bonus_pool_eligibility: read HR/Finance/Auditor + employee-own; writes SERVER-ONLY
--   (calculation input; no authenticated INSERT/UPDATE/DELETE — service_role writes).
alter table public.bonus_pool_eligibility enable row level security;
alter table public.bonus_pool_eligibility force row level security;
revoke all on public.bonus_pool_eligibility from anon, authenticated;
grant select on public.bonus_pool_eligibility to authenticated;                   -- SELECT only
grant all on public.bonus_pool_eligibility to service_role;

create policy bonus_pool_eligibility_select on public.bonus_pool_eligibility
  for select to authenticated
  using (
    public.has_support_grant(organization_id)
    or (organization_id = public.current_org()
        and (employee_id = auth.uid()
             or public.has_role('hr') or public.has_role('finance') or public.has_role('auditor')))
  );
-- No INSERT/UPDATE/DELETE policy and no privilege (server-only writes).
