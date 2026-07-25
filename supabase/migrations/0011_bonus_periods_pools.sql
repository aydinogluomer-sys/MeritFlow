-- =============================================================================
-- Migration 0011 — bonus_periods + bonus_pools foundation  (Phase 3)
-- Refs: 14_DATA_DICTIONARY (bonus_periods/bonus_pools), 15_RLS_POLICY_MATRIX
--       (bonus_periods/pools §), 16 (§3 bonus period machine, SI-4/SI-6/SI-7),
--       ADR-006/ADR-017/ADR-018, Decision Lock D11/AD8/AD10. Phase 3 slice ONLY.
--
-- Scope: bonus_periods (dönem yaşam döngüsü) + bonus_pools (dönem prim havuzu),
-- their constraints/indexes, RLS (ENABLE + FORCE) + least-privilege grants +
-- policies (period.manage / pool.create), audit triggers, a bonus-period state-
-- machine validator, the AD10 pool-lock-before-period-lock guard, and locked-pool
-- financial immutability (new version required — AD10). Blocking pgTAP in slice.
--
-- DELIBERATELY ABSENT (gated / later slices): bonus_pool_components,
-- bonus_pool_eligibility, bonus_calculation_runs, bonus_allocations,
-- bonus_allocation_snapshots, bonus_ledger, payout exports, the calculation engine,
-- tasks, app/UI/API. Missing cap basis (AD6) is only a FUTURE dependency here —
-- no calculation/allocation is implemented. No edits to 0001..0010 / existing tests.
-- Local dev/staging only — never production (ADR-014).
--
-- Simplification note: bonus_periods uniqueness is `(organization_id, starts_on,
-- ends_on)` (prevents identical periods) + `ends_on > starts_on`. Full overlap
-- prevention (exclusion constraint over a daterange) is deferred to a later slice
-- to avoid a btree_gist dependency in this foundation.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- validate_bonus_period_transition(): enforce the doc-16 §3 state machine and the
-- AD10 pool-lock guard. On INSERT a period must start 'open'. On UPDATE a status
-- change must be an allowed transition; open->locked additionally requires an
-- already-locked bonus_pool for the period (AD10). SECURITY DEFINER so the pool
-- existence check bypasses RLS; org-scoped by the period row itself.
-- -----------------------------------------------------------------------------
create or replace function public.validate_bonus_period_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_locked_pool boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'bonus_period must start in status open (got %)', new.status
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- UPDATE: identity fields are immutable once the period leaves 'open' (SI-4:
  -- no silent mutation of dates/type/org after lock). Runs whether or not status changes.
  if old.status <> 'open' then
    if new.period_type     is distinct from old.period_type
    or new.starts_on       is distinct from old.starts_on
    or new.ends_on         is distinct from old.ends_on
    or new.organization_id is distinct from old.organization_id then
      raise exception 'bonus_period identity (type/dates/org) is immutable once locked (SI-4)'
        using errcode = '23001';
    end if;
  end if;

  -- Non-status field updates (e.g. locked_at/locked_by/closed_at) are allowed.
  if new.status = old.status then
    return new;
  end if;

  if not (
       (old.status = 'open'       and new.status = 'locked')
    or (old.status = 'locked'     and new.status in ('calculated', 'open'))
    or (old.status = 'calculated' and new.status = 'approved')
    or (old.status = 'approved'   and new.status = 'exported')
    or (old.status = 'exported'   and new.status = 'closed')
  ) then
    raise exception 'invalid bonus_period transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  -- AD10: a period can be locked only after its pool is locked.
  if old.status = 'open' and new.status = 'locked' then
    select exists (
      select 1 from public.bonus_pools p
      where p.bonus_period_id = new.id and p.status = 'locked'
    ) into v_has_locked_pool;
    if not v_has_locked_pool then
      raise exception 'bonus_period cannot be locked before its bonus_pool is locked (AD10)'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_bonus_period_transition() is
  'Enforces the bonus period state machine (doc 16 §3) + AD10 pool-lock-before-period-lock.';

-- -----------------------------------------------------------------------------
-- prevent_locked_pool_financial_mutation(): once a pool is 'locked', its financial
-- fields (amount/t_org/top_up/currency/period) are frozen — a change requires a new
-- version (AD10). The only allowed transition on a locked pool is -> superseded.
-- -----------------------------------------------------------------------------
create or replace function public.prevent_locked_pool_financial_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'locked' then
    if new.amount_minor    is distinct from old.amount_minor
    or new.t_org           is distinct from old.t_org
    or new.top_up_approved is distinct from old.top_up_approved
    or new.currency        is distinct from old.currency
    or new.bonus_period_id is distinct from old.bonus_period_id then
      raise exception 'locked bonus_pool is immutable: amount/t_org/top_up/currency require a new version (AD10)'
        using errcode = '23001';
    end if;
    if new.status not in ('locked', 'superseded') then
      raise exception 'locked bonus_pool: only transition to superseded is allowed (new version — AD10)'
        using errcode = '23001';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.prevent_locked_pool_financial_mutation() is
  'Freezes financial fields of a locked bonus_pool; change = new version (AD10).';

-- -----------------------------------------------------------------------------
-- bonus_periods (dönem yaşam döngüsü; monthly MVP — D11). Financial-critical.
-- -----------------------------------------------------------------------------
create table public.bonus_periods (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_type     text not null default 'monthly',
  starts_on       date not null,
  ends_on         date not null,
  status          text not null default 'open',
  created_by      uuid not null references public.profiles(id),
  locked_at       timestamptz,
  locked_by       uuid references public.profiles(id),
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint bonus_periods_type_chk   check (period_type in ('monthly')),
  constraint bonus_periods_status_chk check (status in ('open','locked','calculated','approved','exported','closed')),
  constraint bonus_periods_range_chk  check (ends_on > starts_on),
  constraint bonus_periods_unique_range unique (organization_id, starts_on, ends_on),
  -- A period may be 'locked' (or beyond) only with lock metadata set (SI-4/AD10).
  constraint bonus_periods_lock_fields_chk
    check (status = 'open' or (locked_at is not null and locked_by is not null)),
  -- composite unique so bonus_pools can reference (id, organization_id) same-org.
  constraint bonus_periods_id_org_uq unique (id, organization_id)
);

comment on table public.bonus_periods is
  'Bonus period lifecycle (monthly MVP — D11). State machine open->locked->calculated->approved'
  '->exported->closed (+ locked->open). Pool must be locked before period lock (AD10). DELETE '
  'forbidden (retention). Sensitivity: financial-critical.';

create index idx_bonus_periods_org_status on public.bonus_periods (organization_id, status);
create index idx_bonus_periods_ends on public.bonus_periods (ends_on);

create trigger trg_bonus_periods_set_updated_at
  before update on public.bonus_periods
  for each row execute function public.set_updated_at();

create trigger trg_bonus_periods_validate
  before insert or update on public.bonus_periods
  for each row execute function public.validate_bonus_period_transition();

create trigger trg_bonus_periods_prevent_delete
  before delete on public.bonus_periods
  for each row execute function public.prevent_delete();

create trigger trg_audit_bonus_periods
  after insert or update on public.bonus_periods
  for each row execute function public.log_audit();

-- -----------------------------------------------------------------------------
-- bonus_pools (dönem prim havuzu; calculation öncesi kilitli — AD10). Financial.
-- -----------------------------------------------------------------------------
create table public.bonus_pools (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bonus_period_id uuid not null,
  amount_minor    bigint not null,
  currency        text not null default 'TRY',
  status          text not null default 'draft',
  t_org           numeric,                       -- Zero Factor; null until set (locked at period start)
  top_up_approved boolean not null default false, -- AD8 (T_org=1.2 needs Finance top-up)
  version_no      int not null default 1,        -- lock sonrası değişiklik = new version (AD10)
  locked_at       timestamptz,
  locked_by       uuid references public.profiles(id),
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint bonus_pools_amount_pos_chk check (amount_minor >= 0),
  constraint bonus_pools_status_chk     check (status in ('draft','locked','superseded')),
  constraint bonus_pools_currency_chk   check (char_length(currency) = 3),
  constraint bonus_pools_torg_chk       check (t_org is null or t_org in (0, 0.5, 0.75, 1, 1.2)),
  constraint bonus_pools_version_chk    check (version_no >= 1),
  -- A pool may be 'locked' only with a locked T_org and lock metadata (AD10/SI-4):
  -- calculations require a locked pool AND a locked T_org.
  constraint bonus_pools_lock_requires_fields_chk
    check (status <> 'locked'
        or (t_org is not null and locked_at is not null and locked_by is not null)),
  -- same-org linkage to the period (structural cross-tenant safety, SI-7).
  constraint bonus_pools_period_org_fk
    foreign key (bonus_period_id, organization_id)
    references public.bonus_periods (id, organization_id) on delete cascade,
  constraint bonus_pools_created_by_fk foreign key (created_by) references public.profiles(id),
  constraint bonus_pools_locked_by_fk  foreign key (locked_by)  references public.profiles(id)
);

comment on table public.bonus_pools is
  'Bonus pool per period (calculation öncesi kilitli — AD10). One active (non-superseded) pool per '
  'period. Locked pool financial fields are frozen (new version required, AD10). DELETE forbidden. '
  'RLS read: HR/Finance/Auditor (Employee excluded). Sensitivity: financial-critical.';

-- One active (non-superseded) pool per period.
create unique index uq_bonus_pool_active_per_period
  on public.bonus_pools (bonus_period_id)
  where status <> 'superseded';

create index idx_bonus_pools_period on public.bonus_pools (bonus_period_id);

create trigger trg_bonus_pools_set_updated_at
  before update on public.bonus_pools
  for each row execute function public.set_updated_at();

create trigger trg_bonus_pools_prevent_locked_mutation
  before update on public.bonus_pools
  for each row execute function public.prevent_locked_pool_financial_mutation();

create trigger trg_bonus_pools_prevent_delete
  before delete on public.bonus_pools
  for each row execute function public.prevent_delete();

create trigger trg_audit_bonus_pools
  after insert or update on public.bonus_pools
  for each row execute function public.log_audit();

-- =============================================================================
-- RLS (ENABLE + FORCE) + least-privilege grants + policies
-- =============================================================================

-- bonus_periods: org-wide read (period is non-sensitive org metadata: dates/status);
-- write gated on period.manage (owner/hr). No DELETE.
alter table public.bonus_periods enable row level security;
alter table public.bonus_periods force row level security;
revoke all on public.bonus_periods from anon, authenticated;
grant select, insert, update on public.bonus_periods to authenticated;   -- NO delete
grant all on public.bonus_periods to service_role;

create policy bonus_periods_select on public.bonus_periods
  for select to authenticated
  using (organization_id = public.current_org()
         or public.has_support_grant(organization_id));

create policy bonus_periods_insert on public.bonus_periods
  for insert to authenticated
  with check (organization_id = public.current_org() and public.has_permission('period.manage'));

create policy bonus_periods_update on public.bonus_periods
  for update to authenticated
  using (organization_id = public.current_org() and public.has_permission('period.manage'))
  with check (organization_id = public.current_org() and public.has_permission('period.manage'));
-- No DELETE policy (and no privilege); prevent_delete trigger is defense-in-depth.

-- bonus_pools: read HR/Finance/Auditor only (financial; Employee/Manager excluded);
-- write gated on pool.create (finance). No DELETE. Locked immutability by trigger.
alter table public.bonus_pools enable row level security;
alter table public.bonus_pools force row level security;
revoke all on public.bonus_pools from anon, authenticated;
grant select, insert, update on public.bonus_pools to authenticated;     -- NO delete
grant all on public.bonus_pools to service_role;

create policy bonus_pools_select on public.bonus_pools
  for select to authenticated
  using (
    public.has_support_grant(organization_id)
    or (
      organization_id = public.current_org()
      and (public.has_role('hr') or public.has_role('finance') or public.has_role('auditor'))
    )
  );

create policy bonus_pools_insert on public.bonus_pools
  for insert to authenticated
  with check (organization_id = public.current_org() and public.has_permission('pool.create'));

create policy bonus_pools_update on public.bonus_pools
  for update to authenticated
  using (organization_id = public.current_org() and public.has_permission('pool.create'))
  with check (organization_id = public.current_org() and public.has_permission('pool.create'));
-- No DELETE policy (and no privilege); prevent_delete trigger is defense-in-depth.
