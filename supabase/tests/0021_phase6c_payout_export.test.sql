-- =============================================================================
-- pgTAP — Phase 6-c blocking suite: payout / export engine
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 06 §2 (payout marked paid = debit accrual / credit payout; BL-1/BL-3), 16
--       §3/§5/§8, 03 §1/§4 (payout.export/mark_paid; Finance view-only SI-12), 0027.
--
-- Section A reuses the seeded Org C worked example (period 230 / pool 231, 10,000,000):
-- run → approve → accrue → export → mark paid. Sections B/C build self-contained
-- fixtures (a pending allocation for the AD6 gate; a manual accrual + export for the
-- ledger guards). All UUIDs are seed-deterministic.
-- =============================================================================
begin;
select no_plan();

-- helper: the accrued snapshot id for a period (Org C).
create function _b6c_snap(p_period uuid)
returns uuid language sql as $$
  select s.id
  from public.bonus_allocation_snapshots s
  join public.bonus_calculation_runs r
    on r.id = s.calculation_run_id and r.organization_id = s.organization_id
  where r.bonus_period_id = p_period and r.organization_id = 'c0000000-0000-0000-0000-000000000003'
  limit 1;
$$;

-- helper (BL-3): insert a balanced payout pair (+ optional balanced reversal to zero the
-- net accrual) then force the deferred triggers. Used inside throws_ok so it rolls back.
create function _b6c_try_pay(p_snap uuid, p_emp uuid, p_amount bigint, p_export uuid, p_with_reversal boolean)
returns void language plpgsql as $$
declare
  v_rev_txn uuid := gen_random_uuid();
  v_pay_txn uuid := gen_random_uuid();
begin
  if p_with_reversal then
    insert into public.bonus_ledger
      (organization_id, bonus_pool_id, employee_id, snapshot_id, transaction_id, entry_type, account, event_type, amount_minor, reason, created_by)
    values
      ('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000006c3', p_emp, p_snap, v_rev_txn, 'debit',  'accrual', 'reversal', p_amount, 'x-rev', 'c0000000-0000-0000-0000-0000000000c3'),
      ('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000006c3', null,  p_snap, v_rev_txn, 'credit', 'pool',    'reversal', p_amount, 'x-rev', 'c0000000-0000-0000-0000-0000000000c3');
  end if;
  insert into public.bonus_ledger
    (organization_id, bonus_pool_id, employee_id, snapshot_id, export_id, transaction_id, entry_type, account, event_type, amount_minor, reason, created_by)
  values
    ('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000006c3', p_emp, p_snap, p_export, v_pay_txn, 'debit',  'accrual', 'payout_marked_paid', p_amount, 'x-pay', 'c0000000-0000-0000-0000-0000000000c3'),
    ('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000006c3', p_emp, p_snap, p_export, v_pay_txn, 'credit', 'payout',  'payout_marked_paid', p_amount, 'x-pay', 'c0000000-0000-0000-0000-0000000000c3');
  set constraints all immediate;
end $$;

-- =============================================================================
-- SECTION A — happy path (period 230): run → approve → accrue → export → mark paid
-- =============================================================================
select public.run_bonus_calculation(
  'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000230',
  'a0000000-0000-0000-0000-000000000231', '6cwe', 'c0000000-0000-0000-0000-0000000000c3');
update public.bonus_periods set status = 'approved'
  where id = 'a0000000-0000-0000-0000-000000000230' and status = 'calculated';
select public.post_bonus_accrual(
  'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000230',
  'c0000000-0000-0000-0000-0000000000c3');

-- (#1) Functions exist.
select has_function('public', 'produce_payout_export', 'produce_payout_export exists');
select has_function('public', 'mark_payout_paid', 'mark_payout_paid exists');

-- (#2) Positive export: approved period → exports record + period approved→exported.
select lives_ok(
  $$ select public.produce_payout_export('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230', _b6c_snap('a0000000-0000-0000-0000-000000000230'), 'csv', 'c0000000-0000-0000-0000-0000000000c4') $$,
  'produce_payout_export succeeds on an approved period');
select is((select count(*) from public.exports where bonus_period_id = 'a0000000-0000-0000-0000-000000000230'), 1::bigint,
  'an exports record is created');
select is((select status from public.bonus_periods where id = 'a0000000-0000-0000-0000-000000000230'), 'exported',
  'period approved → exported');

-- (#3) Re-export blocked: the period is no longer approved.
select throws_ok(
  $$ select public.produce_payout_export('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230', _b6c_snap('a0000000-0000-0000-0000-000000000230'), 'csv', 'c0000000-0000-0000-0000-0000000000c4') $$,
  '23514', NULL, 'export on a non-approved (exported) period → 23514');

-- (#4) Positive mark-paid: per employee debit accrual / credit payout; period → closed.
select lives_ok(
  $$ select public.mark_payout_paid('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230', (select id from public.exports where bonus_period_id='a0000000-0000-0000-0000-000000000230' limit 1), 'c0000000-0000-0000-0000-0000000000c4') $$,
  'mark_payout_paid succeeds on an exported period');
select is((select count(*) from public.bonus_ledger where event_type = 'payout_marked_paid' and snapshot_id = _b6c_snap('a0000000-0000-0000-0000-000000000230')),
  8::bigint, '4 debit-accrual + 4 credit-payout payout rows');
select is((select status from public.bonus_periods where id = 'a0000000-0000-0000-0000-000000000230'), 'closed',
  'period exported → closed');

-- (#5) The payout transaction is balanced.
select is(
  (select coalesce(sum(amount_minor) filter (where entry_type='debit'),0) from public.bonus_ledger where event_type='payout_marked_paid' and snapshot_id=_b6c_snap('a0000000-0000-0000-0000-000000000230')),
  (select coalesce(sum(amount_minor) filter (where entry_type='credit'),0) from public.bonus_ledger where event_type='payout_marked_paid' and snapshot_id=_b6c_snap('a0000000-0000-0000-0000-000000000230')),
  'payout Σdebit = Σcredit');

-- (#6) Idempotency: a second mark-paid is a no-op (same txn, no new rows) even though the
-- period is now 'closed' (idempotency is checked before the period gate).
select is(
  (select public.mark_payout_paid('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230', (select id from public.exports where bonus_period_id='a0000000-0000-0000-0000-000000000230' limit 1), 'c0000000-0000-0000-0000-0000000000c4')),
  (select transaction_id from public.bonus_ledger where event_type='payout_marked_paid' and snapshot_id=_b6c_snap('a0000000-0000-0000-0000-000000000230') limit 1),
  'second mark-paid returns the existing txn (idempotent no-op)');
select is((select count(*) from public.bonus_ledger where event_type='payout_marked_paid' and snapshot_id=_b6c_snap('a0000000-0000-0000-0000-000000000230')),
  8::bigint, 're-mark adds no new rows');

-- (#7) Append-only: a payout row cannot be mutated.
select throws_ok(
  $$ update public.bonus_ledger set amount_minor = 1 where event_type='payout_marked_paid' and snapshot_id=_b6c_snap('a0000000-0000-0000-0000-000000000230') $$,
  '23001', NULL, 'payout_marked_paid row is append-only (UPDATE → 23001)');

-- =============================================================================
-- SECTION B — AD6/SI-15 export block (self-contained pending allocation fixture)
-- =============================================================================
insert into public.bonus_periods (id, organization_id, period_type, starts_on, ends_on, status, created_by)
  values ('c0000000-0000-0000-0000-0000000006b2','c0000000-0000-0000-0000-000000000003','monthly', date '2024-05-01', date '2024-05-31','open','c0000000-0000-0000-0000-0000000000c3');
insert into public.bonus_pools (id, organization_id, bonus_period_id, amount_minor, currency, status, created_by)
  values ('c0000000-0000-0000-0000-0000000006b3','c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000006b2', 1000,'TRY','draft','c0000000-0000-0000-0000-0000000000c3');
update public.bonus_pools set status='locked', t_org=1, locked_at=now(), locked_by='c0000000-0000-0000-0000-0000000000c3' where id='c0000000-0000-0000-0000-0000000006b3';
update public.bonus_periods set status='locked', locked_at=now(), locked_by='c0000000-0000-0000-0000-0000000000c3' where id='c0000000-0000-0000-0000-0000000006b2';
insert into public.bonus_calculation_runs (id, organization_id, bonus_period_id, bonus_pool_id, status, idempotency_key, t_org, triggered_by)
  values ('c0000000-0000-0000-0000-0000000006b4','c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000006b2','c0000000-0000-0000-0000-0000000006b3','running','6c-ad6',1,'c0000000-0000-0000-0000-0000000000c3');
insert into public.bonus_allocations
  (organization_id, calculation_run_id, bonus_period_id, employee_id, primary_team_id, adjusted_score, raw_share_minor, final_amount_minor, cap_applied, status)
  values ('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000006b4','c0000000-0000-0000-0000-0000000006b2','a0000000-0000-0000-0000-000000000201','c0000000-0000-0000-0000-0000000000fc', 1, 0, 0, 'pending_missing_cap_basis', 'pending_missing_cap_basis');
update public.bonus_calculation_runs set status='completed', completed_at=now() where id='c0000000-0000-0000-0000-0000000006b4';
insert into public.bonus_allocation_snapshots (id, organization_id, calculation_run_id, bonus_period_id, bonus_pool_id, t_org, undistributed_remainder_minor, calculation_metadata)
  values ('c0000000-0000-0000-0000-0000000006b5','c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000006b4','c0000000-0000-0000-0000-0000000006b2','c0000000-0000-0000-0000-0000000006b3',1,0,'{}'::jsonb);
update public.bonus_periods set status='calculated' where id='c0000000-0000-0000-0000-0000000006b2' and status='locked';
update public.bonus_periods set status='approved'   where id='c0000000-0000-0000-0000-0000000006b2' and status='calculated';

-- (#8) AD6/SI-15: export blocked while an allocation is pending_missing_cap_basis (0018 trigger).
select throws_ok(
  $$ select public.produce_payout_export('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000006b2','c0000000-0000-0000-0000-0000000006b5','csv','c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 'AD6/SI-15: pending_missing_cap_basis → export blocked (23514)');

-- =============================================================================
-- SECTION C — ledger guards (self-contained accrual 1000 for emp 201 + an export)
-- =============================================================================
insert into public.bonus_periods (id, organization_id, period_type, starts_on, ends_on, status, created_by)
  values ('c0000000-0000-0000-0000-0000000006c2','c0000000-0000-0000-0000-000000000003','monthly', date '2024-06-01', date '2024-06-30','open','c0000000-0000-0000-0000-0000000000c3');
insert into public.bonus_pools (id, organization_id, bonus_period_id, amount_minor, currency, status, created_by)
  values ('c0000000-0000-0000-0000-0000000006c3','c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000006c2', 5000,'TRY','draft','c0000000-0000-0000-0000-0000000000c3');
update public.bonus_pools set status='locked', t_org=1, locked_at=now(), locked_by='c0000000-0000-0000-0000-0000000000c3' where id='c0000000-0000-0000-0000-0000000006c3';
update public.bonus_periods set status='locked', locked_at=now(), locked_by='c0000000-0000-0000-0000-0000000000c3' where id='c0000000-0000-0000-0000-0000000006c2';
insert into public.bonus_calculation_runs (id, organization_id, bonus_period_id, bonus_pool_id, status, idempotency_key, t_org, triggered_by)
  values ('c0000000-0000-0000-0000-0000000006c4','c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000006c2','c0000000-0000-0000-0000-0000000006c3','running','6c-guard',1,'c0000000-0000-0000-0000-0000000000c3');
update public.bonus_calculation_runs set status='completed', completed_at=now() where id='c0000000-0000-0000-0000-0000000006c4';
insert into public.bonus_allocation_snapshots (id, organization_id, calculation_run_id, bonus_period_id, bonus_pool_id, t_org, undistributed_remainder_minor, calculation_metadata)
  values ('c0000000-0000-0000-0000-0000000006c5','c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000006c4','c0000000-0000-0000-0000-0000000006c2','c0000000-0000-0000-0000-0000000006c3',1,0,'{}'::jsonb);
update public.bonus_periods set status='calculated' where id='c0000000-0000-0000-0000-0000000006c2' and status='locked';
update public.bonus_periods set status='approved'   where id='c0000000-0000-0000-0000-0000000006c2' and status='calculated';
-- manual balanced accrual (pool debit 1000 / emp 201 credit 1000).
insert into public.bonus_ledger
  (organization_id, bonus_pool_id, employee_id, calculation_run_id, snapshot_id, transaction_id, entry_type, account, event_type, amount_minor, reason, created_by)
values
  ('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000006c3', null, 'c0000000-0000-0000-0000-0000000006c4','c0000000-0000-0000-0000-0000000006c5','c0000000-0000-0000-0000-0000000006c6','debit', 'pool',    'bonus_accrual', 1000, 'manual accrual','c0000000-0000-0000-0000-0000000000c3'),
  ('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000006c3', 'a0000000-0000-0000-0000-000000000201', 'c0000000-0000-0000-0000-0000000006c4','c0000000-0000-0000-0000-0000000006c5','c0000000-0000-0000-0000-0000000006c6','credit','accrual', 'bonus_accrual', 1000, 'manual accrual','c0000000-0000-0000-0000-0000000000c3');
-- produce an export (period approved → exported).
select public.produce_payout_export('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000006c2','c0000000-0000-0000-0000-0000000006c5','csv','c0000000-0000-0000-0000-0000000000c4');

-- (#9) payout_exported stays blocked (not a money movement — the exports record is).
select throws_ok(
  $$ insert into public.bonus_ledger (organization_id, bonus_pool_id, snapshot_id, transaction_id, entry_type, account, event_type, amount_minor, reason, created_by)
     values ('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000006c3','c0000000-0000-0000-0000-0000000006c5', gen_random_uuid(),'debit','payout','payout_exported',100,'x','c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 'payout_exported stays blocked (23514)');

-- (#10) clawback_pending stays blocked (D2 gated workflow).
select throws_ok(
  $$ insert into public.bonus_ledger (organization_id, bonus_pool_id, snapshot_id, transaction_id, entry_type, account, event_type, amount_minor, reason, created_by)
     values ('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000006c3','c0000000-0000-0000-0000-0000000006c5', gen_random_uuid(),'debit','clawback','clawback_pending',100,'x','c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 'clawback_pending stays blocked (D2, 23514)');

-- (#11) payout_marked_paid WITHOUT export_id is rejected by the CHECK.
select throws_ok(
  $$ insert into public.bonus_ledger (organization_id, bonus_pool_id, employee_id, snapshot_id, transaction_id, entry_type, account, event_type, amount_minor, reason, created_by)
     values ('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000006c3','a0000000-0000-0000-0000-000000000201','c0000000-0000-0000-0000-0000000006c5', gen_random_uuid(),'debit','accrual','payout_marked_paid',100,'x','c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 'payout_marked_paid without export_id → 23514 (payout_export_chk)');

-- (#12) BL-3: payout > accrual is rejected (deferred trigger, forced immediate).
select throws_ok(
  $$ select _b6c_try_pay('c0000000-0000-0000-0000-0000000006c5','a0000000-0000-0000-0000-000000000201', 2000, (select id from public.exports where bonus_period_id='c0000000-0000-0000-0000-0000000006c2' limit 1), false) $$,
  '23514', NULL, 'BL-3: payout 2000 > accrual 1000 → 23514');

-- (#13) BL-3 reversal-aware: a fully-reversed accrual (net 0) → any payout is rejected.
select throws_ok(
  $$ select _b6c_try_pay('c0000000-0000-0000-0000-0000000006c5','a0000000-0000-0000-0000-000000000201', 1000, (select id from public.exports where bonus_period_id='c0000000-0000-0000-0000-0000000006c2' limit 1), true) $$,
  '23514', NULL, 'BL-3 reversal-aware: net accrual 0 → payout blocked (23514)');

-- (#14) DB balance: all pending (org, txn) groups balance + BL-2 + BL-3 pass.
select lives_ok('set constraints all immediate',
  'all bonus_ledger transactions balance (accrual + payout) and BL-2/BL-3 pass');

-- (#15) Permission catalog is unchanged (no new permission).
select is((select count(*) from public.permissions), 20::bigint, 'permission catalog stays 20');

-- =============================================================================
-- SECTION D — authz + Finance view + cross-tenant (authenticated)
-- =============================================================================
set local role authenticated;

-- (#16) Authz export: an employee without payout.export is rejected.
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000201"}', true);
select throws_ok(
  $$ select public.produce_payout_export('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230', _b6c_snap('a0000000-0000-0000-0000-000000000230'), 'csv', 'a0000000-0000-0000-0000-000000000201') $$,
  '42501', NULL, 'employee without payout.export → 42501');

-- (#17) Authz mark-paid: an employee without payout.mark_paid is rejected.
select throws_ok(
  $$ select public.mark_payout_paid('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230', (select id from public.exports where bonus_period_id='a0000000-0000-0000-0000-000000000230' limit 1), 'a0000000-0000-0000-0000-000000000201') $$,
  '42501', NULL, 'employee without payout.mark_paid → 42501');

-- (#18) v_finance_payout: Finance C sees the Org C payout row (period 230, employee 201, paid).
select set_config('request.jwt.claims','{"sub":"c0000000-0000-0000-0000-0000000000c4"}', true);
select ok(
  exists (select 1 from public.v_finance_payout
          where bonus_period_id='a0000000-0000-0000-0000-000000000230'
            and employee_id='a0000000-0000-0000-0000-000000000201' and status='paid' and paid_amount_minor > 0),
  'Finance C sees the period-230 payout row (status=paid) in v_finance_payout');

-- (#19) v_finance_payout hides raw allocation/comp detail (columns absent).
select hasnt_column('public','v_finance_payout','adjusted_score','v_finance_payout has no adjusted_score (SI-12)');
select hasnt_column('public','v_finance_payout','cap_basis_minor','v_finance_payout has no cap_basis_minor (SI-12)');

-- (#20) Cross-tenant: Org A Finance cannot see Org C payout (security_invoker + RLS — SI-7).
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is(
  (select count(*) from public.v_finance_payout where bonus_period_id='a0000000-0000-0000-0000-000000000230'),
  0::bigint, 'cross-tenant: Org A Finance sees no Org C payout (SI-7)');

reset role;
select * from finish();
rollback;
