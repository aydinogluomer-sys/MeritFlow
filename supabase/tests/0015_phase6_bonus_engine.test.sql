-- =============================================================================
-- pgTAP — Phase 6 blocking suite: bonus engine (Safe Pro-Rata calculation)
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 05 (formula + §8 worked example), 14/15/16, D1/D6/D10/AD6/AD7/AD8/AD9/AD10/
--       SI-12/SI-13/SI-14. Phase 6-core (NO bonus_ledger accrual).
--
-- The worked example (seed period 230 / pool 231, 100k TL, T=1, adj 1000/1000/300/847)
-- reproduces doc 05 §8 exactly: final 3,177,630 / 3,177,629 / 953,289 / 2,691,452,
-- Σ=pool, undistributed=0, tie-break Ali(201) < Ayşe(202). Other scenarios are built
-- inline via helper functions and reuse the seeded employees' approved points.
-- =============================================================================
begin;
select no_plan();

-- ---- helpers (rolled back with the test) ---------------------------------------------
create function _bce_period(p_period uuid, p_pool uuid, p_amount bigint, p_topup boolean, p_start date, p_end date)
returns void language plpgsql as $$
begin
  insert into public.bonus_periods (id, organization_id, period_type, starts_on, ends_on, status, created_by)
    values (p_period, 'c0000000-0000-0000-0000-000000000003', 'monthly', p_start, p_end, 'open', 'c0000000-0000-0000-0000-0000000000c3');
  insert into public.bonus_pools (id, organization_id, bonus_period_id, amount_minor, currency, status, top_up_approved, created_by)
    values (p_pool, 'c0000000-0000-0000-0000-000000000003', p_period, p_amount, 'TRY', 'draft', p_topup, 'c0000000-0000-0000-0000-0000000000c4');
end $$;

create function _bce_elig(p_pool uuid, p_emp uuid)
returns void language plpgsql as $$
begin
  insert into public.bonus_pool_eligibility
    (organization_id, bonus_pool_id, employee_id, eligible, days_active, eligibility_factor, proration_factor, primary_team_id, created_by)
  values ('c0000000-0000-0000-0000-000000000003', p_pool, p_emp, true, 20, 1, 1.0, 'c0000000-0000-0000-0000-0000000000fc', 'c0000000-0000-0000-0000-0000000000c3');
end $$;

create function _bce_lock(p_period uuid, p_pool uuid, p_torg numeric)
returns void language plpgsql as $$
begin
  update public.bonus_pools set status='locked', t_org=p_torg, locked_at=now(), locked_by='c0000000-0000-0000-0000-0000000000c4'
    where id=p_pool and status='draft';
  update public.bonus_periods set status='locked', locked_at=now(), locked_by='c0000000-0000-0000-0000-0000000000c3'
    where id=p_period and status='open';
end $$;

-- =============================================================================
-- SECTION A — privileged (engine runs; deterministic results)
-- =============================================================================

-- (#1) Function exists.
select has_function('public', 'run_bonus_calculation', 'run_bonus_calculation exists');

-- (#2) WORKED EXAMPLE (seed pool 231): reproduce doc 05 §8 exactly.
select public.run_bonus_calculation(
  'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000230',
  'a0000000-0000-0000-0000-000000000231', 'we-1', 'c0000000-0000-0000-0000-0000000000c3');

select is((select final_amount_minor from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000230' and employee_id='a0000000-0000-0000-0000-000000000201'),
  3177630::bigint, 'Ali final = 3,177,630 (largest-remainder +1, tie-break winner)');
select is((select final_amount_minor from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000230' and employee_id='a0000000-0000-0000-0000-000000000202'),
  3177629::bigint, 'Ayse final = 3,177,629 (loses the tie to lower employee_id)');
select is((select final_amount_minor from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000230' and employee_id='a0000000-0000-0000-0000-000000000203'),
  953289::bigint, 'Mehmet final = 953,289 (largest frac +1)');
select is((select final_amount_minor from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000230' and employee_id='a0000000-0000-0000-0000-000000000204'),
  2691452::bigint, 'Zeynep final = 2,691,452');
select is((select sum(final_amount_minor)::bigint from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000230'),
  10000000::bigint, 'Σ final = pool (10,000,000 kuruş)');
select is((select s.undistributed_remainder_minor from public.bonus_allocation_snapshots s join public.bonus_calculation_runs r on r.id=s.calculation_run_id where r.bonus_period_id='a0000000-0000-0000-0000-000000000230'),
  0::bigint, 'undistributed_remainder = 0');
-- SI-13 invariant explicitly.
select is((select (sum(a.final_amount_minor) + max(s.undistributed_remainder_minor))::bigint
           from public.bonus_allocations a join public.bonus_calculation_runs r on r.id=a.calculation_run_id
           join public.bonus_allocation_snapshots s on s.calculation_run_id=r.id where r.bonus_period_id='a0000000-0000-0000-0000-000000000230'),
  10000000::bigint, 'SI-13: Σ final + undistributed = pool');
select is((select cap_applied from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000230' and employee_id='a0000000-0000-0000-0000-000000000201'),
  'no', 'no cap binds in the worked example');
select ok((select (factors->>'eligibility')='1' and (factors ? 'proration') from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000230' and employee_id='a0000000-0000-0000-0000-000000000201'),
  'AD7: allocation factors recorded');
select is((select status from public.bonus_periods where id='a0000000-0000-0000-0000-000000000230'), 'calculated', 'B: period locked -> calculated');
select is((select status from public.bonus_calculation_runs where bonus_period_id='a0000000-0000-0000-0000-000000000230'), 'completed', 'run completed');

-- (#3) Idempotency: same key -> no new run/snapshot/allocations.
select public.run_bonus_calculation(
  'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000230',
  'a0000000-0000-0000-0000-000000000231', 'we-1', 'c0000000-0000-0000-0000-0000000000c3');
select is((select count(*) from public.bonus_calculation_runs where bonus_period_id='a0000000-0000-0000-0000-000000000230'), 1::bigint, 'idempotent: one run for the key');
select is((select count(*) from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000230'), 4::bigint, 'idempotent: four allocations (not duplicated)');

-- (#4) Completed-run allocations are frozen (0013 guard).
select throws_ok(
  $$ update public.bonus_allocations set final_amount_minor=1 where bonus_period_id='a0000000-0000-0000-0000-000000000230' and employee_id='a0000000-0000-0000-0000-000000000201' $$,
  '23001', null, 'completed-run allocation is frozen (0013 freeze guard)');

-- (#5) Snapshot immutable (0013 append-only).
select throws_ok(
  $$ update public.bonus_allocation_snapshots set undistributed_remainder_minor=1 where bonus_period_id='a0000000-0000-0000-0000-000000000230' $$,
  '23001', null, 'snapshot is immutable (append-only)');

-- (#6) NO bonus_ledger written by the engine (accrual boundary — A). Seed has 5 rows.
select is((select count(*) from public.bonus_ledger), 5::bigint, 'engine wrote NO bonus_ledger rows (accrual deferred to 6-b)');

-- (#7) AD10: cannot calculate on a non-locked period.
select _bce_period('a0000000-0000-0000-0000-000000000260', 'a0000000-0000-0000-0000-000000000261', 10000000, false, (now()-interval '16 days')::date, (now()+interval '15 days')::date);
select throws_ok(
  $$ select public.run_bonus_calculation('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000260','a0000000-0000-0000-0000-000000000261','ad10','c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', 'bonus calculation requires a locked bonus_period (AD10; status open)', 'AD10: unlocked period rejected');

-- (#8) Cap binding + all-capped + D6 residual (pool 1,000,000,000; cap 5,000,000 each).
select _bce_period('a0000000-0000-0000-0000-000000000262', 'a0000000-0000-0000-0000-000000000263', 1000000000, false, (now()-interval '17 days')::date, (now()+interval '15 days')::date);
select _bce_elig('a0000000-0000-0000-0000-000000000263','a0000000-0000-0000-0000-000000000201');
select _bce_elig('a0000000-0000-0000-0000-000000000263','a0000000-0000-0000-0000-000000000202');
select _bce_elig('a0000000-0000-0000-0000-000000000263','a0000000-0000-0000-0000-000000000203');
select _bce_elig('a0000000-0000-0000-0000-000000000263','a0000000-0000-0000-0000-000000000204');
select _bce_lock('a0000000-0000-0000-0000-000000000262','a0000000-0000-0000-0000-000000000263', 1);
select public.run_bonus_calculation('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000262','a0000000-0000-0000-0000-000000000263','cap','c0000000-0000-0000-0000-0000000000c3');
select is((select count(*) from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000262' and cap_applied='yes'), 4::bigint, 'all four capped (cap_applied=yes)');
select is((select final_amount_minor from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000262' and employee_id='a0000000-0000-0000-0000-000000000201'), 5000000::bigint, 'capped final = cap_minor (5,000,000)');
select is((select sum(final_amount_minor)::bigint from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000262'), 20000000::bigint, 'Σ capped final = 20,000,000');
select is((select s.undistributed_remainder_minor from public.bonus_allocation_snapshots s join public.bonus_calculation_runs r on r.id=s.calculation_run_id where r.bonus_period_id='a0000000-0000-0000-0000-000000000262'), 980000000::bigint, 'D6: cap residual not redistributed -> undistributed 980,000,000');

-- (#9) AD8: T_org=1.2 WITHOUT top-up -> distributable capped at pool.
select _bce_period('a0000000-0000-0000-0000-000000000264', 'a0000000-0000-0000-0000-000000000265', 10000000, false, (now()-interval '18 days')::date, (now()+interval '15 days')::date);
select _bce_elig('a0000000-0000-0000-0000-000000000265','a0000000-0000-0000-0000-000000000201');
select _bce_elig('a0000000-0000-0000-0000-000000000265','a0000000-0000-0000-0000-000000000202');
select _bce_elig('a0000000-0000-0000-0000-000000000265','a0000000-0000-0000-0000-000000000203');
select _bce_elig('a0000000-0000-0000-0000-000000000265','a0000000-0000-0000-0000-000000000204');
select _bce_lock('a0000000-0000-0000-0000-000000000264','a0000000-0000-0000-0000-000000000265', 1.2);
select public.run_bonus_calculation('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000264','a0000000-0000-0000-0000-000000000265','ad8-no','c0000000-0000-0000-0000-0000000000c3');
select is((select sum(final_amount_minor)::bigint from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000264'), 10000000::bigint, 'AD8 no top-up: distributable capped at pool (Σ=10,000,000)');
select is((select s.top_up_applied from public.bonus_allocation_snapshots s join public.bonus_calculation_runs r on r.id=s.calculation_run_id where r.bonus_period_id='a0000000-0000-0000-0000-000000000264'), false, 'AD8 no top-up: top_up_applied=false');

-- (#10) AD8: T_org=1.2 WITH top-up -> can exceed pool (topped-up budget).
select _bce_period('a0000000-0000-0000-0000-000000000266', 'a0000000-0000-0000-0000-000000000267', 10000000, true, (now()-interval '19 days')::date, (now()+interval '15 days')::date);
select _bce_elig('a0000000-0000-0000-0000-000000000267','a0000000-0000-0000-0000-000000000201');
select _bce_elig('a0000000-0000-0000-0000-000000000267','a0000000-0000-0000-0000-000000000202');
select _bce_elig('a0000000-0000-0000-0000-000000000267','a0000000-0000-0000-0000-000000000203');
select _bce_elig('a0000000-0000-0000-0000-000000000267','a0000000-0000-0000-0000-000000000204');
select _bce_lock('a0000000-0000-0000-0000-000000000266','a0000000-0000-0000-0000-000000000267', 1.2);
select public.run_bonus_calculation('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000266','a0000000-0000-0000-0000-000000000267','ad8-yes','c0000000-0000-0000-0000-0000000000c3');
select is((select sum(final_amount_minor)::bigint from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000266'), 12000000::bigint, 'AD8 top-up: distributable = 1.2 × pool (Σ=12,000,000)');
select is((select s.top_up_applied from public.bonus_allocation_snapshots s join public.bonus_calculation_runs r on r.id=s.calculation_run_id where r.bonus_period_id='a0000000-0000-0000-0000-000000000266'), true, 'AD8 top-up: top_up_applied=true');

-- (#11) T_org = 0 -> zero distribution; pool undistributed.
select _bce_period('a0000000-0000-0000-0000-000000000268', 'a0000000-0000-0000-0000-000000000269', 10000000, false, (now()-interval '20 days')::date, (now()+interval '15 days')::date);
select _bce_elig('a0000000-0000-0000-0000-000000000269','a0000000-0000-0000-0000-000000000201');
select _bce_lock('a0000000-0000-0000-0000-000000000268','a0000000-0000-0000-0000-000000000269', 0);
select public.run_bonus_calculation('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000268','a0000000-0000-0000-0000-000000000269','torg0','c0000000-0000-0000-0000-0000000000c3');
select is((select coalesce(sum(final_amount_minor),0)::bigint from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000268'), 0::bigint, 'T_org=0: Σ final = 0');
select is((select s.undistributed_remainder_minor from public.bonus_allocation_snapshots s join public.bonus_calculation_runs r on r.id=s.calculation_run_id where r.bonus_period_id='a0000000-0000-0000-0000-000000000268'), 10000000::bigint, 'T_org=0: whole pool undistributed');

-- (#12) Σadj = 0 (period excludes the approved dates) -> no distribution.
select _bce_period('a0000000-0000-0000-0000-000000000270', 'a0000000-0000-0000-0000-000000000271', 10000000, false, date '2020-01-01', date '2020-01-31');
select _bce_elig('a0000000-0000-0000-0000-000000000271','a0000000-0000-0000-0000-000000000201');
select _bce_elig('a0000000-0000-0000-0000-000000000271','a0000000-0000-0000-0000-000000000202');
select _bce_lock('a0000000-0000-0000-0000-000000000270','a0000000-0000-0000-0000-000000000271', 1);
select public.run_bonus_calculation('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000270','a0000000-0000-0000-0000-000000000271','sumadj0','c0000000-0000-0000-0000-0000000000c3');
select is((select count(*) from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000270'), 0::bigint, 'Σadj=0: no allocations');
select is((select s.undistributed_remainder_minor from public.bonus_allocation_snapshots s join public.bonus_calculation_runs r on r.id=s.calculation_run_id where r.bonus_period_id='a0000000-0000-0000-0000-000000000270'), 10000000::bigint, 'Σadj=0: whole pool undistributed');

-- (#13) Single eligible employee (Mehmet 300 pts, small pool 1,000,000 -> no cap).
select _bce_period('a0000000-0000-0000-0000-000000000272', 'a0000000-0000-0000-0000-000000000273', 1000000, false, (now()-interval '21 days')::date, (now()+interval '15 days')::date);
select _bce_elig('a0000000-0000-0000-0000-000000000273','a0000000-0000-0000-0000-000000000203');
select _bce_lock('a0000000-0000-0000-0000-000000000272','a0000000-0000-0000-0000-000000000273', 1);
select public.run_bonus_calculation('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000272','a0000000-0000-0000-0000-000000000273','single','c0000000-0000-0000-0000-0000000000c3');
select is((select final_amount_minor from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000272' and employee_id='a0000000-0000-0000-0000-000000000203'), 1000000::bigint, 'single eligible gets the full distributable (1,000,000)');
select is((select s.undistributed_remainder_minor from public.bonus_allocation_snapshots s join public.bonus_calculation_runs r on r.id=s.calculation_run_id where r.bonus_period_id='a0000000-0000-0000-0000-000000000272'), 0::bigint, 'single eligible: undistributed 0');

-- (#14) AD6: missing cap basis -> pending_missing_cap_basis, no unlimited cap (Cansu 205, no comp).
select _bce_period('a0000000-0000-0000-0000-000000000274', 'a0000000-0000-0000-0000-000000000275', 10000000, false, (now()-interval '22 days')::date, (now()+interval '15 days')::date);
select _bce_elig('a0000000-0000-0000-0000-000000000275','a0000000-0000-0000-0000-000000000205');
select _bce_lock('a0000000-0000-0000-0000-000000000274','a0000000-0000-0000-0000-000000000275', 1);
select public.run_bonus_calculation('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000274','a0000000-0000-0000-0000-000000000275','ad6','c0000000-0000-0000-0000-0000000000c3');
select is((select cap_applied from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000274' and employee_id='a0000000-0000-0000-0000-000000000205'), 'pending_missing_cap_basis', 'AD6: missing cap basis -> pending_missing_cap_basis');
select is((select status from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000274' and employee_id='a0000000-0000-0000-0000-000000000205'), 'pending_missing_cap_basis', 'AD6: allocation status pending_missing_cap_basis (export-blocked)');
select ok((select cap_minor is null from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000274' and employee_id='a0000000-0000-0000-0000-000000000205'), 'AD6: no cap applied (cap_minor null — no unlimited cap materialized)');

-- (#15) permission catalog unchanged.
select is((select count(*) from public.permissions), 20::bigint, 'permission catalog unchanged (20)');

-- =============================================================================
-- SECTION B — RLS as authenticated users (allocation reads)
-- =============================================================================
set local role authenticated;

-- Finance is raw-excluded from allocations (SI-12).
select set_config('request.jwt.claims','{"sub":"c0000000-0000-0000-0000-0000000000c4"}', true);
select is((select count(*) from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000230'), 0::bigint, 'Finance cannot read raw allocations (SI-12)');
-- Employee sees own allocation.
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000201"}', true);
select is((select count(*) from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000230' and employee_id='a0000000-0000-0000-0000-000000000201'), 1::bigint, 'employee sees own allocation');
-- Cross-tenant.
select set_config('request.jwt.claims','{"sub":"b0000000-0000-0000-0000-0000000000b2"}', true);
select is((select count(*) from public.bonus_allocations where bonus_period_id='a0000000-0000-0000-0000-000000000230'), 0::bigint, 'cross-tenant: org-B cannot read org-C allocations (SI-7)');

reset role;
select * from finish();
rollback;
