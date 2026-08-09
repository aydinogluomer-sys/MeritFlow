-- =============================================================================
-- pgTAP — Phase 6-b blocking suite: bonus_ledger accrual (approve → double-entry)
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 06 §2/§4, ADR-006 (approved-snapshot boundary), ADR-017 (double-entry),
--       Decision Lock D2/AD6/AD8/AD10; 16 (BL-1/BL-2/SI-3/SI-7/SI-12/SI-13).
--       Phase 6-b: post_bonus_accrual() + BL-2 (Σaccrual ≤ pool_ref) trigger.
--
-- Reuses the seeded Org C (ceres) worked example (period 230 / pool 231, 100k TL,
-- T=1) and runs the 0021 engine in-transaction, then approves the period and posts
-- the accrual. The deferred balance (0014) + BL-2 (0022) triggers fire at commit;
-- since the suite runs in one rolled-back transaction, they are forced with
-- `set constraints all immediate` (as in 0008). All UUIDs are seed-deterministic.
-- =============================================================================
begin;
select no_plan();

-- ---- helpers (Org C; rolled back with the test) -------------------------------------
create function _b6_period(p_period uuid, p_pool uuid, p_amount bigint, p_topup boolean, p_start date, p_end date)
returns void language plpgsql as $$
begin
  insert into public.bonus_periods (id, organization_id, period_type, starts_on, ends_on, status, created_by)
    values (p_period, 'c0000000-0000-0000-0000-000000000003', 'monthly', p_start, p_end, 'open', 'c0000000-0000-0000-0000-0000000000c3');
  insert into public.bonus_pools (id, organization_id, bonus_period_id, amount_minor, currency, status, top_up_approved, created_by)
    values (p_pool, 'c0000000-0000-0000-0000-000000000003', p_period, p_amount, 'TRY', 'draft', p_topup, 'c0000000-0000-0000-0000-0000000000c4');
end $$;

create function _b6_elig(p_pool uuid, p_emp uuid)
returns void language plpgsql as $$
begin
  insert into public.bonus_pool_eligibility
    (organization_id, bonus_pool_id, employee_id, eligible, days_active, eligibility_factor, proration_factor, primary_team_id, created_by)
  values ('c0000000-0000-0000-0000-000000000003', p_pool, p_emp, true, 20, 1, 1.0, 'c0000000-0000-0000-0000-0000000000fc', 'c0000000-0000-0000-0000-0000000000c3');
end $$;

create function _b6_lock(p_period uuid, p_pool uuid, p_torg numeric)
returns void language plpgsql as $$
begin
  update public.bonus_pools set status='locked', t_org=p_torg, locked_at=now(), locked_by='c0000000-0000-0000-0000-0000000000c4'
    where id=p_pool and status='draft';
  update public.bonus_periods set status='locked', locked_at=now(), locked_by='c0000000-0000-0000-0000-0000000000c3'
    where id=p_period and status='open';
end $$;

-- =============================================================================
-- SECTION A — privileged (engine runs; accrual posted deterministically)
-- =============================================================================

-- (#1) Function exists.
select has_function('public', 'post_bonus_accrual', 'post_bonus_accrual exists');

-- Worked example: run the 0021 engine on the seeded locked 230/231 -> calculated +
-- snapshot + allocations (Ali/Ayşe/Mehmet/Zeynep).
select public.run_bonus_calculation(
  'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000230',
  'a0000000-0000-0000-0000-000000000231', '6bwe', 'c0000000-0000-0000-0000-0000000000c3');

-- (#2) Approval boundary: accrual is rejected while the period is 'calculated' (ADR-006).
select throws_ok(
  $$ select public.post_bonus_accrual('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230','c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 'accrual rejected on a calculated (not approved) period (ADR-006 boundary)');

-- HR moves the period calculated -> approved (existing transition; period.manage).
select lives_ok(
  $$ update public.bonus_periods set status='approved' where id='a0000000-0000-0000-0000-000000000230' and status='calculated' $$,
  'HR moves period calculated -> approved');

-- (#3) Post the accrual.
select lives_ok(
  $$ select public.post_bonus_accrual('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230','c0000000-0000-0000-0000-0000000000c3') $$,
  'post_bonus_accrual posts the approved accrual');

-- (#4) Deferred balance (0014) + BL-2 (0022) accept the worked accrual (forced immediate).
select lives_ok('set constraints all immediate',
  'deferred balance + BL-2 accept the worked accrual (Σdebit=Σcredit; Σaccrual ≤ pool_ref)');

-- (#5) Per-employee accrual credits reproduce doc 05 §8 finals.
select is((select amount_minor from public.bonus_ledger where account='accrual' and event_type='bonus_accrual' and employee_id='a0000000-0000-0000-0000-000000000201'),
  3177630::bigint, 'Ali accrual credit = 3,177,630');
select is((select amount_minor from public.bonus_ledger where account='accrual' and event_type='bonus_accrual' and employee_id='a0000000-0000-0000-0000-000000000202'),
  3177629::bigint, 'Ayse accrual credit = 3,177,629');
select is((select amount_minor from public.bonus_ledger where account='accrual' and event_type='bonus_accrual' and employee_id='a0000000-0000-0000-0000-000000000203'),
  953289::bigint, 'Mehmet accrual credit = 953,289');
select is((select amount_minor from public.bonus_ledger where account='accrual' and event_type='bonus_accrual' and employee_id='a0000000-0000-0000-0000-000000000204'),
  2691452::bigint, 'Zeynep accrual credit = 2,691,452');

-- (#6) Pool debit = Σfinal (org-level; employee_id null). Scoped to Org C (Section A is
-- privileged/bypassrls, so a manual org filter avoids the seeded Org A accrual fixture).
select is((select amount_minor from public.bonus_ledger where organization_id='c0000000-0000-0000-0000-000000000003' and account='pool' and event_type='bonus_accrual' and employee_id is null),
  10000000::bigint, 'pool debit = Σfinal = 10,000,000');

-- (#7) Double-entry: Σdebit = Σcredit (ADR-017).
select is(
  (select coalesce(sum(amount_minor) filter (where entry_type='debit'),0) from public.bonus_ledger where organization_id='c0000000-0000-0000-0000-000000000003' and event_type='bonus_accrual'),
  (select coalesce(sum(amount_minor) filter (where entry_type='credit'),0) from public.bonus_ledger where organization_id='c0000000-0000-0000-0000-000000000003' and event_type='bonus_accrual'),
  'accrual Σdebit = Σcredit (ADR-017)');

-- (#8) BL-2 boundary: Σaccrual credits = pool_ref (10,000,000).
select is(
  (select coalesce(sum(amount_minor) filter (where account='accrual' and entry_type='credit'),0)::bigint from public.bonus_ledger where organization_id='c0000000-0000-0000-0000-000000000003' and event_type='bonus_accrual'),
  10000000::bigint, 'Σaccrual credits = 10,000,000 (= pool_ref; BL-2 boundary)');

-- (#9) Idempotency: a second post is a no-op (same snapshot).
select public.post_bonus_accrual('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230','c0000000-0000-0000-0000-0000000000c3');
select is((select count(*) from public.bonus_ledger where organization_id='c0000000-0000-0000-0000-000000000003' and event_type='bonus_accrual' and account='accrual'),
  4::bigint, 'idempotent: still 4 accrual credits after re-post');
select is((select count(*) from public.bonus_ledger where organization_id='c0000000-0000-0000-0000-000000000003' and event_type='bonus_accrual' and account='pool'),
  1::bigint, 'idempotent: still 1 pool debit after re-post');

-- (#10) BL-2 rejection: an extra accrual credit pushes Σaccrual over pool_ref (constraints
-- are immediate from #4; the balanced pair passes balance but fails the pool cap).
select throws_ok(
  $$ do $b$
     declare v_snap uuid; v_run uuid; v_txn uuid := gen_random_uuid();
     begin
       select s.id, r.id into v_snap, v_run
       from public.bonus_allocation_snapshots s
       join public.bonus_calculation_runs r on r.id = s.calculation_run_id
       where r.bonus_period_id='a0000000-0000-0000-0000-000000000230' and r.status='completed';
       insert into public.bonus_ledger
         (organization_id, bonus_pool_id, employee_id, calculation_run_id, snapshot_id, transaction_id, entry_type, account, event_type, amount_minor, created_by)
       values
         ('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000231', null, v_run, v_snap, v_txn, 'debit','pool','bonus_accrual',100,'c0000000-0000-0000-0000-0000000000c4'),
         ('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000231','a0000000-0000-0000-0000-000000000205', v_run, v_snap, v_txn, 'credit','accrual','bonus_accrual',100,'c0000000-0000-0000-0000-0000000000c4');
     end $b$; $$,
  '23514', NULL, 'BL-2: an accrual exceeding pool_ref is rejected');

-- (#11) AD6 gate: a pending_missing_cap_basis allocation blocks accrual. Cansu (205) has
-- no compensation record -> her allocation is pending -> accrual must be refused.
select _b6_period('a0000000-0000-0000-0000-000000000290','a0000000-0000-0000-0000-000000000291',10000000,false,(now()-interval '22 days')::date,(now()+interval '15 days')::date);
select _b6_elig('a0000000-0000-0000-0000-000000000291','a0000000-0000-0000-0000-000000000205');
select _b6_lock('a0000000-0000-0000-0000-000000000290','a0000000-0000-0000-0000-000000000291',1);
select public.run_bonus_calculation('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000290','a0000000-0000-0000-0000-000000000291','ad6-6b','c0000000-0000-0000-0000-0000000000c3');
select lives_ok(
  $$ update public.bonus_periods set status='approved' where id='a0000000-0000-0000-0000-000000000290' and status='calculated' $$,
  'AD6 scenario: period calculated -> approved');
select throws_ok(
  $$ select public.post_bonus_accrual('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000290','c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 'AD6: a pending_missing_cap_basis allocation blocks accrual');

-- (#12) Append-only (BL-1): an accrual row cannot be UPDATEd.
select throws_ok(
  $$ update public.bonus_ledger set reason='tamper' where organization_id='c0000000-0000-0000-0000-000000000003' and account='pool' and event_type='bonus_accrual' and employee_id is null $$,
  '23001', 'append-only: UPDATE on bonus_ledger is not permitted',
  'append-only: UPDATE on an accrual row blocked (BL-1)');

-- (#13) Permission catalog unchanged (no new permission for accrual/approval).
select is((select count(*) from public.permissions), 20::bigint, 'permission catalog unchanged (20)');

-- =============================================================================
-- SECTION B — RLS as authenticated users (money-ledger raw read = Finance + Auditor)
-- =============================================================================
set local role authenticated;

-- Finance C reads the accrual rows.
select set_config('request.jwt.claims','{"sub":"c0000000-0000-0000-0000-0000000000c4"}', true);
select ok((select count(*) from public.bonus_ledger where event_type='bonus_accrual') >= 5,
  'Finance C reads bonus_ledger accrual rows');

-- Auditor C reads the accrual rows.
select set_config('request.jwt.claims','{"sub":"c0000000-0000-0000-0000-0000000000c6"}', true);
select ok((select count(*) from public.bonus_ledger where event_type='bonus_accrual') >= 5,
  'Auditor C reads bonus_ledger accrual rows');

-- HR C is excluded from the raw money ledger (SI-12).
select set_config('request.jwt.claims','{"sub":"c0000000-0000-0000-0000-0000000000c3"}', true);
select is((select count(*) from public.bonus_ledger where event_type='bonus_accrual'),
  0::bigint, 'HR C cannot read raw bonus_ledger (SI-12)');

-- Employee is excluded.
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000201"}', true);
select is((select count(*) from public.bonus_ledger where event_type='bonus_accrual'),
  0::bigint, 'employee cannot read raw bonus_ledger');

-- Manager is excluded.
select set_config('request.jwt.claims','{"sub":"c0000000-0000-0000-0000-0000000000c5"}', true);
select is((select count(*) from public.bonus_ledger where event_type='bonus_accrual'),
  0::bigint, 'manager cannot read raw bonus_ledger');

-- Cross-tenant: Finance A cannot read Org C accrual (SI-7).
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is((select count(*) from public.bonus_ledger where organization_id='c0000000-0000-0000-0000-000000000003'),
  0::bigint, 'cross-tenant: Finance A cannot read Org C bonus_ledger (SI-7)');

reset role;
select * from finish();
rollback;
