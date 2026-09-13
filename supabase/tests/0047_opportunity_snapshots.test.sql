-- =============================================================================
-- pgTAP — Phase P3 / slice 2-A: opportunity_snapshots (Opportunity-to-Perform snapshot store).
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: migration 0048; §4.4/§4.5; §26 (Opportunity gate). Proves: RLS ENABLE+FORCE + least-priv
--   grants; three-tier read — employee-own + MANAGER of the employee's PRIMARY team (team_of +
--   manages_team, NO cross-team leakage) + HR/owner/admin/auditor org; cross-tenant isolation
--   (org A vs org B) — BLOCKING; finance (no role) sees nothing; server-only writes; append-only
--   IMMUTABILITY (UPDATE/DELETE blocked); INSERT audited; same-org composite FKs; unique guard;
--   permission catalog unchanged (23).
-- Fixtures (seed): os-a7 (a0..fc, emp-alpha a7, PRIMARY team f1 managed by a5) + os-a8 (a0..fd,
--   emp-beta a8, PRIMARY team f2 NOT managed by a5) + os-b2 (b0..fc, Org B). Period a0..fa / b0..fa.
--   Actors: a1 owner, a2 admin, a3 hr, a4 finance, a5 manager(f1), a7 emp-alpha, a8 emp-beta,
--   a9 auditor; b1 Org B owner.
-- =============================================================================
begin;
select no_plan();

-- ---- table + RLS shape -------------------------------------------------------
select has_table('public', 'opportunity_snapshots', 'opportunity_snapshots table exists');
select ok(
  (select relrowsecurity from pg_class where relname = 'opportunity_snapshots' and relnamespace = 'public'::regnamespace),
  'RLS ENABLED on opportunity_snapshots');
select ok(
  (select relforcerowsecurity from pg_class where relname = 'opportunity_snapshots' and relnamespace = 'public'::regnamespace),
  'RLS FORCED on opportunity_snapshots');

-- ---- least-privilege grants (server-only writes) -----------------------------
select ok(has_table_privilege('authenticated', 'public.opportunity_snapshots', 'SELECT'),
  'authenticated may SELECT');
select ok(not has_table_privilege('authenticated', 'public.opportunity_snapshots', 'INSERT'),
  'authenticated may NOT INSERT (server-only writes)');
select ok(not has_table_privilege('authenticated', 'public.opportunity_snapshots', 'UPDATE'),
  'authenticated may NOT UPDATE (immutable)');
select ok(not has_table_privilege('authenticated', 'public.opportunity_snapshots', 'DELETE'),
  'authenticated may NOT DELETE (immutable)');

-- ---- permission catalog unchanged (23; 2-A uses role-based RLS, adds no permission) ---------------
select is((select count(*) from public.permissions), 23::bigint,
  'permission catalog unchanged at 23 (2-A adds no permission)');

-- =============================================================================
-- RLS reads (switch to authenticated). Three-tier: employee-own + manager-of-primary-team + HR/org.
-- =============================================================================
set local role authenticated;

-- Employee alpha a7 sees only their OWN snapshot (os-a7), not emp-beta's (os-a8).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.opportunity_snapshots
           where id = 'a0000000-0000-0000-0000-0000000000fc'), 1::bigint,
  'RLS: employee reads own opportunity snapshot');
select is((select count(*) from public.opportunity_snapshots
           where id = 'a0000000-0000-0000-0000-0000000000fd'), 0::bigint,
  'RLS: employee cannot read another employee''s snapshot');

-- Manager alpha a5 manages team f1 (emp-alpha a7's PRIMARY team) → sees os-a7; NOT os-a8 (team f2).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select is((select count(*) from public.opportunity_snapshots
           where id = 'a0000000-0000-0000-0000-0000000000fc'), 1::bigint,
  'RLS: manager reads a managed primary-team member snapshot (team f1)');
select is((select count(*) from public.opportunity_snapshots
           where id = 'a0000000-0000-0000-0000-0000000000fd'), 0::bigint,
  'RLS: manager cannot read a snapshot outside the managed team (NO cross-team leakage)');

-- HR a3 / owner a1 / admin a2 / auditor a9 see BOTH Org A snapshots.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.opportunity_snapshots
           where id in ('a0000000-0000-0000-0000-0000000000fc','a0000000-0000-0000-0000-0000000000fd')),
          2::bigint, 'RLS: HR reads org opportunity snapshots');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1"}', true);
select is((select count(*) from public.opportunity_snapshots
           where id in ('a0000000-0000-0000-0000-0000000000fc','a0000000-0000-0000-0000-0000000000fd')),
          2::bigint, 'RLS: owner reads org opportunity snapshots');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select is((select count(*) from public.opportunity_snapshots
           where id in ('a0000000-0000-0000-0000-0000000000fc','a0000000-0000-0000-0000-0000000000fd')),
          2::bigint, 'RLS: auditor reads org opportunity snapshots');

-- Finance a4 (no role in the policy, not the employee, manages no team) sees NONE.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is((select count(*) from public.opportunity_snapshots), 0::bigint,
  'RLS: finance sees no opportunity snapshots');

-- Cross-tenant isolation (both directions).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1"}', true);
select is((select count(*) from public.opportunity_snapshots
           where organization_id = 'b0000000-0000-0000-0000-000000000002'::uuid), 0::bigint,
  'RLS: Org A owner cannot see Org B snapshots (cross-tenant isolation)');
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-0000000000b1"}', true);
select is((select count(*) from public.opportunity_snapshots
           where organization_id = 'a0000000-0000-0000-0000-000000000001'::uuid), 0::bigint,
  'RLS: Org B owner cannot see Org A snapshots (cross-tenant isolation)');
select ok((select count(*) from public.opportunity_snapshots) >= 1,
  'RLS: Org B owner sees the Org B snapshot');

reset role;

-- =============================================================================
-- Immutability + audit + same-org FKs + unique (bypassrls; triggers/constraints apply universally).
-- =============================================================================
select throws_ok($$
  update public.opportunity_snapshots set opportunity_index = 1
  where id = 'a0000000-0000-0000-0000-0000000000fc' $$,
  NULL, 'opportunity_snapshots UPDATE is blocked (immutable)');

select throws_ok($$
  delete from public.opportunity_snapshots where id = 'a0000000-0000-0000-0000-0000000000fc' $$,
  NULL, 'opportunity_snapshots DELETE is blocked (immutable)');

select ok(
  exists (select 1 from public.audit_logs al
          where al.target_id = 'a0000000-0000-0000-0000-0000000000fc'
            and al.action = 'opportunity_snapshots.insert'),
  'the snapshot INSERT is written to audit_logs (opportunity_snapshots.insert)');

-- Reproducibility guard: one snapshot per (employee, period, rule_set_version).
select throws_ok($$
  insert into public.opportunity_snapshots
    (organization_id, employee_id, bonus_period_id, rule_set_version, eligible_work_count,
     assigned_work_count, completed_work_count, complexity_weighted_available,
     complexity_weighted_assigned, active_days, opportunity_index, components)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a7',
          'a0000000-0000-0000-0000-0000000000fa', 'opportunity-v1', 1, 1, 1, 1, 1, 1, 50,
          '{"items":[]}'::jsonb) $$,
  '23505', NULL, 'unique (employee_id, bonus_period_id, rule_set_version) — no silent overwrite');

-- Same-org FK: an Org A snapshot cannot reference an Org B period -> 23503.
select throws_ok($$
  insert into public.opportunity_snapshots
    (organization_id, employee_id, bonus_period_id, rule_set_version, eligible_work_count,
     assigned_work_count, completed_work_count, complexity_weighted_available,
     complexity_weighted_assigned, active_days, opportunity_index, components)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a7',
          'b0000000-0000-0000-0000-0000000000fa', 'opportunity-v2', 1, 1, 1, 1, 1, 1, 50,
          '{"items":[]}'::jsonb) $$,
  '23503', NULL, 'same-org FK: Org A snapshot cannot reference an Org B bonus_period');

-- Same-org FK: employee must be a member of the org -> 23503 (Org B member in an Org A row).
select throws_ok($$
  insert into public.opportunity_snapshots
    (organization_id, employee_id, bonus_period_id, rule_set_version, eligible_work_count,
     assigned_work_count, completed_work_count, complexity_weighted_available,
     complexity_weighted_assigned, active_days, opportunity_index, components)
  values ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000b2',
          'a0000000-0000-0000-0000-0000000000fa', 'opportunity-v3', 1, 1, 1, 1, 1, 1, 50,
          '{"items":[]}'::jsonb) $$,
  '23503', NULL, 'same-org FK: employee_id must be a member of the organization');

select * from finish();
rollback;
