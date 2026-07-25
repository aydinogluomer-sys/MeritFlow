-- =============================================================================
-- pgTAP — Phase 3 blocking suite: bonus_pool_components + bonus_pool_eligibility
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 14/15 (bonus_* §), 16 (SI-4/SI-6/SI-7), ADR-002/006/018, D1/D10/AD9/AD10.
--
-- Section A = privileged (bypassrls); Section B = RLS as authenticated. Components:
-- MVP individual=1.0 only (D1); write pool.create. Eligibility: server-only writes;
-- read HR/Finance/Auditor + employee-own; same-org employee (memberships FK) + same-org
-- primary team (teams FK) + is_primary (AD9 trigger); both immutable once parent pool
-- leaves draft (SI-4/AD10).
--
-- Seed fixtures: pool fb (org A) has component `ca` + eligibility `da`(a7,f1)/`db`(a8,f2);
-- org B pool fb has its own component/eligibility (b2).
-- =============================================================================
begin;
select no_plan();

-- =============================================================================
-- SECTION A — privileged (bypassrls)
-- =============================================================================

-- (#1) Tables exist.
select has_table('public', 'bonus_pool_components',  'bonus_pool_components table exists');
select has_table('public', 'bonus_pool_eligibility', 'bonus_pool_eligibility table exists');

-- (#2) RLS ENABLED + FORCE.
select is(
  (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
    where oid in ('public.bonus_pool_components'::regclass, 'public.bonus_pool_eligibility'::regclass)),
  true, 'RLS ENABLED + FORCE on both (SI-6)');

-- (#3) Privileges: components INSERT/UPDATE, no DELETE; eligibility SELECT-only.
select is(has_table_privilege('authenticated', 'public.bonus_pool_components', 'INSERT'), true,  'components INSERT');
select is(has_table_privilege('authenticated', 'public.bonus_pool_components', 'DELETE'), false, 'components no DELETE');
select is(has_table_privilege('authenticated', 'public.bonus_pool_eligibility', 'SELECT'), true,  'eligibility SELECT');
select is(has_table_privilege('authenticated', 'public.bonus_pool_eligibility', 'INSERT'), false, 'eligibility no INSERT (server-only)');
select is(has_table_privilege('authenticated', 'public.bonus_pool_eligibility', 'UPDATE'), false, 'eligibility no UPDATE (server-only)');
select is(has_table_privilege('authenticated', 'public.bonus_pool_eligibility', 'DELETE'), false, 'eligibility no DELETE');

-- Fresh throwaway periods/pools (no component/eligibility) for isolation.
insert into public.bonus_periods (id, organization_id, starts_on, ends_on, created_by) values
  ('a0000000-0000-0000-0000-0000000000e4','a0000000-0000-0000-0000-000000000001',date '2026-07-01',date '2026-07-31','a0000000-0000-0000-0000-0000000000a3'),
  ('a0000000-0000-0000-0000-0000000000e6','a0000000-0000-0000-0000-000000000001',date '2026-08-01',date '2026-08-31','a0000000-0000-0000-0000-0000000000a3');
insert into public.bonus_pools (id, organization_id, bonus_period_id, amount_minor, created_by) values
  ('a0000000-0000-0000-0000-0000000000e5','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000e4',1000000,'a0000000-0000-0000-0000-0000000000a4'),
  ('a0000000-0000-0000-0000-0000000000e7','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000e6',1000000,'a0000000-0000-0000-0000-0000000000a4');

-- (#4) Component constraint negatives.
select throws_ok(
  $$ insert into public.bonus_pool_components (organization_id, bonus_pool_id, component, weight, created_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000e5','team',1.0,'a0000000-0000-0000-0000-0000000000a4') $$,
  '23514',
  'new row for relation "bonus_pool_components" violates check constraint "bonus_pool_components_mvp_chk"',
  'non-individual component rejected (MVP Safe Pro-Rata — D1)');
select throws_ok(
  $$ insert into public.bonus_pool_components (organization_id, bonus_pool_id, component, weight, created_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000e5','individual',0.5,'a0000000-0000-0000-0000-0000000000a4') $$,
  '23514',
  'new row for relation "bonus_pool_components" violates check constraint "bonus_pool_components_mvp_chk"',
  'individual weight != 1.0 rejected (MVP — D1)');
select throws_ok(
  $$ insert into public.bonus_pool_components (organization_id, bonus_pool_id, component, weight, created_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000fb','individual',1.0,'a0000000-0000-0000-0000-0000000000a4') $$,
  '23505',
  'duplicate key value violates unique constraint "bonus_pool_components_unique"',
  'duplicate component per pool rejected');
select throws_ok(
  $$ insert into public.bonus_pool_components (organization_id, bonus_pool_id, component, weight, created_by)
     values ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-0000000000e5','individual',1.0,'b0000000-0000-0000-0000-0000000000b1') $$,
  '23503',
  'insert or update on table "bonus_pool_components" violates foreign key constraint "bonus_pool_components_pool_org_fk"',
  'cross-org component vs pool rejected by composite FK (SI-7)');

-- (#5) Eligibility constraint negatives.
select throws_ok(
  $$ insert into public.bonus_pool_eligibility (organization_id, bonus_pool_id, employee_id, eligible, days_active, eligibility_factor)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000e5','a0000000-0000-0000-0000-0000000000a7',true,20,2) $$,
  '23514', NULL, 'eligibility_factor must be 0 or 1');
select throws_ok(
  $$ insert into public.bonus_pool_eligibility (organization_id, bonus_pool_id, employee_id, eligible, days_active, eligibility_factor)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000e5','a0000000-0000-0000-0000-0000000000a7',true,20,0) $$,
  '23514',
  'new row for relation "bonus_pool_eligibility" violates check constraint "bonus_pool_eligibility_factor_mirror_chk"',
  'eligibility_factor must mirror eligible');
select throws_ok(
  $$ insert into public.bonus_pool_eligibility (organization_id, bonus_pool_id, employee_id, eligible, days_active, eligibility_factor)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000e5','a0000000-0000-0000-0000-0000000000a7',true,10,1) $$,
  '23514',
  'new row for relation "bonus_pool_eligibility" violates check constraint "bonus_pool_eligibility_15day_chk"',
  'eligible requires >= 15 active days (D10)');
select throws_ok(
  $$ insert into public.bonus_pool_eligibility (organization_id, bonus_pool_id, employee_id, eligible, days_active, eligibility_factor, proration_factor)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000e5','a0000000-0000-0000-0000-0000000000a7',true,20,1,1.5) $$,
  '23514',
  'new row for relation "bonus_pool_eligibility" violates check constraint "bonus_pool_eligibility_proration_chk"',
  'proration_factor out of [0,1] rejected');
-- AD9: wrong primary_team (a7 primary is f1, not f2) rejected by trigger.
select throws_ok(
  $$ insert into public.bonus_pool_eligibility (organization_id, bonus_pool_id, employee_id, eligible, days_active, eligibility_factor, primary_team_id)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000e5','a0000000-0000-0000-0000-0000000000a7',true,20,1,'a0000000-0000-0000-0000-0000000000f2') $$,
  '23514',
  'primary_team_id must be the employee primary team (team_memberships.is_primary; AD9)',
  'non-primary team_id rejected (AD9)');
select throws_ok(
  $$ insert into public.bonus_pool_eligibility (organization_id, bonus_pool_id, employee_id, eligible, days_active, eligibility_factor)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000fb','a0000000-0000-0000-0000-0000000000a7',true,20,1) $$,
  '23505',
  'duplicate key value violates unique constraint "bonus_pool_eligibility_unique"',
  'duplicate eligibility per (pool, employee) rejected');
-- Cross-org pool: org B row on org A pool e5 rejected by pool composite FK.
select throws_ok(
  $$ insert into public.bonus_pool_eligibility (organization_id, bonus_pool_id, employee_id, eligible, days_active, eligibility_factor)
     values ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-0000000000e5','b0000000-0000-0000-0000-0000000000b2',true,20,1) $$,
  '23503',
  'insert or update on table "bonus_pool_eligibility" violates foreign key constraint "bonus_pool_eligibility_pool_org_fk"',
  'cross-org eligibility vs pool rejected by composite FK (SI-7)');
-- Cross-org EMPLOYEE: Org A eligibility with Org B employee (b2 not a member of Org A) rejected.
select throws_ok(
  $$ insert into public.bonus_pool_eligibility (organization_id, bonus_pool_id, employee_id, eligible, days_active, eligibility_factor)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000fb','b0000000-0000-0000-0000-0000000000b2',true,20,1) $$,
  '23503',
  'insert or update on table "bonus_pool_eligibility" violates foreign key constraint "bonus_pool_eligibility_employee_org_fk"',
  'cross-org employee eligibility rejected: employee must be a member of the eligibility org (SI-7)');

-- (#6) Same-org employee eligibility succeeds (a7 in org A, primary team f1) on throwaway e5.
select lives_ok(
  $$ insert into public.bonus_pool_eligibility (id, organization_id, bonus_pool_id, employee_id, eligible, days_active, eligibility_factor, primary_team_id)
     values ('a0000000-0000-0000-0000-0000000000de','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000e5','a0000000-0000-0000-0000-0000000000a7',true,20,1,'a0000000-0000-0000-0000-0000000000f1') $$,
  'same-org employee eligibility (a7, org A, primary team f1) succeeds');

-- (#7) Locked-parent immutability of components + eligibility (SI-4/AD10).
insert into public.bonus_periods (id, organization_id, starts_on, ends_on, created_by)
  values ('a0000000-0000-0000-0000-0000000000e8','a0000000-0000-0000-0000-000000000001',date '2026-09-01',date '2026-09-30','a0000000-0000-0000-0000-0000000000a3');
insert into public.bonus_pools (id, organization_id, bonus_period_id, amount_minor, created_by)
  values ('a0000000-0000-0000-0000-0000000000e9','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000e8',2000000,'a0000000-0000-0000-0000-0000000000a4');
insert into public.bonus_pool_components (id, organization_id, bonus_pool_id, component, weight, created_by)
  values ('a0000000-0000-0000-0000-0000000000cc','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000e9','individual',1.0,'a0000000-0000-0000-0000-0000000000a4');
insert into public.bonus_pool_eligibility (id, organization_id, bonus_pool_id, employee_id, eligible, days_active, eligibility_factor, primary_team_id)
  values ('a0000000-0000-0000-0000-0000000000dc','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000e9','a0000000-0000-0000-0000-0000000000a7',true,20,1,'a0000000-0000-0000-0000-0000000000f1');
-- draft-editable: while parent pool is draft, component may be updated.
select lives_ok(
  $$ update public.bonus_pool_components set weight = 1.0 where id = 'a0000000-0000-0000-0000-0000000000cc' $$,
  'component can be updated while parent pool is draft');
-- lock the pool.
select lives_ok(
  $$ update public.bonus_pools set status='locked', t_org=1, locked_at=now(), locked_by='a0000000-0000-0000-0000-0000000000a4'
     where id = 'a0000000-0000-0000-0000-0000000000e9' $$,
  'parent pool e9 locked (setup)');
-- component UPDATE rejected once parent pool is locked.
select throws_ok(
  $$ update public.bonus_pool_components set weight = 1.0 where id = 'a0000000-0000-0000-0000-0000000000cc' $$,
  '23001',
  'bonus_pool_components is immutable while its bonus_pool is not draft (locked/superseded — new pool version required; SI-4/AD10)',
  'component immutable once parent pool locked (SI-4/AD10)');
-- eligibility UPDATE rejected once parent pool is locked.
select throws_ok(
  $$ update public.bonus_pool_eligibility set days_active = 25 where id = 'a0000000-0000-0000-0000-0000000000dc' $$,
  '23001',
  'bonus_pool_eligibility is immutable while its bonus_pool is not draft (locked/superseded — new pool version required; SI-4/AD10)',
  'eligibility immutable once parent pool locked (SI-4/AD10)');

-- (#8) DELETE blocked on both (retention).
select throws_ok(
  $$ delete from public.bonus_pool_components where id = 'a0000000-0000-0000-0000-0000000000ca' $$,
  '23001',
  'delete forbidden: bonus_pool_components is retained (supersede only; deletion is a legal-review item)',
  'DELETE on bonus_pool_components blocked');
select throws_ok(
  $$ delete from public.bonus_pool_eligibility where id = 'a0000000-0000-0000-0000-0000000000da' $$,
  '23001',
  'delete forbidden: bonus_pool_eligibility is retained (supersede only; deletion is a legal-review item)',
  'DELETE on bonus_pool_eligibility blocked');

-- (#9) Audit rows from seed inserts.
select ok(exists (select 1 from public.audit_logs where target_id = 'a0000000-0000-0000-0000-0000000000ca' and action = 'bonus_pool_components.insert'),
  'component insert produced an audit row');
select ok(exists (select 1 from public.audit_logs where target_id = 'a0000000-0000-0000-0000-0000000000da' and action = 'bonus_pool_eligibility.insert'),
  'eligibility insert produced an audit row');

-- =============================================================================
-- SECTION B — RLS as authenticated users
-- =============================================================================
set local role authenticated;

-- ---- components: read HR/Finance/Auditor; Employee excluded; cross-tenant blocked
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.bonus_pool_components where id = 'a0000000-0000-0000-0000-0000000000ca'),
  1::bigint, 'HR can read bonus_pool_components');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is((select count(*) from public.bonus_pool_components where id = 'a0000000-0000-0000-0000-0000000000ca'),
  1::bigint, 'Finance can read bonus_pool_components');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.bonus_pool_components where id = 'a0000000-0000-0000-0000-0000000000ca'),
  0::bigint, 'employee cannot read bonus_pool_components');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.bonus_pool_components where id = 'b0000000-0000-0000-0000-0000000000ca'),
  0::bigint, 'cross-tenant: HR A cannot read org B component (SI-7)');

-- ---- components: write pool.create (Finance) only ----------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select lives_ok(
  $$ insert into public.bonus_pool_components (organization_id, bonus_pool_id, component, weight, created_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000e5','individual',1.0,'a0000000-0000-0000-0000-0000000000a4') $$,
  'Finance (pool.create) can INSERT a component');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select throws_ok(
  $$ insert into public.bonus_pool_components (organization_id, bonus_pool_id, component, weight, created_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000e7','individual',1.0,'a0000000-0000-0000-0000-0000000000a3') $$,
  '42501',
  'new row violates row-level security policy for table "bonus_pool_components"',
  'HR cannot INSERT a component (no pool.create)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select throws_ok(
  $$ insert into public.bonus_pool_components (organization_id, bonus_pool_id, component, weight, created_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000e7','individual',1.0,'a0000000-0000-0000-0000-0000000000a7') $$,
  '42501',
  'new row violates row-level security policy for table "bonus_pool_components"',
  'employee cannot INSERT a component');

-- ---- eligibility: read HR/Finance/Auditor + employee-own; not others ----------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.bonus_pool_eligibility
             where id in ('a0000000-0000-0000-0000-0000000000da','a0000000-0000-0000-0000-0000000000db')),
  2::bigint, 'HR can read org eligibility rows');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select is((select count(*) from public.bonus_pool_eligibility
             where id in ('a0000000-0000-0000-0000-0000000000da','a0000000-0000-0000-0000-0000000000db')),
  2::bigint, 'Auditor can read org eligibility rows');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.bonus_pool_eligibility where id = 'a0000000-0000-0000-0000-0000000000da'),
  1::bigint, 'employee can read OWN eligibility');
select is((select count(*) from public.bonus_pool_eligibility where id = 'a0000000-0000-0000-0000-0000000000db'),
  0::bigint, 'employee cannot read another employee eligibility');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select is((select count(*) from public.bonus_pool_eligibility where id = 'a0000000-0000-0000-0000-0000000000da'),
  0::bigint, 'manager cannot read others eligibility');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.bonus_pool_eligibility where id = 'b0000000-0000-0000-0000-0000000000da'),
  0::bigint, 'cross-tenant: HR A cannot read org B eligibility (SI-7)');

-- ---- eligibility: server-only writes (no authenticated INSERT) ---------------
select throws_ok(
  $$ insert into public.bonus_pool_eligibility (organization_id, bonus_pool_id, employee_id, eligible, days_active, eligibility_factor)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000e5','a0000000-0000-0000-0000-0000000000a8',true,20,1) $$,
  '42501',
  'permission denied for table bonus_pool_eligibility',
  'authenticated cannot INSERT eligibility (server-only; no privilege)');

reset role;
select * from finish();
rollback;
