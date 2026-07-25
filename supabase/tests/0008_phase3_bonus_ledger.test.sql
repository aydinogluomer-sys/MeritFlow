-- =============================================================================
-- pgTAP — Phase 3 blocking suite: bonus_ledger (double-entry money) foundation
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 06 §2, 14/15 (bonus_ledger §), 16 (BL-1..4, SI-3/SI-6/SI-7/SI-12),
--       ADR-005/006/017/018, Decision Lock D2/AD6.
--
-- Section A = privileged (bypassrls); Section B = RLS as authenticated. Server-only
-- writes; raw read Finance + Auditor ONLY (HR/employee/manager/support excluded — SI-12).
-- Append-only; accrual requires snapshot; idempotent accrual; only bonus_accrual +
-- reversal writable; Σdebit=Σcredit per (org, transaction_id) hard-enforced by a
-- DEFERRABLE INITIALLY DEFERRED constraint trigger.
--
-- The deferred balance trigger fires at COMMIT; since the suite runs in one rolled-back
-- transaction, balance scenarios are forced with `set constraints all immediate` inside
-- a savepoint (rolled back afterwards to restore both rows and constraint mode).
--
-- Seed fixtures: a balanced accrual transaction 50 (org A) on snapshot 35 / pool 31:
--   debit pool 100k = credit a7 60k + credit a8 40k (rows 51/52/53). Org B mirror.
-- =============================================================================
begin;
select no_plan();

-- =============================================================================
-- SECTION A — privileged (bypassrls)
-- =============================================================================

-- (#1) Table exists.
select has_table('public', 'bonus_ledger', 'bonus_ledger table exists');

-- (#2) RLS ENABLED + FORCE.
select is(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.bonus_ledger'::regclass),
  true, 'RLS ENABLED + FORCE on bonus_ledger (SI-6)');

-- (#3) Privileges: SELECT-only for authenticated (server-only + append-only).
select is(has_table_privilege('authenticated', 'public.bonus_ledger', 'SELECT'), true,  'ledger SELECT');
select is(has_table_privilege('authenticated', 'public.bonus_ledger', 'INSERT'), false, 'ledger no INSERT (server-only)');
select is(has_table_privilege('authenticated', 'public.bonus_ledger', 'UPDATE'), false, 'ledger no UPDATE (append-only)');
select is(has_table_privilege('authenticated', 'public.bonus_ledger', 'DELETE'), false, 'ledger no DELETE (append-only)');

-- (#4) Double-entry balance trigger (deferred). Balanced pair passes; single row fails.
-- The insert + `set constraints all immediate` run together inside one DO block (the
-- throws_ok / lives_ok subtransaction) so the deferred check is forced and its error is
-- catchable. The positive case is wrapped in a savepoint so its rows + constraint-mode
-- change do not leak to later tests.
savepoint sp_bal;
select lives_ok($$
  do $bal$
  begin
    insert into public.bonus_ledger
      (organization_id, bonus_pool_id, transaction_id, entry_type, account, event_type, amount_minor, created_by)
    values
      ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000031','a0000000-0000-0000-0000-000000000060','debit','accrual','reversal',500,'a0000000-0000-0000-0000-0000000000a4'),
      ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000031','a0000000-0000-0000-0000-000000000060','credit','pool','reversal',500,'a0000000-0000-0000-0000-0000000000a4');
    set constraints all immediate;
  end
  $bal$;
$$, 'balanced transaction passes the deferred balance check (Σdebit=Σcredit)');
rollback to savepoint sp_bal;

select throws_ok($$
  do $bal$
  begin
    insert into public.bonus_ledger
      (organization_id, bonus_pool_id, transaction_id, entry_type, account, event_type, amount_minor, created_by)
    values
      ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000031','a0000000-0000-0000-0000-000000000064','debit','accrual','reversal',700,'a0000000-0000-0000-0000-0000000000a4');
    set constraints all immediate;
  end
  $bal$;
$$, '23514', NULL,
  'unbalanced transaction rejected by the deferred balance trigger (Σdebit<>Σcredit)');

-- (#5) Simple column constraints.
select throws_ok(
  $$ insert into public.bonus_ledger (organization_id, bonus_pool_id, transaction_id, entry_type, account, event_type, amount_minor, created_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000031','a0000000-0000-0000-0000-000000000065','debit','accrual','reversal',0,'a0000000-0000-0000-0000-0000000000a4') $$,
  '23514',
  'new row for relation "bonus_ledger" violates check constraint "bonus_ledger_amount_pos_chk"',
  'amount_minor must be > 0');
select throws_ok(
  $$ insert into public.bonus_ledger (organization_id, bonus_pool_id, transaction_id, entry_type, account, event_type, amount_minor, currency, created_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000031','a0000000-0000-0000-0000-000000000065','debit','accrual','reversal',100,'TR','a0000000-0000-0000-0000-0000000000a4') $$,
  '23514',
  'new row for relation "bonus_ledger" violates check constraint "bonus_ledger_currency_chk"',
  'currency must be a 3-char code');

-- (#6) Accrual requires a snapshot (structural — SI-3).
select throws_ok(
  $$ insert into public.bonus_ledger (organization_id, bonus_pool_id, employee_id, transaction_id, entry_type, account, event_type, amount_minor, created_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000031','a0000000-0000-0000-0000-0000000000a7','a0000000-0000-0000-0000-000000000065','credit','accrual','bonus_accrual',100,'a0000000-0000-0000-0000-0000000000a4') $$,
  '23514',
  'new row for relation "bonus_ledger" violates check constraint "bonus_ledger_accrual_snapshot_chk"',
  'accrual requires snapshot_id (SI-3; approved-gate deferred)');

-- (#7) Idempotent accrual: duplicate (snapshot, employee, account) rejected.
select throws_ok(
  $$ insert into public.bonus_ledger (organization_id, bonus_pool_id, employee_id, snapshot_id, transaction_id, entry_type, account, event_type, amount_minor, created_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000031','a0000000-0000-0000-0000-0000000000a7','a0000000-0000-0000-0000-000000000035','a0000000-0000-0000-0000-000000000066','credit','accrual','bonus_accrual',100,'a0000000-0000-0000-0000-0000000000a4') $$,
  '23505',
  'duplicate key value violates unique constraint "uq_bonus_ledger_accrual_idem"',
  'duplicate accrual per (snapshot, employee, account) rejected (idempotent)');

-- (#8) event_type write guard: only bonus_accrual + reversal writable this slice.
select throws_ok(
  $$ insert into public.bonus_ledger (organization_id, bonus_pool_id, transaction_id, entry_type, account, event_type, amount_minor, created_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000031','a0000000-0000-0000-0000-000000000067','debit','payout','payout_exported',100,'a0000000-0000-0000-0000-0000000000a4') $$,
  '23514',
  'bonus_ledger event_type payout_exported is deferred to a later phase (approval/payout/clawback) — only bonus_accrual and reversal are writable in this slice',
  'payout_exported event rejected (deferred to later phase)');
select throws_ok(
  $$ insert into public.bonus_ledger (organization_id, bonus_pool_id, transaction_id, entry_type, account, event_type, amount_minor, created_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000031','a0000000-0000-0000-0000-000000000067','debit','pool','bonus_approved',100,'a0000000-0000-0000-0000-0000000000a4') $$,
  '23514',
  'bonus_ledger event_type bonus_approved is deferred to a later phase (approval/payout/clawback) — only bonus_accrual and reversal are writable in this slice',
  'bonus_approved event rejected (deferred to later phase)');

-- (#9) Append-only (BL-1): UPDATE and DELETE blocked.
select throws_ok(
  $$ update public.bonus_ledger set reason = 'x' where id = 'a0000000-0000-0000-0000-000000000052' $$,
  '23001',
  'append-only: UPDATE on bonus_ledger is not permitted',
  'UPDATE on bonus_ledger blocked (append-only — BL-1)');
select throws_ok(
  $$ delete from public.bonus_ledger where id = 'a0000000-0000-0000-0000-000000000052' $$,
  '23001',
  'append-only: DELETE on bonus_ledger is not permitted',
  'DELETE on bonus_ledger blocked (append-only — BL-1)');

-- (#10) Cross-tenant composite FK negatives (SI-7).
select throws_ok(
  $$ insert into public.bonus_ledger (organization_id, bonus_pool_id, transaction_id, entry_type, account, event_type, amount_minor, created_by)
     values ('a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000031','a0000000-0000-0000-0000-000000000068','debit','accrual','reversal',100,'a0000000-0000-0000-0000-0000000000a4') $$,
  '23503',
  'insert or update on table "bonus_ledger" violates foreign key constraint "bonus_ledger_pool_org_fk"',
  'cross-org ledger vs pool rejected by composite FK (SI-7)');
select throws_ok(
  $$ insert into public.bonus_ledger (organization_id, bonus_pool_id, employee_id, transaction_id, entry_type, account, event_type, amount_minor, created_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000031','b0000000-0000-0000-0000-0000000000b2','a0000000-0000-0000-0000-000000000069','credit','accrual','reversal',100,'a0000000-0000-0000-0000-0000000000a4') $$,
  '23503',
  'insert or update on table "bonus_ledger" violates foreign key constraint "bonus_ledger_employee_org_fk"',
  'cross-org employee ledger rejected by composite FK (SI-7)');

-- (#11) Seed transaction balanced (Σdebit=Σcredit) + BL-2 (Σaccrual ≤ pool).
select is(
  (select coalesce(sum(amount_minor) filter (where entry_type='debit'),0) from public.bonus_ledger
     where transaction_id='a0000000-0000-0000-0000-000000000050'),
  (select coalesce(sum(amount_minor) filter (where entry_type='credit'),0) from public.bonus_ledger
     where transaction_id='a0000000-0000-0000-0000-000000000050'),
  'seed accrual transaction is balanced (Σdebit=Σcredit — ADR-017)');
select ok(
  (select coalesce(sum(amount_minor) filter (where account='accrual' and entry_type='credit'),0)
     from public.bonus_ledger where transaction_id='a0000000-0000-0000-0000-000000000050')
  <= (select amount_minor from public.bonus_pools where id='a0000000-0000-0000-0000-000000000031'),
  'Σ(accrual credits) ≤ pool amount (BL-2, seed/test-verified)');

-- (#12) Audit (BL-4): seed accrual insert produced an audit row.
select ok(exists (select 1 from public.audit_logs
                    where target_id='a0000000-0000-0000-0000-000000000052' and action='bonus_ledger.insert'),
  'ledger insert produced an audit row (BL-4)');

-- =============================================================================
-- SECTION B — RLS as authenticated users
-- =============================================================================
set local role authenticated;

-- ---- raw read: Finance + Auditor ONLY (HR/employee/manager excluded — SI-12) --------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is((select count(*) from public.bonus_ledger where id='a0000000-0000-0000-0000-000000000052'),
  1::bigint, 'Finance can read bonus_ledger');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select is((select count(*) from public.bonus_ledger where id='a0000000-0000-0000-0000-000000000052'),
  1::bigint, 'Auditor can read bonus_ledger');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.bonus_ledger where id='a0000000-0000-0000-0000-000000000052'),
  0::bigint, 'HR cannot read raw bonus_ledger (excluded — decision 1/SI-12)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.bonus_ledger where id='a0000000-0000-0000-0000-000000000052'),
  0::bigint, 'employee cannot read raw bonus_ledger');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select is((select count(*) from public.bonus_ledger where id='a0000000-0000-0000-0000-000000000052'),
  0::bigint, 'manager cannot read bonus_ledger');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is((select count(*) from public.bonus_ledger where id='b0000000-0000-0000-0000-000000000052'),
  0::bigint, 'cross-tenant: Finance A cannot read org B bonus_ledger (SI-7)');
-- support (active grant) is NOT a raw-read path on the money ledger (decision 1).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000aa"}', true);
select is((select count(*) from public.bonus_ledger where id='a0000000-0000-0000-0000-000000000052'),
  0::bigint, 'support (active grant) cannot read raw bonus_ledger (Finance/Auditor only — decision 1)');

-- ---- server-only writes: no authenticated INSERT (no privilege) ---------------------
select throws_ok(
  $$ insert into public.bonus_ledger (organization_id, bonus_pool_id, transaction_id, entry_type, account, event_type, amount_minor, created_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000031','a0000000-0000-0000-0000-00000000006a','debit','accrual','reversal',100,'a0000000-0000-0000-0000-0000000000a4') $$,
  '42501', 'permission denied for table bonus_ledger',
  'authenticated cannot INSERT into bonus_ledger (server-only)');

reset role;
select * from finish();
rollback;
