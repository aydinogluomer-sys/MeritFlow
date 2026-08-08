-- =============================================================================
-- Migration 0021 — bonus engine (Safe Pro-Rata calculation)  (Phase 6-core)
-- Refs: 05_BONUS_ENGINE_SPEC (formula + §8 worked example), 14/15/16 (§3-§5 machines),
--       Decision Lock D1/D6/D10/AD6/AD7/AD8/AD9/AD10/SI-3/SI-12/SI-13/SI-14, ADR-006/017.
--       Phase 6-core slice: the CALCULATION engine that POPULATES the existing 0013
--       containers (runs/allocations/snapshots). NO bonus_ledger accrual (Decision A →
--       6-b). No new tables. No new permission.
--
-- run_bonus_calculation(org, period, pool, idempotency_key, triggered_by) — SECURITY
-- DEFINER (E, G): validates locked period + locked pool (AD10), reads eligible employees
-- (bonus_pool_eligibility), sums approved points (point_ledger task_approved joined to
-- tasks.approved_at within the period — H), computes Safe Pro-Rata (W_individual=1.0 —
-- D1; no malus — D2), applies eligibility/proration to the CAP only (D10), caps from
-- compensation_records.cap_basis_minor × organization_settings.cap_rate_default (missing
-- basis → pending_missing_cap_basis, no unlimited cap — AD6, C), applies T_org + AD8
-- top-up, allocates integer kuruş via largest remainder (tie-break employee_id asc),
-- writes bonus_allocations (while run 'running'), writes one immutable snapshot, completes
-- the run (freeze), and transitions the period locked→calculated (B). Idempotent per
-- (org, idempotency_key). Σ final + undistributed = pool_ref (SI-13). Server-only (SI-11);
-- Finance stays raw-excluded (SI-12, 0013 RLS). Writes NO bonus_ledger (A).
--
-- pool_ref: the invariant reference. For T≤1 (and AD8-capped T=1.2 without top-up) it is
-- pool.amount_minor (the T_org cut goes to undistributed). For approved top-up (T=1.2 +
-- top_up_approved) it is the topped-up budget floor(amount·1.2).
-- =============================================================================

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
  -- (G) Entry authz: HR (period.manage) or a trusted server/definer context.
  if not (public.has_permission('period.manage') or current_user not in ('authenticated', 'anon')) then
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

  -- Locked period + locked pool (AD10).
  select status, starts_on, ends_on into v_period_status, v_starts, v_ends
  from public.bonus_periods where id = p_bonus_period_id and organization_id = p_organization_id;
  if not found then
    raise exception 'bonus_period % not found in org %', p_bonus_period_id, p_organization_id using errcode = '23503';
  end if;
  if v_period_status <> 'locked' then
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

  -- Per-employee inputs: eligible + approved points (H) + adjusted score (D1: factors=1)
  -- + cap basis. Only adjusted_score > 0 rows participate.
  drop table if exists _bce_tmp;
  create temp table _bce_tmp on commit drop as
  with elig as (
    select e.employee_id, e.primary_team_id, coalesce(e.proration_factor, 1) as proration, e.eligibility_factor
    from public.bonus_pool_eligibility e
    where e.bonus_pool_id = p_bonus_pool_id and e.organization_id = p_organization_id and e.eligible = true
  ),
  pts as (
    select el.*, coalesce((
        select sum(pl.points_delta)
        from public.point_ledger pl
        join public.tasks t on t.id = pl.task_id and t.organization_id = pl.organization_id
        where pl.event_type = 'task_approved' and pl.employee_id = el.employee_id
          and pl.organization_id = p_organization_id
          and t.approved_at::date between v_starts and v_ends
      ), 0)::numeric as approved_points
    from elig el
  )
  select p.employee_id, p.primary_team_id, p.proration, p.eligibility_factor, p.approved_points,
         (p.approved_points * p.eligibility_factor)::numeric as adjusted_score,
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
  where (p.approved_points * p.eligibility_factor) > 0;

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
                       'approved_points', t.approved_points),
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
  update public.bonus_calculation_runs set status = 'completed', completed_at = now() where id = v_run;
  update public.bonus_periods set status = 'calculated' where id = p_bonus_period_id and status = 'locked';

  return v_snap;
end;
$$;

comment on function public.run_bonus_calculation(uuid, uuid, uuid, text, uuid) is
  'Safe Pro-Rata bonus calculation engine (doc 05, Phase 6-core): locked period+pool → allocations + immutable '
  'snapshot; largest-remainder kuruş; AD6/AD8/AD9/AD10; Σfinal+undistributed=pool_ref (SI-13); idempotent; '
  'period locked→calculated; NO bonus_ledger accrual (6-b). SECURITY DEFINER, server-only.';

revoke execute on function public.run_bonus_calculation(uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.run_bonus_calculation(uuid, uuid, uuid, text, uuid) to authenticated, service_role;
