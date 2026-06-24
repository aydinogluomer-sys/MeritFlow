-- =============================================================================
-- pgTAP — Phase 3B-A blocking suite: scoring_policies + scoring_policy_versions
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 18 §6/§9, 15_RLS_POLICY_MATRIX (scoring_policies/versions), 16 (AD7/SI-4/
--       SI-6/SI-7), Decision Lock AD7. Strict 4-arg throws_ok(sql, sqlstate, errmsg, desc).
--
-- Same conventions as 0001: whole file in a rolled-back transaction; seed assumed
-- present (supabase db reset applies migrations + seed). Section A = privileged
-- (bypassrls) structural/constraint/immutability checks; Section B = RLS as
-- authenticated users via request.jwt.claims.sub (auth.uid()).
--
-- Seed fixtures (from seed_test_tenants.sql):
--   org A policy            = a0000000-...-d1   (name 'Default Scoring')
--   org A version v1 (pub)  = a0000000-...-d2
--   org A version v2 (draft)= a0000000-...-d3
--   org B policy            = b0000000-...-d1
--   org B version v1 (pub)  = b0000000-...-d2
-- Requirement #25 (Phase 3A suite still passes) is exercised by `supabase test db`
-- running 0001_phase3a_rls.test.sql alongside this file.
-- =============================================================================
begin;
select no_plan();

-- =============================================================================
-- SECTION A — privileged (bypassrls): existence, RLS flags, catalog, constraints,
--             published-version immutability.
-- =============================================================================

-- (#1/#2) Tables exist.
select has_table('public', 'scoring_policies',         'scoring_policies table exists');
select has_table('public', 'scoring_policy_versions',  'scoring_policy_versions table exists');

-- (#3) RLS ENABLED + FORCE on both.
select is(
  (select bool_and(relrowsecurity and relforcerowsecurity)
     from pg_class
    where oid in ('public.scoring_policies'::regclass,
                  'public.scoring_policy_versions'::regclass)),
  true,
  'RLS ENABLED + FORCE on scoring_policies and scoring_policy_versions (SI-6)'
);

-- (#4) policy.manage exists in the permission catalog.
select is(
  (select count(*) from public.permissions where key = 'policy.manage'),
  1::bigint, 'policy.manage permission exists'
);

-- (#5) policy.manage granted to owner/admin/hr.
select is(
  (select count(*) from public.role_permissions
     where permission_key = 'policy.manage' and role_key in ('owner', 'admin', 'hr')),
  3::bigint, 'policy.manage granted to owner/admin/hr'
);

-- (#6) policy.manage NOT granted to manager/finance/employee/auditor.
select is(
  (select count(*) from public.role_permissions
     where permission_key = 'policy.manage'
       and role_key in ('manager', 'finance', 'employee', 'auditor')),
  0::bigint, 'policy.manage NOT granted to manager/finance/employee/auditor'
);

-- (#16) Duplicate (organization_id, name) scoring policy rejected.
select throws_ok(
  $$ insert into public.scoring_policies (organization_id, name, status, created_by)
     values ('a0000000-0000-0000-0000-000000000001', 'Default Scoring', 'draft',
             'a0000000-0000-0000-0000-0000000000a3') $$,
  '23505',
  'duplicate key value violates unique constraint "scoring_policies_org_name_uq"',
  'duplicate (organization_id, name) scoring policy rejected'
);

-- (#17) Duplicate (scoring_policy_id, version_no) policy version rejected.
select throws_ok(
  $$ insert into public.scoring_policy_versions
       (organization_id, scoring_policy_id, version_no, status,
        multipliers, revision_penalty_rule, timeliness_thresholds, created_by)
     values ('a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-0000000000d1', 1, 'draft',
             '{}', '{}', '{}', 'a0000000-0000-0000-0000-0000000000a3') $$,
  '23505',
  'duplicate key value violates unique constraint "scoring_policy_versions_policy_version_uq"',
  'duplicate (scoring_policy_id, version_no) policy version rejected'
);

-- (#18) Cross-org mismatch (version org <> parent policy org) rejected by composite FK.
--       org B organization_id paired with org A's policy id -> no matching parent.
select throws_ok(
  $$ insert into public.scoring_policy_versions
       (organization_id, scoring_policy_id, version_no, status,
        multipliers, revision_penalty_rule, timeliness_thresholds, created_by)
     values ('b0000000-0000-0000-0000-000000000002',
             'a0000000-0000-0000-0000-0000000000d1', 99, 'draft',
             '{}', '{}', '{}', 'a0000000-0000-0000-0000-0000000000a3') $$,
  '23503',
  'insert or update on table "scoring_policy_versions" violates foreign key constraint "scoring_policy_versions_policy_org_fk"',
  'cross-org version vs parent policy rejected by composite FK (same-org integrity)'
);

-- (#19) Published version cannot be UPDATEd (AD7/SI-4).
select throws_ok(
  $$ update public.scoring_policy_versions set notes = 'tamper'
     where id = 'a0000000-0000-0000-0000-0000000000d2' $$,
  '23001',
  'immutable: UPDATE on published scoring_policy_versions is not permitted',
  'published scoring_policy_version cannot be UPDATEd (AD7)'
);

-- (#20) Published version cannot be DELETEd (AD7/SI-4).
select throws_ok(
  $$ delete from public.scoring_policy_versions
     where id = 'a0000000-0000-0000-0000-0000000000d2' $$,
  '23001',
  'immutable: DELETE on published scoring_policy_versions is not permitted',
  'published scoring_policy_version cannot be DELETEd (AD7)'
);

-- (#21) Draft version CAN be updated.
select lives_ok(
  $$ update public.scoring_policy_versions set notes = 'draft edit'
     where id = 'a0000000-0000-0000-0000-0000000000d3' $$,
  'draft scoring_policy_version can be updated'
);

-- (#22) Draft version CAN transition to published.
select lives_ok(
  $$ update public.scoring_policy_versions
       set status = 'published', published_at = now(),
           published_by = 'a0000000-0000-0000-0000-0000000000a3'
     where id = 'a0000000-0000-0000-0000-0000000000d3' $$,
  'draft scoring_policy_version can transition draft -> published'
);

-- =============================================================================
-- SECTION B — RLS as authenticated users
-- =============================================================================
set local role authenticated;

-- ---- Employee Alpha (org A): no policy.manage ; SELECT scoping --------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);

-- (#7) Employee cannot insert a scoring policy (RLS WITH CHECK; no policy.manage).
select throws_ok(
  $$ insert into public.scoring_policies (organization_id, name, status, created_by)
     values ('a0000000-0000-0000-0000-000000000001', 'Emp Rogue Policy', 'draft',
             'a0000000-0000-0000-0000-0000000000a7') $$,
  '42501',
  'new row violates row-level security policy for table "scoring_policies"',
  'employee cannot insert scoring policy (no policy.manage)'
);

-- (#12) Same-org SELECT works (employee sees org A policy).
select is(
  (select count(*) from public.scoring_policies
     where id = 'a0000000-0000-0000-0000-0000000000d1'),
  1::bigint, 'same-org user can SELECT org A scoring policy'
);

-- (#13) Cross-tenant SELECT denied (org A user cannot see org B policy/version).
select is(
  (select count(*) from public.scoring_policies
     where id = 'b0000000-0000-0000-0000-0000000000d1'),
  0::bigint, 'cross-tenant: org A user cannot SELECT org B scoring policy (SI-7)'
);
select is(
  (select count(*) from public.scoring_policy_versions
     where id = 'b0000000-0000-0000-0000-0000000000d2'),
  0::bigint, 'cross-tenant: org A user cannot SELECT org B scoring policy version (SI-7)'
);

-- ---- Manager Alpha (org A): no policy.manage --------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
-- (#8) Manager cannot insert a scoring policy.
select throws_ok(
  $$ insert into public.scoring_policies (organization_id, name, status, created_by)
     values ('a0000000-0000-0000-0000-000000000001', 'Mgr Rogue Policy', 'draft',
             'a0000000-0000-0000-0000-0000000000a5') $$,
  '42501',
  'new row violates row-level security policy for table "scoring_policies"',
  'manager cannot insert scoring policy (no policy.manage)'
);

-- ---- Finance (org A): no policy.manage --------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
-- (#9) Finance cannot insert a scoring policy.
select throws_ok(
  $$ insert into public.scoring_policies (organization_id, name, status, created_by)
     values ('a0000000-0000-0000-0000-000000000001', 'Fin Rogue Policy', 'draft',
             'a0000000-0000-0000-0000-0000000000a4') $$,
  '42501',
  'new row violates row-level security policy for table "scoring_policies"',
  'finance cannot insert scoring policy (no policy.manage)'
);

-- ---- HR (org A): has policy.manage ; DELETE denied --------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
-- (#10) HR can insert a scoring policy.
select lives_ok(
  $$ insert into public.scoring_policies (organization_id, name, status, created_by)
     values ('a0000000-0000-0000-0000-000000000001', 'HR Draft Policy', 'draft',
             'a0000000-0000-0000-0000-0000000000a3') $$,
  'HR can insert scoring policy (policy.manage)'
);
-- (#23) Authenticated cannot DELETE scoring_policies (no privilege).
select throws_ok(
  $$ delete from public.scoring_policies
     where id = 'a0000000-0000-0000-0000-0000000000d1' $$,
  '42501',
  'permission denied for table scoring_policies',
  'authenticated cannot DELETE scoring_policies (no privilege)'
);
-- (#24) Authenticated cannot DELETE scoring_policy_versions (no privilege).
select throws_ok(
  $$ delete from public.scoring_policy_versions
     where id = 'a0000000-0000-0000-0000-0000000000d2' $$,
  '42501',
  'permission denied for table scoring_policy_versions',
  'authenticated cannot DELETE scoring_policy_versions (no privilege)'
);

-- ---- Owner / Admin (org A): have policy.manage ------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a1"}', true);
-- (#11a) Owner can insert a scoring policy.
select lives_ok(
  $$ insert into public.scoring_policies (organization_id, name, status, created_by)
     values ('a0000000-0000-0000-0000-000000000001', 'Owner Draft Policy', 'draft',
             'a0000000-0000-0000-0000-0000000000a1') $$,
  'owner can insert scoring policy (policy.manage)'
);
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a2"}', true);
-- (#11b) Admin can insert a scoring policy.
select lives_ok(
  $$ insert into public.scoring_policies (organization_id, name, status, created_by)
     values ('a0000000-0000-0000-0000-000000000001', 'Admin Draft Policy', 'draft',
             'a0000000-0000-0000-0000-0000000000a2') $$,
  'admin can insert scoring policy (policy.manage)'
);

-- ---- Support active grant (org A; no membership): scoped read ---------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000aa"}', true);
-- (#14) Active support grant can read within the granted org.
select is(
  (select count(*) from public.scoring_policies
     where id = 'a0000000-0000-0000-0000-0000000000d1'),
  1::bigint, 'support-active can read org A scoring policy via grant'
);
select is(
  (select count(*) from public.scoring_policy_versions
     where id = 'a0000000-0000-0000-0000-0000000000d2'),
  1::bigint, 'support-active can read org A scoring policy version via grant'
);

-- ---- Support expired grant: no access --------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000ab"}', true);
-- (#15) Expired support grant cannot read.
select is(
  (select count(*) from public.scoring_policies
     where id = 'a0000000-0000-0000-0000-0000000000d1'),
  0::bigint, 'support-expired cannot read org A scoring policy (no active grant)'
);

reset role;
select * from finish();
rollback;
