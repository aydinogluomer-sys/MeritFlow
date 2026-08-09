-- =============================================================================
-- Migration 0026 — dispute bonus recalculation + reversal  (Phase 7-C, reduced scope C-c1)
-- Refs: 07 §63 (accepted-bonus → new run + reversal), 19 §5.3/§4, Decision Lock
--       D2/D6/AD6/AD8/AD10, ADR-006 (immutable snapshot) / ADR-017 (double-entry
--       reversal). Builds on 0011 (period machine) + 0013 (run supersede) + 0014
--       (bonus_ledger reversal writable) + 0022 (post_bonus_accrual / re-accrual gate).
--
-- Scope (Phase 7-C, C-c1 = MECHANICAL correction ONLY): when a dispute affects an
-- already-approved+accrued period, this slice (1) reverses the old accrual (balanced
-- double-entry), (2) supersedes the old completed run, and (3) moves the period
-- approved→calculated so re-approval is required before any re-accrual. It does NOT
-- recompute allocations and does NOT change the bonus basis — a corrected calculation
-- is a separate, explicit operator re-run (run_bonus_calculation) on a fresh key, and
-- re-accrual (post_bonus_accrual) only after HR re-approves. The old snapshot/allocations
-- are never mutated (ADR-006).
--
-- Locked OQ decisions (Phase 7-C scope-lock):
--   OQ-7C-1  reduced scope C-c1 (no new recompute; run_bonus_calculation UNCHANGED).
--   OQ-7C-4  precondition: the period must be 'approved' (an accrual exists to reverse).
--   OQ-4/D2  paid-accrual guard: if any payout row exists for the accrued snapshot, raise
--            (a paid accrual is a clawback — gated). Today no payout producer exists
--            (0014 rejects payout_* writes), so the guard is forward-safe (never fires yet).
--   OQ-6     explicit HR/server call (has_permission('period.manage') OR auth.uid() IS NULL).
--
-- DELIBERATELY ABSENT (gated / deferred): reflecting the 7-B dispute_adjustment in the
-- bonus basis (7-D — needs a period-attribution rule), any run_bonus_calculation change,
-- automatic re-run / re-accrual, new permission (catalog stays 20), seed, app/UI/API.
-- No edits to 0001..0025 or existing tests. Local dev/staging only — never production.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- validate_bonus_period_transition(): verbatim 0011 body + ONE added transition
-- (approved→calculated) so a dispute recalculation can send an approved period back
-- for re-approval. Identity-immutability and the AD10 pool-lock guard are unchanged.
-- The trigger references this function by name (0011) — CREATE OR REPLACE suffices.
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

  -- UPDATE: identity fields are immutable once the period leaves 'open' (SI-4).
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
    or (old.status = 'approved'   and new.status = 'calculated')   -- NEW (7-C): dispute recalc → re-approval
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
  'Enforces the bonus period state machine (doc 16 §3) + AD10 pool-lock-before-period-lock. '
  '7-C adds approved→calculated (dispute recalculation → re-approval required).';

-- -----------------------------------------------------------------------------
-- recalculate_bonus_after_dispute(org, period, triggered_by): the MECHANICAL
-- dispute-driven correction (C-c1). Reverses the accrual, supersedes the run, and
-- sends the period back to 'calculated' for re-approval. Idempotent (a re-call after
-- the reversal is a no-op). SECURITY DEFINER, server-only. Ordered: authz → load
-- period → find the accrued run+snapshot → idempotency (already reversed → no-op) →
-- precondition (approved) → paid-guard → reversal → supersede → approved→calculated.
-- -----------------------------------------------------------------------------
create function public.recalculate_bonus_after_dispute(
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
  v_run           uuid;
  v_snap          uuid;
  v_rev_txn       uuid;
begin
  -- (authz — OQ-6) HR (period.manage) or a trusted server/job context. auth.uid() IS
  -- NULL = no authenticated JWT identity (current_user is unreliable inside a SECURITY
  -- DEFINER — it is the owner, not the caller).
  if not (public.has_permission('period.manage') or auth.uid() is null) then
    raise exception 'not authorized to recalculate bonus after a dispute (period.manage required)' using errcode = '42501';
  end if;

  -- Load the period (org-scoped).
  select status into v_period_status
  from public.bonus_periods where id = p_bonus_period_id and organization_id = p_organization_id;
  if not found then
    raise exception 'bonus_period % not found in org %', p_bonus_period_id, p_organization_id using errcode = '23503';
  end if;

  -- Find the accrued run + snapshot for this period (completed OR already superseded —
  -- the accrual rows persist append-only on the superseded run after a prior recalc).
  select r.id, s.id into v_run, v_snap
  from public.bonus_calculation_runs r
  join public.bonus_allocation_snapshots s
    on s.calculation_run_id = r.id and s.organization_id = r.organization_id
  where r.bonus_period_id = p_bonus_period_id
    and r.organization_id = p_organization_id
    and exists (
      select 1 from public.bonus_ledger bl
      where bl.snapshot_id = s.id and bl.organization_id = p_organization_id
        and bl.event_type = 'bonus_accrual')
  limit 1;

  -- (idempotency) already reversed => no-op (period is already 'calculated').
  if v_snap is not null and exists (
       select 1 from public.bonus_ledger
       where snapshot_id = v_snap and organization_id = p_organization_id and event_type = 'reversal') then
    return v_snap;
  end if;

  -- (precondition — OQ-7C-4) the period must be approved (an accrual exists to reverse).
  if v_period_status <> 'approved' then
    raise exception 'bonus recalculation requires an approved bonus_period (status %; no accrual to reverse)',
      v_period_status using errcode = '23514';
  end if;
  if v_snap is null then
    raise exception 'approved bonus_period % has no accrual to recalculate', p_bonus_period_id using errcode = '23514';
  end if;

  -- (paid-guard — OQ-4/D2) never reverse a PAID accrual (clawback is gated). Today no
  -- payout producer exists (0014 rejects payout_* writes), so this is forward-safe.
  if exists (
       select 1 from public.bonus_ledger
       where organization_id = p_organization_id and snapshot_id = v_snap
         and event_type in ('payout_exported', 'payout_marked_paid')) then
    raise exception 'cannot recalculate: accrual for snapshot % is already paid — clawback is gated (D2)', v_snap
      using errcode = '23514';
  end if;

  -- (reversal) mirror each accrual row with the entry_type swapped, a new transaction_id,
  -- and event_type='reversal' (already writable — 0014). Σdebit=Σcredit is preserved
  -- (the accrual was balanced; swapping every row keeps the sums equal); the 0014
  -- balance trigger accepts it. BL-2 (0022) ignores reversal rows.
  v_rev_txn := gen_random_uuid();
  insert into public.bonus_ledger
    (organization_id, bonus_pool_id, employee_id, calculation_run_id, snapshot_id, transaction_id,
     entry_type, account, event_type, amount_minor, currency, reason, created_by, metadata)
  select
    bl.organization_id, bl.bonus_pool_id, bl.employee_id, bl.calculation_run_id, bl.snapshot_id, v_rev_txn,
    case bl.entry_type when 'debit' then 'credit' else 'debit' end,
    bl.account, 'reversal', bl.amount_minor, bl.currency,
    'dispute recalculation: reversal of accrual', p_triggered_by,
    jsonb_build_object('reverses_snapshot', bl.snapshot_id, 'dispute_recalc', true)
  from public.bonus_ledger bl
  where bl.organization_id = p_organization_id
    and bl.snapshot_id = v_snap
    and bl.event_type = 'bonus_accrual';

  -- (supersede) the completed run is no longer the live calculation.
  update public.bonus_calculation_runs
    set status = 'superseded'
    where id = v_run and organization_id = p_organization_id and status = 'completed';

  -- (re-approval) approved → calculated (a fresh run + re-approval + re-accrual are
  -- separate explicit operator steps — C-c1).
  update public.bonus_periods
    set status = 'calculated'
    where id = p_bonus_period_id and organization_id = p_organization_id and status = 'approved';

  return v_snap;
end;
$$;

comment on function public.recalculate_bonus_after_dispute(uuid, uuid, uuid) is
  'Phase 7-C (C-c1): dispute-driven MECHANICAL correction — reverse the accrual (balanced), '
  'supersede the run, move the period approved→calculated for re-approval. No recompute; old '
  'snapshot immutable (ADR-006); paid accrual gated (D2). Idempotent. SECURITY DEFINER, server-only.';

revoke execute on function public.recalculate_bonus_after_dispute(uuid, uuid, uuid) from public, anon;
grant execute on function public.recalculate_bonus_after_dispute(uuid, uuid, uuid) to authenticated, service_role;
