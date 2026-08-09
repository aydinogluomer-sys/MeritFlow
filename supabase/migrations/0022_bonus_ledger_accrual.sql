-- =============================================================================
-- Migration 0022 — bonus_ledger accrual (approve → double-entry accrual)  (Phase 6-b)
-- Refs: 06_LEDGER_AUDIT_SPEC §2/§4, ADR-006 (accrual only from an APPROVED snapshot),
--       ADR-017 (double-entry; Σdebit=Σcredit; kuruş; reversal), Decision Lock
--       D2/AD6/AD8/AD10, 16 (BL-1..BL-4, SI-3/SI-7/SI-12/SI-13). Builds on 0013
--       (runs/allocations/snapshots) + 0014 (bonus_ledger container) + 0021 (engine).
--
-- Scope (Phase 6-b ONLY): the approve→accrual POSTING engine + the BL-2 (Σaccrual ≤
-- pool_ref) hard-enforce trigger. post_bonus_accrual() reads an APPROVED period's single
-- completed run (snapshot + allocations) and posts ONE balanced double-entry accrual
-- transaction (debit pool = Σfinal, credit accrual per employee). SECURITY DEFINER,
-- server-only. Idempotent per snapshot. NO bonus_ledger schema change, NO snapshot
-- mutation (approval lives on the mutable bonus_period, not the immutable snapshot).
--
-- Locked slice decisions (OQ resolution from the Phase 6-b scope-lock):
--   OQ-1  approval (period calculated→approved, period.manage) and posting are TWO steps;
--         post_bonus_accrual() requires status='approved'.
--   OQ-2  BL-3 (payout ≤ accrual) is NOT enforced here — no payout producer in 6-b
--         (payout_* still blocked by 0014's validate_bonus_ledger_event). Deferred to the
--         payout/export phase.
--   OQ-3  the approver is recorded via the existing audit trigger on bonus_periods
--         (period UPDATE → audit_logs); NO bonus_periods column is added.
--   OQ-4  BL-2 pool_ref = snapshot.calculation_metadata->>'pool_ref_minor' (single source
--         with the 0021 engine); fallback = pool.amount_minor × (1.2 if approved top-up).
--   OQ-5  exactly ONE non-superseded completed run per approved period; 0/>1 → fail-closed.
--
-- DELIBERATELY ABSENT (still gated): payout/export (payout_exported/marked_paid, exports
-- wiring, v_finance_* views), clawback workflow, dispute→reversal orchestration, snapshot
-- immutability relaxation, new permissions (catalog stays 20), app/UI/API. No edits to
-- 0001..0021 or existing tests. Local dev/staging only — never production (ADR-014).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- enforce_bonus_ledger_pool_cap(): BL-2 hard-enforce — Σ(accrual credit) for a
-- snapshot must not exceed that snapshot's pool_ref (the AD8-aware approved budget:
-- pool amount, or amount×1.2 when an approved top-up applies). DEFERRABLE INITIALLY
-- DEFERRED so it evaluates once the balanced batch is complete (mirrors the 0014
-- balance trigger). Only accrual-credit rows contribute; other rows are ignored.
-- SECURITY DEFINER so it can read the ledger/snapshot/pool regardless of RLS.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_bonus_ledger_pool_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_accrued  bigint;
  v_pool_ref bigint;
begin
  if new.event_type <> 'bonus_accrual'
     or new.account <> 'accrual'
     or new.entry_type <> 'credit'
     or new.snapshot_id is null then
    return null;
  end if;

  select coalesce(sum(amount_minor), 0) into v_accrued
  from public.bonus_ledger
  where organization_id = new.organization_id
    and snapshot_id = new.snapshot_id
    and event_type = 'bonus_accrual'
    and account = 'accrual'
    and entry_type = 'credit';

  -- pool_ref: prefer the engine-recorded value (OQ-4); fall back to the pool's
  -- effective budget (amount × 1.2 only when an approved top-up + T_org=1.2 — AD8).
  select coalesce(
           nullif(s.calculation_metadata->>'pool_ref_minor', '')::bigint,
           case when p.top_up_approved and p.t_org = 1.2
                then floor(p.amount_minor * 1.2)::bigint
                else p.amount_minor end)
  into v_pool_ref
  from public.bonus_allocation_snapshots s
  join public.bonus_pools p
    on p.id = s.bonus_pool_id and p.organization_id = s.organization_id
  where s.id = new.snapshot_id;

  -- If pool_ref is indeterminable, do not block (soft-fail); engine snapshots always
  -- carry pool_ref_minor, so this only guards hand-crafted rows without a resolvable pool.
  if v_pool_ref is not null and v_accrued > v_pool_ref then
    raise exception 'bonus_ledger accrual for snapshot % exceeds pool_ref: Σaccrual % > % (BL-2 — ADR-017/AD8)',
      new.snapshot_id, v_accrued, v_pool_ref using errcode = '23514';
  end if;
  return null;
end;
$$;

comment on function public.enforce_bonus_ledger_pool_cap() is
  'BL-2 guard: Σ(accrual credit) per snapshot ≤ pool_ref (snapshot pool_ref_minor / AD8 budget); deferred to commit.';

create constraint trigger trg_bonus_ledger_pool_cap
  after insert on public.bonus_ledger
  deferrable initially deferred
  for each row execute function public.enforce_bonus_ledger_pool_cap();

-- -----------------------------------------------------------------------------
-- post_bonus_accrual(org, period, triggered_by): the approve→accrual posting engine.
-- Preconditions: the period is APPROVED (ADR-006 snapshot-approval boundary — HR moved
-- it calculated→approved via period.manage), it has exactly one completed run (OQ-5),
-- and no allocation is pending_missing_cap_basis (AD6 fail-closed). Posts ONE balanced
-- transaction: debit pool (org-level) = Σfinal, credit accrual per employee. Idempotent
-- per snapshot (a second call is a no-op). SECURITY DEFINER, server-only; the balanced
-- pair passes 0014's deferred balance trigger and the new BL-2 trigger at commit.
-- -----------------------------------------------------------------------------
create or replace function public.post_bonus_accrual(
  p_organization_id uuid,
  p_bonus_period_id uuid,
  p_triggered_by    uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_status text;
  v_run_count     int;
  v_run           uuid;
  v_snap          uuid;
  v_pool          uuid;
  v_pending       int;
  v_existing      int;
  v_total         bigint;
  v_txn           uuid;
begin
  -- (authz) HR (period.manage) or a trusted server/definer context.
  if not (public.has_permission('period.manage') or current_user not in ('authenticated', 'anon')) then
    raise exception 'not authorized to post bonus accrual (period.manage required)' using errcode = '42501';
  end if;

  -- Snapshot-approval boundary: the period must be APPROVED (ADR-006).
  select status into v_period_status
  from public.bonus_periods where id = p_bonus_period_id and organization_id = p_organization_id;
  if not found then
    raise exception 'bonus_period % not found in org %', p_bonus_period_id, p_organization_id using errcode = '23503';
  end if;
  if v_period_status <> 'approved' then
    raise exception 'bonus accrual requires an approved bonus_period (status %; move calculated->approved first — ADR-006)',
      v_period_status using errcode = '23514';
  end if;

  -- Exactly one non-superseded completed run (OQ-5 — ambiguity fails closed).
  select count(*) into v_run_count
  from public.bonus_calculation_runs
  where bonus_period_id = p_bonus_period_id and organization_id = p_organization_id and status = 'completed';
  if v_run_count = 0 then
    raise exception 'no completed calculation run for approved period %', p_bonus_period_id using errcode = '23514';
  elsif v_run_count > 1 then
    raise exception 'ambiguous: % completed runs for period % (expected exactly one)', v_run_count, p_bonus_period_id
      using errcode = '23514';
  end if;
  select id into v_run
  from public.bonus_calculation_runs
  where bonus_period_id = p_bonus_period_id and organization_id = p_organization_id and status = 'completed';

  select id, bonus_pool_id into v_snap, v_pool
  from public.bonus_allocation_snapshots where calculation_run_id = v_run;
  if v_snap is null then
    raise exception 'no snapshot for completed run %', v_run using errcode = '23514';
  end if;

  -- AD6 gate: never accrue a provisional (missing cap basis) allocation.
  select count(*) into v_pending
  from public.bonus_allocations
  where calculation_run_id = v_run
    and (status = 'pending_missing_cap_basis' or cap_applied = 'pending_missing_cap_basis');
  if v_pending > 0 then
    raise exception 'cannot accrue: % allocation(s) pending_missing_cap_basis — resolve cap basis first (AD6)', v_pending
      using errcode = '23514';
  end if;

  -- Idempotency: an accrual already exists for this snapshot => no-op.
  select count(*) into v_existing
  from public.bonus_ledger where snapshot_id = v_snap and event_type = 'bonus_accrual';
  if v_existing > 0 then
    return v_snap;
  end if;

  -- Σfinal over positive allocations (0-amount rows are not posted — amount_minor > 0 CHECK).
  select coalesce(sum(final_amount_minor), 0) into v_total
  from public.bonus_allocations where calculation_run_id = v_run and final_amount_minor > 0;
  if v_total = 0 then
    return v_snap;   -- nothing to accrue (T_org=0 / Σadj=0 / all-zero)
  end if;

  v_txn := gen_random_uuid();

  -- Debit the pool (org-level; employee_id null) = Σfinal.
  insert into public.bonus_ledger
    (organization_id, bonus_pool_id, employee_id, calculation_run_id, snapshot_id, transaction_id,
     entry_type, account, event_type, amount_minor, reason, created_by)
  values
    (p_organization_id, v_pool, null, v_run, v_snap, v_txn,
     'debit', 'pool', 'bonus_accrual', v_total, 'accrual: pool debit', p_triggered_by);

  -- Credit each employee's accrual = final_amount_minor (positive only).
  insert into public.bonus_ledger
    (organization_id, bonus_pool_id, employee_id, calculation_run_id, snapshot_id, transaction_id,
     entry_type, account, event_type, amount_minor, reason, created_by)
  select
    p_organization_id, v_pool, a.employee_id, v_run, v_snap, v_txn,
    'credit', 'accrual', 'bonus_accrual', a.final_amount_minor, 'accrual: employee credit', p_triggered_by
  from public.bonus_allocations a
  where a.calculation_run_id = v_run and a.final_amount_minor > 0;

  return v_snap;
end;
$$;

comment on function public.post_bonus_accrual(uuid, uuid, uuid) is
  'Approve→accrual posting engine (Phase 6-b): APPROVED period → one balanced double-entry accrual '
  '(debit pool = Σfinal, credit accrual per employee) from the completed run''s snapshot. Idempotent per '
  'snapshot; AD6 pending gate; Σdebit=Σcredit (0014) + Σaccrual≤pool_ref (BL-2). SECURITY DEFINER, server-only.';

revoke execute on function public.post_bonus_accrual(uuid, uuid, uuid) from public, anon;
grant execute on function public.post_bonus_accrual(uuid, uuid, uuid) to authenticated, service_role;
