-- =============================================================================
-- pgTAP — Phase 3 blocking suite: bonus_periods + bonus_pools foundation
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 14/15 (bonus_periods/pools §), 16 (§3 period machine, SI-4/SI-6/SI-7),
--       ADR-006/017/018, Decision Lock D11/AD8/AD10. Strict 4-arg throws_ok.
--
-- Conventions match 0001..0004: whole file in a rolled-back transaction; seed
-- assumed present. Section A = privileged (bypassrls); Section B = RLS as
-- authenticated via request.jwt.claims.sub.
--
-- Locking rules proven here:
--   * a pool may be 'locked' ONLY with t_org + locked_at + locked_by (AD10/SI-4);
--     locked t_org/amount are then immutable (new version required).
--   * a period may be 'locked' ONLY with locked_at + locked_by, and only after its
--     pool is locked (AD10); a non-open period's identity (dates/type/org) is immutable (SI-4).
--
-- Seed fixtures: fa/fb = org A OPEN period + DRAFT pool ; org B fa/fb (cross-tenant).
-- period.manage → owner+hr ; pool.create → finance.
-- =============================================================================
begin;
select no_plan();

-- =============================================================================
-- SECTION A — privileged (bypassrls)
-- =============================================================================

-- (#1) Tables exist.
select has_table('public', 'bonus_periods', 'bonus_periods table exists');
select has_table('public', 'bonus_pools',   'bonus_pools table exists');

-- (#2) RLS ENABLED + FORCE.
select is(
  (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
    where oid in ('public.bonus_periods'::regclass, 'public.bonus_pools'::regclass)),
  true, 'RLS ENABLED + FORCE on bonus_periods and bonus_pools (SI-6)');

-- (#3) Privileges: INSERT/UPDATE yes; DELETE no.
select is(has_table_privilege('authenticated', 'public.bonus_periods', 'DELETE'), false, 'no DELETE on bonus_periods');
select is(has_table_privilege('authenticated', 'public.bonus_pools',   'DELETE'), false, 'no DELETE on bonus_pools');
select is(has_table_privilege('authenticated', 'public.bonus_periods', 'INSERT'), true,  'INSERT on bonus_periods');
select is(has_table_privilege('authenticated', 'public.bonus_pools',   'UPDATE'), true,  'UPDATE on bonus_pools');

-- (#4) Permission grants.
select is((select count(*) from public.role_permissions
             where permission_key = 'period.manage' and role_key in ('owner','hr')),
  2::bigint, 'period.manage granted to owner + hr');
select is((select count(*) from public.role_permissions
             where permission_key = 'period.manage'
               and role_key in ('admin','finance','manager','employee','auditor')),
  0::bigint, 'period.manage NOT granted to admin/finance/manager/employee/auditor');
select is((select count(*) from public.role_permissions
             where permission_key = 'pool.create' and role_key = 'finance'),
  1::bigint, 'pool.create granted to finance');
select is((select count(*) from public.role_permissions
             where permission_key = 'pool.create'
               and role_key in ('owner','admin','hr','manager','employee','auditor')),
  0::bigint, 'pool.create NOT granted to owner/admin/hr/manager/employee/auditor');

-- (#5) Period constraint negatives.
select throws_ok(
  $$ insert into public.bonus_periods (organization_id, starts_on, ends_on, created_by)
     values ('a0000000-0000-0000-0000-000000000001', date '2026-06-30', date '2026-06-01',
             'a0000000-0000-0000-0000-0000000000a3') $$,
  '23514',
  'new row for relation "bonus_periods" violates check constraint "bonus_periods_range_chk"',
  'ends_on <= starts_on rejected');
select throws_ok(
  $$ insert into public.bonus_periods (organization_id, starts_on, ends_on, created_by)
     values ('a0000000-0000-0000-0000-000000000001', date '2026-06-01', date '2026-06-30',
             'a0000000-0000-0000-0000-0000000000a3') $$,
  '23505',
  'duplicate key value violates unique constraint "bonus_periods_unique_range"',
  'duplicate (org, starts_on, ends_on) period rejected');
select throws_ok(
  $$ insert into public.bonus_periods (organization_id, starts_on, ends_on, status, created_by)
     values ('a0000000-0000-0000-0000-000000000001', date '2026-10-01', date '2026-10-31', 'locked',
             'a0000000-0000-0000-0000-0000000000a3') $$,
  '23514',
  'bonus_period must start in status open (got locked)',
  'period must start open (state machine INSERT guard)');
select throws_ok(
  $$ insert into public.bonus_periods (organization_id, period_type, starts_on, ends_on, created_by)
     values ('a0000000-0000-0000-0000-000000000001', 'weekly', date '2026-11-01', date '2026-11-30',
             'a0000000-0000-0000-0000-0000000000a3') $$,
  '23514',
  'new row for relation "bonus_periods" violates check constraint "bonus_periods_type_chk"',
  'non-monthly period_type rejected (D11)');

-- Throwaway period fc (no pool yet) for pool negatives.
insert into public.bonus_periods (id, organization_id, starts_on, ends_on, created_by)
  values ('a0000000-0000-0000-0000-0000000000fc', 'a0000000-0000-0000-0000-000000000001',
          date '2026-07-01', date '2026-07-31', 'a0000000-0000-0000-0000-0000000000a3');

-- (#6) Pool constraint negatives.
select throws_ok(
  $$ insert into public.bonus_pools (organization_id, bonus_period_id, amount_minor, created_by)
     values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000fc', -1,
             'a0000000-0000-0000-0000-0000000000a4') $$,
  '23514',
  'new row for relation "bonus_pools" violates check constraint "bonus_pools_amount_pos_chk"',
  'negative pool amount rejected');
select throws_ok(
  $$ insert into public.bonus_pools (organization_id, bonus_period_id, amount_minor, t_org, created_by)
     values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000fc', 100, 0.9,
             'a0000000-0000-0000-0000-0000000000a4') $$,
  '23514',
  'new row for relation "bonus_pools" violates check constraint "bonus_pools_torg_chk"',
  'invalid t_org rejected (not in {0,0.5,0.75,1,1.2})');
select throws_ok(
  $$ insert into public.bonus_pools (organization_id, bonus_period_id, amount_minor, status, created_by)
     values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000fc', 100, 'foo',
             'a0000000-0000-0000-0000-0000000000a4') $$,
  '23514',
  'new row for relation "bonus_pools" violates check constraint "bonus_pools_status_chk"',
  'invalid pool status rejected');
select throws_ok(
  $$ insert into public.bonus_pools (organization_id, bonus_period_id, amount_minor, created_by)
     values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000fa', 100,
             'a0000000-0000-0000-0000-0000000000a4') $$,
  '23505',
  'duplicate key value violates unique constraint "uq_bonus_pool_active_per_period"',
  'second active pool per period rejected');
-- Cross-org composite FK (org B pool pointing at org A period fc — no active pool yet).
select throws_ok(
  $$ insert into public.bonus_pools (organization_id, bonus_period_id, amount_minor, created_by)
     values ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000fc', 100,
             'b0000000-0000-0000-0000-0000000000b1') $$,
  '23503',
  'insert or update on table "bonus_pools" violates foreign key constraint "bonus_pools_period_org_fk"',
  'cross-org pool vs period rejected by composite FK (SI-7)');

-- (#7) DELETE blocked on both (retention).
select throws_ok(
  $$ delete from public.bonus_periods where id = 'a0000000-0000-0000-0000-0000000000fa' $$,
  '23001',
  'delete forbidden: bonus_periods is retained (supersede only; deletion is a legal-review item)',
  'DELETE on bonus_periods blocked (retention)');
select throws_ok(
  $$ delete from public.bonus_pools where id = 'a0000000-0000-0000-0000-0000000000fb' $$,
  '23001',
  'delete forbidden: bonus_pools is retained (supersede only; deletion is a legal-review item)',
  'DELETE on bonus_pools blocked (retention)');

-- (#8) State machine: forbidden skip + AD10 lock guard (fa stays open).
select throws_ok(
  $$ update public.bonus_periods set status = 'calculated'
     where id = 'a0000000-0000-0000-0000-0000000000fa' $$,
  '23514',
  'invalid bonus_period transition: open -> calculated',
  'skip transition open -> calculated rejected');
select throws_ok(
  $$ update public.bonus_periods set status = 'locked'
     where id = 'a0000000-0000-0000-0000-0000000000fa' $$,
  '23514',
  'bonus_period cannot be locked before its bonus_pool is locked (AD10)',
  'period lock rejected while pool is not locked (AD10)');

-- ---- Pool locking rules (fd draft on fc) ------------------------------------
insert into public.bonus_pools (id, organization_id, bonus_period_id, amount_minor, created_by)
  values ('a0000000-0000-0000-0000-0000000000fd', 'a0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-0000000000fc', 8000000, 'a0000000-0000-0000-0000-0000000000a4');

-- (#9a) Lock with t_org NULL rejected (calculations require a locked T_org — AD10).
select throws_ok(
  $$ update public.bonus_pools
       set status = 'locked', locked_at = now(), locked_by = 'a0000000-0000-0000-0000-0000000000a4'
     where id = 'a0000000-0000-0000-0000-0000000000fd' $$,
  '23514',
  'new row for relation "bonus_pools" violates check constraint "bonus_pools_lock_requires_fields_chk"',
  'pool cannot be locked with t_org NULL (AD10)');
-- (#9b) Lock without locked_by rejected.
select throws_ok(
  $$ update public.bonus_pools
       set status = 'locked', t_org = 1, locked_at = now()
     where id = 'a0000000-0000-0000-0000-0000000000fd' $$,
  '23514',
  'new row for relation "bonus_pools" violates check constraint "bonus_pools_lock_requires_fields_chk"',
  'pool cannot be locked without locked_by/locked_at (AD10)');
-- (#9c) Proper lock (t_org + locked_at + locked_by) succeeds.
select lives_ok(
  $$ update public.bonus_pools
       set status = 'locked', t_org = 1, locked_at = now(), locked_by = 'a0000000-0000-0000-0000-0000000000a4'
     where id = 'a0000000-0000-0000-0000-0000000000fd' $$,
  'pool can be locked with t_org + locked_at + locked_by');

-- (#10) Locked-pool immutability (amount + t_org frozen; only -> superseded).
select throws_ok(
  $$ update public.bonus_pools set amount_minor = 999
     where id = 'a0000000-0000-0000-0000-0000000000fd' $$,
  '23001',
  'locked bonus_pool is immutable: amount/t_org/top_up/currency require a new version (AD10)',
  'locked pool amount is immutable (AD10)');
select throws_ok(
  $$ update public.bonus_pools set t_org = 0.5
     where id = 'a0000000-0000-0000-0000-0000000000fd' $$,
  '23001',
  'locked bonus_pool is immutable: amount/t_org/top_up/currency require a new version (AD10)',
  'locked pool T_org is immutable (AD10)');
select throws_ok(
  $$ update public.bonus_pools set status = 'draft'
     where id = 'a0000000-0000-0000-0000-0000000000fd' $$,
  '23001',
  'locked bonus_pool: only transition to superseded is allowed (new version — AD10)',
  'locked pool can only go to superseded (AD10)');
select lives_ok(
  $$ update public.bonus_pools set status = 'superseded'
     where id = 'a0000000-0000-0000-0000-0000000000fd' $$,
  'locked pool can be superseded (new version path)');

-- ---- Period locking rules (fe period + ff pool) -----------------------------
insert into public.bonus_periods (id, organization_id, starts_on, ends_on, created_by)
  values ('a0000000-0000-0000-0000-0000000000fe', 'a0000000-0000-0000-0000-000000000001',
          date '2026-08-01', date '2026-08-31', 'a0000000-0000-0000-0000-0000000000a3');
insert into public.bonus_pools (id, organization_id, bonus_period_id, amount_minor, created_by)
  values ('a0000000-0000-0000-0000-0000000000ff', 'a0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-0000000000fe', 6000000, 'a0000000-0000-0000-0000-0000000000a4');
-- lock the pool ff properly.
select lives_ok(
  $$ update public.bonus_pools
       set status = 'locked', t_org = 1, locked_at = now(), locked_by = 'a0000000-0000-0000-0000-0000000000a4'
     where id = 'a0000000-0000-0000-0000-0000000000ff' $$,
  'ff pool locked (setup for period lock tests)');

-- (#11) Period lock WITHOUT locked_at/locked_by rejected (even though pool is locked).
select throws_ok(
  $$ update public.bonus_periods set status = 'locked'
     where id = 'a0000000-0000-0000-0000-0000000000fe' $$,
  '23514',
  'new row for relation "bonus_periods" violates check constraint "bonus_periods_lock_fields_chk"',
  'period cannot be locked without locked_at/locked_by (SI-4)');
-- (#12) Proper period lock succeeds.
select lives_ok(
  $$ update public.bonus_periods
       set status = 'locked', locked_at = now(), locked_by = 'a0000000-0000-0000-0000-0000000000a3'
     where id = 'a0000000-0000-0000-0000-0000000000fe' $$,
  'period can be locked with locked_at + locked_by (pool already locked)');
-- (#13) After lock, identity fields (dates) are immutable (SI-4).
select throws_ok(
  $$ update public.bonus_periods set starts_on = date '2026-08-15'
     where id = 'a0000000-0000-0000-0000-0000000000fe' $$,
  '23001',
  'bonus_period identity (type/dates/org) is immutable once locked (SI-4)',
  'starts_on cannot change after period lock (SI-4)');
select throws_ok(
  $$ update public.bonus_periods set ends_on = date '2026-09-15'
     where id = 'a0000000-0000-0000-0000-0000000000fe' $$,
  '23001',
  'bonus_period identity (type/dates/org) is immutable once locked (SI-4)',
  'ends_on cannot change after period lock (SI-4)');

-- (#14) Audit: seed inserts produced audit rows.
select ok(exists (select 1 from public.audit_logs
                    where target_id = 'a0000000-0000-0000-0000-0000000000fa' and action = 'bonus_periods.insert'),
  'bonus_period insert produced an audit row');
select ok(exists (select 1 from public.audit_logs
                    where target_id = 'a0000000-0000-0000-0000-0000000000fb' and action = 'bonus_pools.insert'),
  'bonus_pool insert produced an audit row');

-- =============================================================================
-- SECTION B — RLS as authenticated users
-- =============================================================================
set local role authenticated;

-- ---- bonus_periods: org-wide read -------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.bonus_periods where id = 'a0000000-0000-0000-0000-0000000000fa'),
  1::bigint, 'employee can read org bonus_period (org-wide metadata)');
select is((select count(*) from public.bonus_periods where id = 'b0000000-0000-0000-0000-0000000000fa'),
  0::bigint, 'cross-tenant: org A employee cannot read org B bonus_period (SI-7)');

-- ---- bonus_pools: HR/Finance/Auditor read; Employee/Manager excluded --------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.bonus_pools where id = 'a0000000-0000-0000-0000-0000000000fb'),
  1::bigint, 'HR can read bonus_pool');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is((select count(*) from public.bonus_pools where id = 'a0000000-0000-0000-0000-0000000000fb'),
  1::bigint, 'Finance can read bonus_pool');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select is((select count(*) from public.bonus_pools where id = 'a0000000-0000-0000-0000-0000000000fb'),
  1::bigint, 'Auditor can read bonus_pool');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.bonus_pools where id = 'a0000000-0000-0000-0000-0000000000fb'),
  0::bigint, 'employee cannot read bonus_pool (financial)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select is((select count(*) from public.bonus_pools where id = 'a0000000-0000-0000-0000-0000000000fb'),
  0::bigint, 'manager cannot read bonus_pool');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.bonus_pools where id = 'b0000000-0000-0000-0000-0000000000fb'),
  0::bigint, 'cross-tenant: HR A cannot read org B bonus_pool (SI-7)');

-- ---- Write authz: separation of duties (period.manage vs pool.create) --------
select lives_ok(
  $$ insert into public.bonus_periods (id, organization_id, starts_on, ends_on, created_by)
     values ('a0000000-0000-0000-0000-0000000000ce', 'a0000000-0000-0000-0000-000000000001',
             date '2026-09-01', date '2026-09-30', 'a0000000-0000-0000-0000-0000000000a3') $$,
  'HR (period.manage) can INSERT a bonus_period');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select throws_ok(
  $$ insert into public.bonus_periods (organization_id, starts_on, ends_on, created_by)
     values ('a0000000-0000-0000-0000-000000000001', date '2026-12-01', date '2026-12-31',
             'a0000000-0000-0000-0000-0000000000a4') $$,
  '42501',
  'new row violates row-level security policy for table "bonus_periods"',
  'Finance cannot INSERT bonus_period (no period.manage; separation of duties)');
select lives_ok(
  $$ insert into public.bonus_pools (id, organization_id, bonus_period_id, amount_minor, created_by)
     values ('a0000000-0000-0000-0000-0000000000cf', 'a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-0000000000ce', 7000000, 'a0000000-0000-0000-0000-0000000000a4') $$,
  'Finance (pool.create) can INSERT a bonus_pool');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select throws_ok(
  $$ insert into public.bonus_pools (organization_id, bonus_period_id, amount_minor, created_by)
     values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000ce', 100,
             'a0000000-0000-0000-0000-0000000000a3') $$,
  '42501',
  'new row violates row-level security policy for table "bonus_pools"',
  'HR cannot INSERT bonus_pool (no pool.create; separation of duties)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select throws_ok(
  $$ insert into public.bonus_periods (organization_id, starts_on, ends_on, created_by)
     values ('a0000000-0000-0000-0000-000000000001', date '2027-01-01', date '2027-01-31',
             'a0000000-0000-0000-0000-0000000000a7') $$,
  '42501',
  'new row violates row-level security policy for table "bonus_periods"',
  'employee cannot INSERT bonus_period');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select throws_ok(
  $$ insert into public.bonus_periods (organization_id, starts_on, ends_on, created_by)
     values ('b0000000-0000-0000-0000-000000000002', date '2026-06-01', date '2026-06-30',
             'a0000000-0000-0000-0000-0000000000a3') $$,
  '42501',
  'new row violates row-level security policy for table "bonus_periods"',
  'cross-tenant: HR A cannot INSERT org B bonus_period (SI-7)');

-- ---- AD10 end-to-end (authenticated): lock pool (with t_org) then lock period --
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select lives_ok(
  $$ update public.bonus_pools
       set status = 'locked', t_org = 1, locked_at = now(),
           locked_by = 'a0000000-0000-0000-0000-0000000000a4'
     where id = 'a0000000-0000-0000-0000-0000000000fb' $$,
  'Finance can lock the pool (with t_org + lock metadata)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select lives_ok(
  $$ update public.bonus_periods
       set status = 'locked', locked_at = now(), locked_by = 'a0000000-0000-0000-0000-0000000000a3'
     where id = 'a0000000-0000-0000-0000-0000000000fa' $$,
  'HR can lock the period once the pool is locked (AD10 satisfied)');
select lives_ok(
  $$ update public.bonus_periods set status = 'open'
     where id = 'a0000000-0000-0000-0000-0000000000fa' $$,
  'HR can unlock the period (locked -> open)');

reset role;
select * from finish();
rollback;
