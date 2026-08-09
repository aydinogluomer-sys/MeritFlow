-- =============================================================================
-- Migration 0027 — payout / export engine  (Phase 6-c)
-- Refs: 06_LEDGER_AUDIT_SPEC §2 (BL-1..BL-4; "Payout marked paid: debit accrual /
--       credit payout"), 16 §3/§5/§8 (period/allocation/export machines), 03 §1/§4
--       (payout.export / payout.mark_paid; Finance view-only, SI-12), Decision Lock
--       D2/D6/AD6/AD8, ADR-006/ADR-017/ADR-018. Builds on 0011 (period machine —
--       approved→exported→closed already allowed), 0013 (allocations FROZEN once run
--       completed), 0014 (bonus_ledger container), 0018 (exports container + AD6 gate),
--       0022 (accrual double-entry reference), 0026 (reversal — reversal-aware net).
--
-- Scope (Phase 6-c): the approved→exported→closed payout flow.
--   * produce_payout_export(): approved period → exports record (0018 trigger enforces
--     AD6 + snapshot/period) + period approved→exported. Finance (payout.export).
--   * mark_payout_paid(): exported period → per-employee balanced payout (debit accrual /
--     credit payout; doc-06 §2) + period exported→closed. Finance (payout.mark_paid).
--   * bonus_ledger unlocks ONLY payout_marked_paid; payout_exported + clawback_* stay
--     blocked (payout_exported is not a money movement — it is the exports record).
--   * BL-3 (payout ≤ net accrual per employee, reversal-aware) — DEFERRABLE trigger.
--   * v_finance_payout / v_finance_period_totals — security_invoker views over the
--     Finance-readable bonus_ledger (+ periods/pools/snapshots/profiles); NO raw
--     points/quality/cap/comp (SI-12).
--
-- KEY STRUCTURAL NOTE: bonus_allocations are FROZEN once the run completes (0013
-- prevent_mutation_on_completed_run), so the allocation.status approved→exported→paid
-- transitions (doc-16 §5) are NOT applied to allocation rows here — payment state lives
-- in bonus_ledger (payout_marked_paid) + bonus_periods.status + the exports record.
--
-- DELIBERATELY ABSENT (gated): clawback_pending/clawback_approved (D2 approval workflow),
-- bonus_allocations mutation (frozen), CSV/XLSX byte generation + file_path/checksum/
-- row_count (app/storage), exports status progression (requested→generated→downloaded),
-- notifications, app/API/UI, dispute_adjustment→bonus basis (7-D). No new permission
-- (payout.export / payout.mark_paid already seeded — catalog 20). No edits to 0001..0026
-- functions/policies (only ADDITIVE ALTERs + CREATE OR REPLACE of the ledger event guard).
-- Local dev/staging only — never production (ADR-014).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- exports: additive unique(id, organization_id) so bonus_ledger can carry a same-org
-- composite FK to an export (mirrors the 0009/0014/0015 pattern). Grants/trigger/RLS
-- of 0018 are NOT touched.
-- -----------------------------------------------------------------------------
alter table public.exports
  add constraint exports_id_org_uq unique (id, organization_id);

-- -----------------------------------------------------------------------------
-- bonus_ledger: additive export_id + same-org composite FK to exports; a
-- payout_marked_paid row MUST carry an export_id (traceability to the export batch).
-- -----------------------------------------------------------------------------
alter table public.bonus_ledger add column export_id uuid;

alter table public.bonus_ledger
  add constraint bonus_ledger_export_org_fk
  foreign key (export_id, organization_id)
  references public.exports (id, organization_id);

alter table public.bonus_ledger
  add constraint bonus_ledger_payout_export_chk
  check (event_type <> 'payout_marked_paid' or export_id is not null);

-- -----------------------------------------------------------------------------
-- validate_bonus_ledger_event(): unlock payout_marked_paid. payout_exported (not a
-- money movement — it is the exports record) and clawback_* (D2 approval workflow) stay
-- blocked. Verbatim 0014 body + the widened allow-list.
-- -----------------------------------------------------------------------------
create or replace function public.validate_bonus_ledger_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- payout_marked_paid is now writable (6-c). The rejection MESSAGE is preserved verbatim
  -- from 0014 so the 0008 assertions (payout_exported / bonus_approved rejected) still match.
  if new.event_type not in ('bonus_accrual', 'reversal', 'payout_marked_paid') then
    raise exception 'bonus_ledger event_type % is deferred to a later phase (approval/payout/clawback) — only bonus_accrual and reversal are writable in this slice',
      new.event_type using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.validate_bonus_ledger_event() is
  'Writable bonus_ledger events: bonus_accrual + reversal + payout_marked_paid (6-c). '
  'payout_exported / bonus_approved / clawback_* stay blocked (forward-compat enum).';

-- -----------------------------------------------------------------------------
-- enforce_bonus_ledger_payout_cap(): BL-3 — Σ(payout debit-to-accrual) for an
-- (org, employee, snapshot) must not exceed that employee's NET accrual on the snapshot:
--   net accrual = Σ(bonus_accrual accrual-credit) − Σ(reversal accrual-debit).
-- Reversal-aware (7-C reversals reduce the net). DEFERRABLE INITIALLY DEFERRED so it
-- evaluates once the balanced payout batch is complete (mirrors the 0022 BL-2 trigger).
-- SECURITY DEFINER so it can read the ledger regardless of RLS.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_bonus_ledger_payout_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid        bigint;
  v_net_accrual bigint;
begin
  if new.event_type <> 'payout_marked_paid'
     or new.account <> 'accrual'
     or new.entry_type <> 'debit'
     or new.snapshot_id is null
     or new.employee_id is null then
    return null;
  end if;

  select coalesce(sum(amount_minor)
                  filter (where event_type = 'payout_marked_paid' and account = 'accrual' and entry_type = 'debit'), 0)
    into v_paid
  from public.bonus_ledger
  where organization_id = new.organization_id
    and snapshot_id = new.snapshot_id
    and employee_id = new.employee_id;

  select coalesce(sum(amount_minor)
                  filter (where event_type = 'bonus_accrual' and account = 'accrual' and entry_type = 'credit'), 0)
       - coalesce(sum(amount_minor)
                  filter (where event_type = 'reversal' and account = 'accrual' and entry_type = 'debit'), 0)
    into v_net_accrual
  from public.bonus_ledger
  where organization_id = new.organization_id
    and snapshot_id = new.snapshot_id
    and employee_id = new.employee_id;

  if v_paid > v_net_accrual then
    raise exception 'payout for employee % in snapshot % exceeds net accrual: paid % > net % (BL-3 — payout ≤ accrual)',
      new.employee_id, new.snapshot_id, v_paid, v_net_accrual using errcode = '23514';
  end if;
  return null;
end;
$$;

comment on function public.enforce_bonus_ledger_payout_cap() is
  'BL-3 guard: Σ(payout accrual-debit) per (org, employee, snapshot) ≤ net accrual '
  '(accrual credits − reversal debits); reversal-aware; deferred to commit.';

create constraint trigger trg_bonus_ledger_payout_cap
  after insert on public.bonus_ledger
  deferrable initially deferred
  for each row execute function public.enforce_bonus_ledger_payout_cap();

-- -----------------------------------------------------------------------------
-- produce_payout_export(org, period, snapshot, format, actor): approved period → an
-- exports record + period approved→exported. Finance (payout.export) or trusted server.
-- The 0018 validate_export trigger enforces snapshot/period-match + AD6/SI-15 (no
-- re-check here). SECURITY DEFINER: the period transition needs period.manage which
-- Finance lacks, and the exports read/insert runs as owner.
-- -----------------------------------------------------------------------------
create function public.produce_payout_export(
  p_organization_id uuid,
  p_bonus_period_id uuid,
  p_snapshot_id     uuid,
  p_format          text,
  p_actor           uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_status text;
  v_export        uuid;
begin
  -- (authz) Finance (payout.export) or a trusted server/job context.
  if not (public.has_permission('payout.export') or auth.uid() is null) then
    raise exception 'not authorized to produce a payout export (payout.export required)' using errcode = '42501';
  end if;

  -- Period must be APPROVED (0018 defers this gate to the engine — decision B).
  select status into v_period_status
  from public.bonus_periods where id = p_bonus_period_id and organization_id = p_organization_id;
  if not found then
    raise exception 'bonus_period % not found in org %', p_bonus_period_id, p_organization_id using errcode = '23503';
  end if;
  if v_period_status <> 'approved' then
    raise exception 'payout export requires an approved bonus_period (status %; re-export is an app-layer decision)',
      v_period_status using errcode = '23514';
  end if;

  -- Create the export record (validate_export enforces snapshot same-org + period match
  -- + AD6/SI-15). exported_by = the acting user (recorded explicitly — no spoofing).
  insert into public.exports (organization_id, bonus_period_id, snapshot_id, exported_by, format)
  values (p_organization_id, p_bonus_period_id, p_snapshot_id, p_actor, p_format)
  returning id into v_export;

  -- period approved → exported (doc-16 §3; SECURITY DEFINER — Finance has no period.manage).
  update public.bonus_periods set status = 'exported'
  where id = p_bonus_period_id and organization_id = p_organization_id and status = 'approved';

  return v_export;
end;
$$;

comment on function public.produce_payout_export(uuid, uuid, uuid, text, uuid) is
  'Phase 6-c: approved period → exports record (0018 AD6 gate) + period approved→exported. '
  'authz payout.export OR auth.uid() IS NULL. SECURITY DEFINER, server-only.';

-- -----------------------------------------------------------------------------
-- mark_payout_paid(org, period, export, actor): exported period → one balanced payout
-- transaction (per employee: debit accrual / credit payout; doc-06 §2) mirroring the
-- snapshot's accrual credits + period exported→closed. Finance (payout.mark_paid) or
-- trusted server. Idempotent per export. BL-3 (deferred) enforces payout ≤ net accrual.
-- -----------------------------------------------------------------------------
create function public.mark_payout_paid(
  p_organization_id uuid,
  p_bonus_period_id uuid,
  p_export_id       uuid,
  p_actor           uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_status text;
  v_snapshot      uuid;
  v_existing_txn  uuid;
  v_txn           uuid;
begin
  -- (authz) Finance (payout.mark_paid) or a trusted server/job context.
  if not (public.has_permission('payout.mark_paid') or auth.uid() is null) then
    raise exception 'not authorized to mark payout paid (payout.mark_paid required)' using errcode = '42501';
  end if;

  -- Export must exist in the same org + belong to this period; take its snapshot.
  select snapshot_id into v_snapshot
  from public.exports
  where id = p_export_id and organization_id = p_organization_id and bonus_period_id = p_bonus_period_id;
  if not found then
    raise exception 'export % not found for period % in org %', p_export_id, p_bonus_period_id, p_organization_id
      using errcode = '23503';
  end if;

  -- Idempotency (BEFORE the period gate — a second call sees the period already 'closed'):
  -- this export already paid => no-op (return the existing txn).
  select transaction_id into v_existing_txn
  from public.bonus_ledger
  where organization_id = p_organization_id and export_id = p_export_id and event_type = 'payout_marked_paid'
  limit 1;
  if v_existing_txn is not null then
    return v_existing_txn;
  end if;

  -- Period must be EXPORTED (first-time path only).
  select status into v_period_status
  from public.bonus_periods where id = p_bonus_period_id and organization_id = p_organization_id;
  if not found then
    raise exception 'bonus_period % not found in org %', p_bonus_period_id, p_organization_id using errcode = '23503';
  end if;
  if v_period_status <> 'exported' then
    raise exception 'mark payout paid requires an exported bonus_period (status %)', v_period_status using errcode = '23514';
  end if;

  v_txn := gen_random_uuid();

  -- Per employee: DEBIT accrual (mirror the accrual credit amount).
  insert into public.bonus_ledger
    (organization_id, bonus_pool_id, employee_id, calculation_run_id, snapshot_id, export_id, transaction_id,
     entry_type, account, event_type, amount_minor, currency, reason, created_by)
  select
    a.organization_id, a.bonus_pool_id, a.employee_id, a.calculation_run_id, a.snapshot_id, p_export_id, v_txn,
    'debit', 'accrual', 'payout_marked_paid', a.amount_minor, a.currency, 'payout: accrual debit', p_actor
  from public.bonus_ledger a
  where a.organization_id = p_organization_id and a.snapshot_id = v_snapshot
    and a.event_type = 'bonus_accrual' and a.account = 'accrual' and a.entry_type = 'credit';

  -- Per employee: CREDIT payout (same amount).
  insert into public.bonus_ledger
    (organization_id, bonus_pool_id, employee_id, calculation_run_id, snapshot_id, export_id, transaction_id,
     entry_type, account, event_type, amount_minor, currency, reason, created_by)
  select
    a.organization_id, a.bonus_pool_id, a.employee_id, a.calculation_run_id, a.snapshot_id, p_export_id, v_txn,
    'credit', 'payout', 'payout_marked_paid', a.amount_minor, a.currency, 'payout: employee credit', p_actor
  from public.bonus_ledger a
  where a.organization_id = p_organization_id and a.snapshot_id = v_snapshot
    and a.event_type = 'bonus_accrual' and a.account = 'accrual' and a.entry_type = 'credit';

  -- period exported → closed (doc-16 §3; locked scope decision).
  update public.bonus_periods set status = 'closed'
  where id = p_bonus_period_id and organization_id = p_organization_id and status = 'exported';

  return v_txn;
end;
$$;

comment on function public.mark_payout_paid(uuid, uuid, uuid, uuid) is
  'Phase 6-c: exported period → balanced payout_marked_paid (debit accrual / credit payout per '
  'employee) + period exported→closed. Idempotent per export; BL-3 (payout ≤ net accrual). '
  'authz payout.mark_paid OR auth.uid() IS NULL. SECURITY DEFINER, server-only.';

-- -----------------------------------------------------------------------------
-- Finance views (security_invoker → run with the caller's RLS; Finance already reads
-- bonus_ledger / snapshots / periods / pools / same-org profiles). They expose ONLY the
-- payout summary — NO raw points / quality / cap_basis / adjusted_score / comp (SI-12).
-- -----------------------------------------------------------------------------
create view public.v_finance_payout
with (security_invoker = true) as
select
  t.bonus_period_id,
  t.employee_id,
  t.display_name,
  t.final_amount_minor,
  t.paid_amount_minor,
  case when t.paid_amount_minor > 0 then 'paid' else 'accrued' end as status,
  t.paid_at
from (
  select
    s.bonus_period_id,
    bl.employee_id,
    p.display_name,
    coalesce(sum(bl.amount_minor) filter (where bl.event_type = 'bonus_accrual' and bl.account = 'accrual' and bl.entry_type = 'credit'), 0)
      - coalesce(sum(bl.amount_minor) filter (where bl.event_type = 'reversal' and bl.account = 'accrual' and bl.entry_type = 'debit'), 0)
        as final_amount_minor,
    coalesce(sum(bl.amount_minor) filter (where bl.event_type = 'payout_marked_paid' and bl.account = 'accrual' and bl.entry_type = 'debit'), 0)
        as paid_amount_minor,
    max(bl.created_at) filter (where bl.event_type = 'payout_marked_paid') as paid_at
  from public.bonus_ledger bl
  join public.bonus_allocation_snapshots s
    on s.id = bl.snapshot_id and s.organization_id = bl.organization_id
  left join public.profiles p on p.id = bl.employee_id
  where bl.employee_id is not null
  group by s.bonus_period_id, bl.employee_id, p.display_name
) t;

comment on view public.v_finance_payout is
  'Finance payout summary (security_invoker; SI-12). Per (period, employee): net accrual '
  '(final_amount_minor), paid_amount_minor, status accrued/paid, paid_at. NO raw points / '
  'quality / cap_basis / adjusted_score / comp.';

create view public.v_finance_period_totals
with (security_invoker = true) as
select
  bp.id     as bonus_period_id,
  bp.status as period_status,
  pool.amount_minor as pool_amount,
  snap.distributable_minor as distributable,
  snap.undistributed_remainder_minor as undistributed_remainder,
  coalesce(led.total_accrued, 0) as total_accrued,
  coalesce(led.total_paid, 0)    as total_paid
from public.bonus_periods bp
left join lateral (
  select p.amount_minor
  from public.bonus_pools p
  where p.bonus_period_id = bp.id and p.status <> 'superseded'
  limit 1
) pool on true
left join lateral (
  select s.undistributed_remainder_minor,
         (s.calculation_metadata->>'distributable_minor')::bigint as distributable_minor
  from public.bonus_allocation_snapshots s
  join public.bonus_calculation_runs r
    on r.id = s.calculation_run_id and r.organization_id = s.organization_id
  where r.bonus_period_id = bp.id and r.status = 'completed'
  order by s.created_at desc
  limit 1
) snap on true
left join lateral (
  select
    coalesce(sum(bl.amount_minor) filter (where bl.event_type = 'bonus_accrual' and bl.account = 'accrual' and bl.entry_type = 'credit'), 0)
      - coalesce(sum(bl.amount_minor) filter (where bl.event_type = 'reversal' and bl.account = 'accrual' and bl.entry_type = 'debit'), 0)
        as total_accrued,
    coalesce(sum(bl.amount_minor) filter (where bl.event_type = 'payout_marked_paid' and bl.account = 'accrual' and bl.entry_type = 'debit'), 0)
        as total_paid
  from public.bonus_ledger bl
  join public.bonus_allocation_snapshots s2
    on s2.id = bl.snapshot_id and s2.organization_id = bl.organization_id
  where s2.bonus_period_id = bp.id
) led on true;

comment on view public.v_finance_period_totals is
  'Finance period roll-up (security_invoker; SI-12): pool_amount, distributable, '
  'total_accrued (net), total_paid, undistributed_remainder, period_status. Ledger + '
  'periods + pools + snapshot roll-up; NO raw allocation/point/comp detail.';

-- -----------------------------------------------------------------------------
-- Grants. Functions: server + authenticated (authz enforced inside). Views: SELECT to
-- authenticated (row visibility gated by the underlying RLS — effectively Finance/Auditor).
-- -----------------------------------------------------------------------------
revoke execute on function public.produce_payout_export(uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.produce_payout_export(uuid, uuid, uuid, text, uuid) to authenticated, service_role;

revoke execute on function public.mark_payout_paid(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.mark_payout_paid(uuid, uuid, uuid, uuid) to authenticated, service_role;

grant select on public.v_finance_payout to authenticated, service_role;
grant select on public.v_finance_period_totals to authenticated, service_role;
