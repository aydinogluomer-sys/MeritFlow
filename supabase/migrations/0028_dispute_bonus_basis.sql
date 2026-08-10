-- =============================================================================
-- Migration 0028 — dispute_adjustment → bonus basis  (Phase 7-D)
-- Refs: 05_BONUS_ENGINE_SPEC (adjusted_score = approved_points × factors; approved_points
--       = period's approved-earning total from the point ledger), 07_DISPUTE_WORKFLOW_SPEC
--       (§25/§63: accepted-bonus → the affected period's calculation reflects it),
--       docs/planning/00_DECISION_LOCK.md (D1 Safe Pro-Rata W=1.0 / D2 no-auto-punish /
--       D10 / AD6 / AD7 / AD10). Builds on 0021 (engine), 0024 (6-d authz fix),
--       0025 (dispute point adjustment), 0026 (7-C recalc).
--
-- Scope-lock decisions (locked):
--   OQ-7D-1  point_ledger.bonus_period_id nullable column (attribution key); the engine
--            sums dispute_adjustment into net approved_points by (employee, bonus_period_id).
--   OQ-7D-2  run_bonus_calculation() CREATE OR REPLACE (same signature → grant/OID kept).
--   OQ-7D-3  engine period gate widened to IN('locked','calculated') so a dispute-adjusted
--            re-run can execute on a re-opened (calculated) period; the locked→calculated
--            end-transition still only fires from 'locked' (existing WHERE clause). Auto
--            orchestration (reversal + new run/snapshot + re-accrual) is DEFERRED to 7-E.
--   OQ-7D-4  net approved_points ≤ 0 → adjusted_score ≤ 0 → excluded by the existing >0
--            filter (0 bonus). No max(0,·) clamp (a correction is not a D2 malus multiplier).
--   OQ-7D-5  bonus_allocations.factors jsonb gains a dispute_adjustment_points breakdown
--            (additive value only — no schema change) for explainability.
--   OQ-7D-7  no new permission (catalog stays 20).
--
-- NOTE: apply_dispute_point_adjustment() gains a p_bonus_period_id parameter — this CHANGES
-- the signature, so the 4-arg function is DROPped and the 5-arg created (grant re-issued);
-- "CREATE OR REPLACE keeps the OID" only holds for an unchanged signature (run_bonus_calc).
--
-- DELIBERATELY ABSENT (gated): recalculate_bonus_after_dispute() auto re-run orchestration
-- (7-E), manual point override (5-b), app/UI/API, new permission. Local dev/staging only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- point_ledger: additive bonus_period_id (attribution key for dispute_adjustment) +
-- same-org composite FK to bonus_periods (SI-7) + an event-consistency CHECK:
-- a dispute_adjustment MUST carry bonus_period_id; every other event MUST NOT (task
-- attribution stays via tasks.approved_at). Existing seed rows are all non-dispute with
-- bonus_period_id NULL → they satisfy the CHECK; there are no dispute_adjustment seed rows.
-- -----------------------------------------------------------------------------
alter table public.point_ledger add column bonus_period_id uuid;

alter table public.point_ledger
  add constraint point_ledger_bonus_period_org_fk
  foreign key (bonus_period_id, organization_id)
  references public.bonus_periods (id, organization_id);

alter table public.point_ledger
  add constraint point_ledger_bonus_period_event_chk
  check (
    (event_type = 'dispute_adjustment' and bonus_period_id is not null)
    or (event_type <> 'dispute_adjustment' and bonus_period_id is null)
  );

-- -----------------------------------------------------------------------------
-- apply_dispute_point_adjustment(): + p_bonus_period_id (the affected period, resolved by
-- the producer from the dispute target — OQ-7D-1). Signature change → DROP the 4-arg + CREATE
-- the 5-arg (grant re-issued). Body is the 0025 body + setting bonus_period_id in the INSERT.
-- -----------------------------------------------------------------------------
drop function public.apply_dispute_point_adjustment(uuid, numeric, text, uuid);

create function public.apply_dispute_point_adjustment(
  p_dispute_id      uuid,
  p_points_delta    numeric,
  p_reason          text,
  p_actor           uuid,
  p_bonus_period_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org         uuid;
  v_complainant uuid;
  v_status      text;
  v_resolution  text;
  v_existing    uuid;
  v_row         uuid;
begin
  -- (authz — OQ-7B-1) dispute resolver (dispute.resolve) or a trusted server/job context.
  if not (public.has_permission('dispute.resolve') or auth.uid() is null) then
    raise exception 'not authorized to apply a dispute point adjustment (dispute.resolve required)' using errcode = '42501';
  end if;

  -- (OQ-7B-5) a zero delta is meaningless.
  if p_points_delta = 0 then
    raise exception 'dispute point adjustment delta must be non-zero' using errcode = '23514';
  end if;

  -- Load the dispute; org/employee are DERIVED from the row (no cross-org param — SI-7).
  select organization_id, complainant_id, status, resolution
    into v_org, v_complainant, v_status, v_resolution
  from public.disputes where id = p_dispute_id;
  if not found then
    raise exception 'dispute % not found', p_dispute_id using errcode = '23503';
  end if;

  -- (OQ-7B-3, fail-closed) must be resolved/closed AND accepted; else no row.
  if not (v_status in ('resolved', 'closed') and v_resolution = 'accepted') then
    raise exception 'dispute % is not resolved+accepted (status %, resolution %) — no adjustment applied',
      p_dispute_id, v_status, coalesce(v_resolution, 'null') using errcode = '23514';
  end if;

  -- Idempotency: an adjustment already exists for this dispute => no-op (return it).
  select id into v_existing
  from public.point_ledger
  where dispute_id = p_dispute_id and event_type = 'dispute_adjustment'
  limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Append the single delta for the complainant (OQ-7B-2), attributed to the affected
  -- period (OQ-7D-1; the bonus_period_id NOT NULL requirement is enforced by the CHECK).
  insert into public.point_ledger
    (organization_id, employee_id, event_type, points_delta, reason, dispute_id, bonus_period_id, created_by, metadata)
  values
    (v_org, v_complainant, 'dispute_adjustment', p_points_delta, p_reason, p_dispute_id, p_bonus_period_id, p_actor,
     jsonb_build_object('dispute_id', p_dispute_id))
  returning id into v_row;

  return v_row;
end;
$$;

comment on function public.apply_dispute_point_adjustment(uuid, numeric, text, uuid, uuid) is
  'Phase 7-B/7-D: resolved+accepted dispute → one append-only point_ledger dispute_adjustment '
  'delta for the complainant, attributed to p_bonus_period_id (7-D). Idempotent per dispute; '
  'audited. SECURITY DEFINER, server-only. authz dispute.resolve OR auth.uid() IS NULL.';

revoke execute on function public.apply_dispute_point_adjustment(uuid, numeric, text, uuid, uuid) from public, anon;
grant execute on function public.apply_dispute_point_adjustment(uuid, numeric, text, uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- run_bonus_calculation(): CREATE OR REPLACE (same signature — grant/OID kept). Changes vs
-- 0021 (+ the 6-d authz fix which 0024 applied at runtime — preserved here):
--   (3a) authz uses auth.uid() IS NULL (not current_user — 6-d).
--   (3b) period gate widened to IN('locked','calculated') (OQ-7D-3).
--   (3d) approved_points = NET (task_approved by approved_at) + (dispute_adjustment by
--        bonus_period_id) — OQ-7D-1; the >0 filter still excludes net ≤ 0 (OQ-7D-4).
--   (3e) factors gains dispute_adjustment_points (OQ-7D-5).
-- The locked→calculated transition (3c) is unchanged: its existing WHERE status='locked'
-- makes it a no-op when starting from 'calculated'.
-- -----------------------------------------------------------------------------
create or replace function public.run_bonus_calculation(
  p_organization_id uuid,
  p_bonus_period_id uuid,
  p_bonus_pool_id   uuid,
  p_idempotency_key text,
  p_triggered_by    uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_run  uuid;
  v_snap          uuid;
  v_period_status text;
  v_starts        date;
  v_ends          date;
  v_pool_status   text;
  v_A             bigint;
  v_T             numeric;
  v_topup_pool    boolean;
  v_cap_rate      numeric;
  v_policy        uuid;
  v_run           uuid;
  v_distributable bigint;
  v_pool_ref      bigint;
  v_topup_applied boolean;
  v_sum_adj       numeric;
  v_dist          bigint;
  v_remainder     bigint;
  v_final_sum     bigint;
  v_undistributed bigint;
begin
  -- (G) Entry authz: HR (period.manage) or a trusted server/definer context. auth.uid() IS
  -- NULL is the trusted signal (6-d fix; current_user is the owner inside SECURITY DEFINER).
  if not (public.has_permission('period.manage') or auth.uid() is null) then
    raise exception 'not authorized to run bonus calculation (period.manage required)' using errcode = '42501';
  end if;

  -- Idempotency: an existing run for this key returns its snapshot (no new work).
  select id into v_existing_run
  from public.bonus_calculation_runs
  where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
  if v_existing_run is not null then
    select id into v_snap from public.bonus_allocation_snapshots where calculation_run_id = v_existing_run;
    return v_snap;
  end if;

  -- Locked OR calculated period (7-D/OQ-7D-3: allow a dispute-adjusted re-run on a
  -- re-opened 'calculated' period) + locked pool (AD10).
  select status, starts_on, ends_on into v_period_status, v_starts, v_ends
  from public.bonus_periods where id = p_bonus_period_id and organization_id = p_organization_id;
  if not found then
    raise exception 'bonus_period % not found in org %', p_bonus_period_id, p_organization_id using errcode = '23503';
  end if;
  if v_period_status not in ('locked', 'calculated') then
    -- Message text preserved verbatim from 0021 so the 0015 AD10 assertion still matches
    -- (the gate now also admits 'calculated' — 7-D/OQ-7D-3 — but the wording is unchanged).
    raise exception 'bonus calculation requires a locked bonus_period (AD10; status %)', v_period_status using errcode = '23514';
  end if;

  select status, amount_minor, t_org, top_up_approved into v_pool_status, v_A, v_T, v_topup_pool
  from public.bonus_pools
  where id = p_bonus_pool_id and organization_id = p_organization_id and bonus_period_id = p_bonus_period_id;
  if not found then
    raise exception 'bonus_pool % not found for period % in org %', p_bonus_pool_id, p_bonus_period_id, p_organization_id using errcode = '23503';
  end if;
  if v_pool_status <> 'locked' then
    raise exception 'bonus calculation requires a locked bonus_pool (AD10; status %)', v_pool_status using errcode = '23514';
  end if;

  select coalesce(cap_rate_default, 0.50) into v_cap_rate
  from public.organization_settings where organization_id = p_organization_id;
  v_cap_rate := coalesce(v_cap_rate, 0.50);

  select id into v_policy from public.scoring_policy_versions
  where organization_id = p_organization_id and status = 'published' order by version_no desc limit 1;

  -- Distributable + pool_ref (T_org + AD8).
  if v_T is null or v_T = 0 then
    v_distributable := 0;                          v_pool_ref := v_A;           v_topup_applied := false;
  elsif v_T <= 1 then
    v_distributable := floor(v_A * v_T)::bigint;   v_pool_ref := v_A;           v_topup_applied := false;
  elsif v_T = 1.2 and v_topup_pool then
    v_distributable := floor(v_A * 1.2)::bigint;   v_pool_ref := v_distributable; v_topup_applied := true;
  else                                             -- T=1.2, no top-up: capped at pool (AD8)
    v_distributable := v_A;                        v_pool_ref := v_A;           v_topup_applied := false;
  end if;

  -- Run header (running). validate_calculation_run re-checks AD10; audit fires.
  insert into public.bonus_calculation_runs
    (organization_id, bonus_period_id, bonus_pool_id, policy_version_id, status, idempotency_key, t_org, top_up_applied, triggered_by)
  values
    (p_organization_id, p_bonus_period_id, p_bonus_pool_id, v_policy, 'running', p_idempotency_key, v_T, v_topup_applied, p_triggered_by)
  returning id into v_run;

  -- Per-employee inputs: eligible + NET approved points (7-D/OQ-7D-1):
  --   task_points     = Σ task_approved (joined to tasks.approved_at in the period)
  --   dispute_points  = Σ dispute_adjustment attributed to THIS period (bonus_period_id)
  --   approved_points = task_points + dispute_points   (net; may be reduced by a negative delta)
  -- + adjusted score (D1: factors=1) + cap basis. Only NET adjusted_score > 0 participates
  -- (OQ-7D-4: a net ≤ 0 employee is excluded — 0 bonus; a correction is not a D2 malus).
  drop table if exists _bce_tmp;
  create temp table _bce_tmp on commit drop as
  with elig as (
    select e.employee_id, e.primary_team_id, coalesce(e.proration_factor, 1) as proration, e.eligibility_factor
    from public.bonus_pool_eligibility e
    where e.bonus_pool_id = p_bonus_pool_id and e.organization_id = p_organization_id and e.eligible = true
  ),
  pts as (
    select el.*,
      coalesce((
        select sum(pl.points_delta)
        from public.point_ledger pl
        join public.tasks t on t.id = pl.task_id and t.organization_id = pl.organization_id
        where pl.event_type = 'task_approved' and pl.employee_id = el.employee_id
          and pl.organization_id = p_organization_id
          and t.approved_at::date between v_starts and v_ends
      ), 0)::numeric as task_points,
      coalesce((
        select sum(pl.points_delta)
        from public.point_ledger pl
        where pl.event_type = 'dispute_adjustment' and pl.employee_id = el.employee_id
          and pl.organization_id = p_organization_id
          and pl.bonus_period_id = p_bonus_period_id
      ), 0)::numeric as dispute_points
    from elig el
  )
  select p.employee_id, p.primary_team_id, p.proration, p.eligibility_factor,
         (p.task_points + p.dispute_points) as approved_points,
         p.dispute_points,
         ((p.task_points + p.dispute_points) * p.eligibility_factor)::numeric as adjusted_score,
         cr.cap_basis_minor,
         null::numeric as raw_share_num, null::bigint as raw_share_minor, null::numeric as frac,
         null::bigint as cap_minor, null::text as cap_applied, null::bigint as alloc_minor
  from pts p
  left join lateral (
    select cap_basis_minor from public.compensation_records c
    where c.organization_id = p_organization_id and c.employee_id = p.employee_id
      and c.status = 'active' and c.effective_to is null
    order by c.effective_from desc limit 1
  ) cr on true
  where ((p.task_points + p.dispute_points) * p.eligibility_factor) > 0;

  select coalesce(sum(adjusted_score), 0) into v_sum_adj from _bce_tmp;

  -- raw_share, floor, frac, cap, floored allocation.
  update _bce_tmp set
    raw_share_num = case when v_sum_adj = 0 then 0 else v_distributable::numeric * adjusted_score / v_sum_adj end;
  update _bce_tmp set
    raw_share_minor = floor(raw_share_num)::bigint,
    frac            = raw_share_num - floor(raw_share_num),
    cap_minor       = case when cap_basis_minor is null then null
                           else floor(cap_basis_minor * v_cap_rate * proration)::bigint end;
  update _bce_tmp set
    cap_applied = case when cap_basis_minor is null then 'pending_missing_cap_basis'
                       when cap_minor < raw_share_minor then 'yes' else 'no' end,
    alloc_minor = case when cap_basis_minor is null then raw_share_minor   -- provisional floor (C)
                       else least(cap_minor, raw_share_minor) end;

  select coalesce(sum(alloc_minor), 0) into v_dist from _bce_tmp;
  v_remainder := greatest(v_distributable - v_dist, 0);

  -- Largest remainder: +1 kuruş to the top v_remainder UNCAPPED rows (frac desc,
  -- employee_id asc). Capped rows are excluded (D6: cap residual is not redistributed).
  insert into public.bonus_allocations
    (organization_id, calculation_run_id, bonus_period_id, employee_id, primary_team_id,
     adjusted_score, raw_share_minor, final_amount_minor, cap_basis_minor, cap_minor, cap_applied,
     rounding_adjustment_minor, factors, status)
  select
    p_organization_id, v_run, p_bonus_period_id, t.employee_id, t.primary_team_id,
    t.adjusted_score, t.raw_share_minor,
    t.alloc_minor + coalesce(lr.bump, 0),
    t.cap_basis_minor, t.cap_minor, t.cap_applied,
    coalesce(lr.bump, 0),
    jsonb_build_object('role', 1, 'quality', 1, 'team', 1,
                       'eligibility', t.eligibility_factor, 'proration', t.proration,
                       'approved_points', t.approved_points,
                       'dispute_adjustment_points', t.dispute_points),
    case when t.cap_applied = 'pending_missing_cap_basis' then 'pending_missing_cap_basis' else 'calculated' end
  from _bce_tmp t
  left join (
    select employee_id, 1 as bump
    from (
      select employee_id, row_number() over (order by frac desc, employee_id asc) as rn
      from _bce_tmp where cap_applied <> 'yes'
    ) r where r.rn <= v_remainder
  ) lr on lr.employee_id = t.employee_id;

  select coalesce(sum(final_amount_minor), 0) into v_final_sum
  from public.bonus_allocations where calculation_run_id = v_run;
  v_undistributed := v_pool_ref - v_final_sum;   -- SI-13: Σfinal + undistributed = pool_ref

  -- Immutable snapshot (SI-14: records all factors + remainder).
  insert into public.bonus_allocation_snapshots
    (organization_id, calculation_run_id, bonus_period_id, bonus_pool_id, policy_version_id,
     t_org, top_up_applied, undistributed_remainder_minor, calculation_metadata)
  values
    (p_organization_id, v_run, p_bonus_period_id, p_bonus_pool_id, v_policy,
     v_T, v_topup_applied, v_undistributed,
     jsonb_build_object('sum_adjusted', v_sum_adj, 'distributable_minor', v_distributable,
                        'pool_amount_minor', v_A, 'pool_ref_minor', v_pool_ref, 'cap_rate', v_cap_rate))
  returning id into v_snap;

  -- Complete the run (freezes allocations) + transition period locked→calculated (B).
  -- (7-D: the WHERE status='locked' makes this a no-op when starting from 'calculated'.)
  update public.bonus_calculation_runs set status = 'completed', completed_at = now() where id = v_run;
  update public.bonus_periods set status = 'calculated' where id = p_bonus_period_id and status = 'locked';

  return v_snap;
end;
$$;

comment on function public.run_bonus_calculation(uuid, uuid, uuid, text, uuid) is
  'Safe Pro-Rata bonus calculation engine (doc 05; Phase 6-core + 7-D): locked OR calculated '
  'period + locked pool → allocations + immutable snapshot; NET approved_points = task_approved '
  '(by approved_at) + dispute_adjustment (by bonus_period_id — 7-D); largest-remainder kuruş; '
  'AD6/AD8/AD9/AD10; Σfinal+undistributed=pool_ref (SI-13); idempotent; factors carry '
  'dispute_adjustment_points. SECURITY DEFINER, server-only.';
