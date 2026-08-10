-- =============================================================================
-- Migration 0029 — dispute bonus re-run orchestration  (Phase 7-E)
-- Refs: 07_DISPUTE_WORKFLOW_SPEC §63 (accepted-bonus → new run + snapshot), 05_BONUS_ENGINE_SPEC,
--       docs/planning/00_DECISION_LOCK.md (D2 no auto-clawback; AD10; ADR-006 human re-approval).
--       Builds on 0026 (7-C mechanical recalc) + 0028 (7-D engine: gate IN('locked','calculated')
--       + dispute_adjustment folded into net approved_points).
--
-- Phase 7-E upgrades recalculate_bonus_after_dispute() from C-c1 (mechanical only) to FULL
-- orchestration: after the reversal + supersede + approved→calculated steps it AUTOMATICALLY
-- calls run_bonus_calculation() to produce a new run + immutable snapshot (which now reflects
-- the accepted dispute_adjustment via 7-D). The period stays 'calculated' — HR still approves
-- (calculated→approved) and post_bonus_accrual() runs separately (ADR-006 human re-approval).
--
-- Locked decisions (OQ-7E-*): same 3-arg signature (CREATE OR REPLACE → grant/OID kept);
-- return type stays uuid but NOW returns the NEW snapshot id; new-run idempotency key =
-- 'disp-recalc-snap-' || <reversed snapshot id>; pool fetched from the DB (locked pool for the
-- period; none → 23514); 7-E does NOT accrue. No new permission (catalog 20). No schema change.
-- DELIBERATELY ABSENT: clawback (D2 gated), auto re-approval/re-accrual, app/UI/API.
-- Local dev/staging only — never production (ADR-014).
-- =============================================================================

create or replace function public.recalculate_bonus_after_dispute(
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
  v_new_run       uuid;
  v_new_snap      uuid;
  v_pool_id       uuid;
  v_already_reversed boolean := false;
begin
  -- (authz — OQ-6) HR (period.manage) or a trusted server/job context. auth.uid() IS NULL =
  -- no authenticated JWT identity (current_user is the owner inside a SECURITY DEFINER).
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

  -- (A) Idempotency: if the accrual was already reversed, the mechanical steps are done.
  -- If the new run also exists, the whole orchestration is complete → return its snapshot.
  -- Otherwise fall through to the pool-fetch + run (reversal done, new run missing).
  if v_snap is not null and exists (
       select 1 from public.bonus_ledger
       where snapshot_id = v_snap and organization_id = p_organization_id and event_type = 'reversal') then
    v_already_reversed := true;
    select id into v_new_run
    from public.bonus_calculation_runs
    where organization_id = p_organization_id
      and idempotency_key = 'disp-recalc-snap-' || v_snap::text;
    if v_new_run is not null then
      select id into v_new_snap
      from public.bonus_allocation_snapshots where calculation_run_id = v_new_run;
      return v_new_snap;   -- fully idempotent (reversal + new run already produced)
    end if;
  end if;

  -- (B) Mechanical steps (verbatim from 7-C) run only on the first pass.
  if not v_already_reversed then
    -- (precondition — OQ-7C-4) the period must be approved (an accrual exists to reverse).
    if v_period_status <> 'approved' then
      raise exception 'bonus recalculation requires an approved bonus_period (status %; no accrual to reverse)',
        v_period_status using errcode = '23514';
    end if;
    if v_snap is null then
      raise exception 'approved bonus_period % has no accrual to recalculate', p_bonus_period_id using errcode = '23514';
    end if;

    -- (paid-guard — OQ-4/D2) never reverse a PAID accrual (clawback is gated).
    if exists (
         select 1 from public.bonus_ledger
         where organization_id = p_organization_id and snapshot_id = v_snap
           and event_type in ('payout_exported', 'payout_marked_paid')) then
      raise exception 'cannot recalculate: accrual for snapshot % is already paid — clawback is gated (D2)', v_snap
        using errcode = '23514';
    end if;

    -- (reversal) mirror each accrual row (entry_type swapped, new transaction_id, reversal).
    -- Σdebit=Σcredit preserved; BL-2 (0022) ignores reversal rows.
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

    -- (re-approval) approved → calculated (re-approval + re-accrual remain separate steps).
    update public.bonus_periods
      set status = 'calculated'
      where id = p_bonus_period_id and organization_id = p_organization_id and status = 'approved';
  end if;

  -- (C) NEW (7-E): fetch the locked pool + produce a new run + immutable snapshot that reflects
  -- the accepted dispute_adjustment (7-D engine). The deterministic idempotency key ties the new
  -- run to the reversed snapshot so repeated dispute-recalc cycles are safe.
  select id into v_pool_id
  from public.bonus_pools
  where bonus_period_id = p_bonus_period_id
    and organization_id = p_organization_id
    and status = 'locked';
  if v_pool_id is null then
    raise exception 'no locked bonus_pool found for period % in org % — cannot recompute',
      p_bonus_period_id, p_organization_id using errcode = '23514';
  end if;

  v_new_snap := public.run_bonus_calculation(
    p_organization_id,
    p_bonus_period_id,
    v_pool_id,
    'disp-recalc-snap-' || v_snap::text,
    p_triggered_by
  );

  return v_new_snap;
end;
$$;

comment on function public.recalculate_bonus_after_dispute(uuid, uuid, uuid) is
  'Phase 7-E: dispute-driven FULL recalculation — reverse the accrual (balanced), supersede the '
  'run, move the period approved→calculated, then run_bonus_calculation() to produce a NEW run + '
  'immutable snapshot reflecting the dispute_adjustment (7-D). Returns the NEW snapshot id. Period '
  'stays calculated (HR re-approves → post_bonus_accrual separately — ADR-006). Old snapshot '
  'immutable; paid accrual gated (D2). Idempotent (deterministic key). SECURITY DEFINER, server-only.';

revoke execute on function public.recalculate_bonus_after_dispute(uuid, uuid, uuid) from public, anon;
grant execute on function public.recalculate_bonus_after_dispute(uuid, uuid, uuid) to authenticated, service_role;
