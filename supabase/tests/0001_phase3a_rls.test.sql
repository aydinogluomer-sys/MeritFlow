-- =============================================================================
-- pgTAP — Phase 3A RLS / RBAC blocking suite
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 15_RLS_POLICY_MATRIX, 16 (SI-2/6/7/11), 17 §7A/§8A/§11, Decision Lock
--
-- Impersonation: set role authenticated + request.jwt.claims.sub (auth.uid()).
-- Whole file runs in a transaction and is rolled back; seed data is assumed
-- present (supabase db reset applies migrations + seed).
-- =============================================================================
begin;
select no_plan();

-- Convenience: known seed UUIDs.
--   org A      = a0000000-0000-0000-0000-000000000001
--   org B      = b0000000-0000-0000-0000-000000000002
--   team alpha = a0000000-0000-0000-0000-0000000000f1
--   team beta  = a0000000-0000-0000-0000-0000000000f2

-- =============================================================================
-- SECTION A — privileged (superuser/bypassrls) checks: append-only + constraints
-- =============================================================================

-- Append-only audit_logs (SI-2): UPDATE/DELETE blocked even for bypassrls roles.
select throws_ok(
  $$ update public.audit_logs set reason = 'tamper' where true $$,
  '23001',
  'append-only: UPDATE on audit_logs is not permitted',
  'append-only: UPDATE on audit_logs is blocked (SI-2)'
);
select throws_ok(
  $$ delete from public.audit_logs where true $$,
  '23001',
  'append-only: DELETE on audit_logs is not permitted',
  'append-only: DELETE on audit_logs is blocked (SI-2)'
);

-- Audit was produced by seed mutations (membership/team/settings/support).
select ok(
  (select count(*) from public.audit_logs
     where organization_id = 'a0000000-0000-0000-0000-000000000001') > 0,
  'seed mutations produced audit_logs rows for org A'
);

-- Constraint: one active membership per (org, profile) => single primary_role (AD2).
select throws_ok(
  $$ insert into public.memberships (organization_id, profile_id, primary_role)
     values ('a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-0000000000a1', 'admin') $$,
  '23505',
  'duplicate key value violates unique constraint "memberships_org_profile_uq"',
  'duplicate (org, profile) membership rejected (AD2)'
);

-- Constraint: at most one primary team per employee (AD9).
select throws_ok(
  $$ insert into public.team_memberships (organization_id, team_id, profile_id, is_primary)
     values ('a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-0000000000f2',
             'a0000000-0000-0000-0000-0000000000a7', true) $$,
  '23505',
  'duplicate key value violates unique constraint "uq_team_memberships_one_primary"',
  'second is_primary team for an employee rejected (AD9)'
);

-- Constraint: organization_settings is 1-1 with organization.
select throws_ok(
  $$ insert into public.organization_settings (organization_id)
     values ('a0000000-0000-0000-0000-000000000001') $$,
  '23505',
  'duplicate key value violates unique constraint "organization_settings_org_key"',
  'duplicate organization_settings rejected (1-1)'
);

-- Constraint: support grant expires_at must be after created_at.
select throws_ok(
  $$ insert into public.support_access_grants
       (organization_id, grantee_id, scope, granted_by, expires_at, created_at)
     values ('a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-0000000000aa', 'read',
             'a0000000-0000-0000-0000-0000000000a1', now() - interval '1 day', now()) $$,
  '23514',
  'new row for relation "support_access_grants" violates check constraint "support_access_grants_expiry_chk"',
  'support grant with expires_at <= created_at rejected'
);

-- =============================================================================
-- SECTION B — RLS as authenticated users
-- =============================================================================
set local role authenticated;

-- ---- Employee Alpha (org A) -------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);

-- Recursive-RLS smoke (§7A): reading memberships completes, no recursion/stack error.
select lives_ok(
  $$ select count(*) from public.memberships $$,
  '§7A: memberships SELECT does not recurse for an employee'
);

select is( public.current_org(), 'a0000000-0000-0000-0000-000000000001'::uuid,
  'current_org() resolves to the employee''s active org (A)' );

-- Helper correctness (AD1: authz from DB).
select is( public.has_role('employee'),            true,  'has_role(employee) true for employee' );
select is( public.has_role('owner'),               false, 'has_role(owner) false for employee' );
select is( public.has_permission('task.submit'),   true,  'has_permission(task.submit) true' );
select is( public.has_permission('org.settings.write'), false, 'employee lacks org.settings.write' );

-- memberships: non-recursive base policy shows self-row only (no broad perm).
select is(
  (select count(*) from public.memberships
     where profile_id = 'a0000000-0000-0000-0000-0000000000a7'),
  1::bigint, 'employee sees own membership (non-recursive base policy, §7A)'
);
select is(
  (select count(*) from public.memberships
     where profile_id = 'a0000000-0000-0000-0000-0000000000a8'),
  0::bigint, 'employee cannot see another member''s membership row'
);

-- Catalog (§8A): global catalog readable; exact seeded counts.
select is( (select count(*) from public.roles),       7::bigint,  'roles catalog readable (7)' );
select is( (select count(*) from public.permissions), 19::bigint, 'permissions catalog readable (19)' );

-- Catalog is read-only to clients (no INSERT privilege).
select throws_ok(
  $$ insert into public.roles (key, label) values ('hacker', 'x') $$,
  '42501',
  'permission denied for table roles',
  'catalog roles is read-only to authenticated (§8A)'
);

-- profiles (§8A): own + same-org visible; other-org hidden.
select is(
  (select count(*) from public.profiles
     where id = 'a0000000-0000-0000-0000-0000000000a8'),
  1::bigint, 'employee sees same-org peer profile (shares_org, §8A)'
);
select is(
  (select count(*) from public.profiles
     where id = 'b0000000-0000-0000-0000-0000000000b1'),
  0::bigint, 'employee cannot see other-org profile (§8A)'
);

-- Employee cannot create teams (RLS WITH CHECK).
select throws_ok(
  $$ insert into public.teams (organization_id, name)
     values ('a0000000-0000-0000-0000-000000000001', 'Rogue') $$,
  '42501',
  'new row violates row-level security policy for table "teams"',
  'employee cannot insert team (RLS WITH CHECK)'
);

-- Employee has no audit.read.
select is( (select count(*) from public.audit_logs), 0::bigint,
  'employee cannot read audit_logs (no audit.read)' );

-- ---- Manager Alpha: manages_team scoping ------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select is( public.manages_team('a0000000-0000-0000-0000-0000000000f1'), true,
  'manager manages own team (alpha)' );
select is( public.manages_team('a0000000-0000-0000-0000-0000000000f2'), false,
  'manager does not manage another team (beta)' );

-- ---- HR: broad membership visibility ----------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is(
  (select count(*) from public.memberships
     where organization_id = 'a0000000-0000-0000-0000-000000000001'),
  9::bigint, 'HR sees all org A memberships (broad policy)'
);

-- ---- Auditor: read-only audit -----------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select ok(
  (select count(*) from public.audit_logs
     where organization_id = 'a0000000-0000-0000-0000-000000000001') > 0,
  'auditor can read audit_logs (audit.read)'
);

-- ---- Finance: NO audit.read in 3A (financial-subset deferred) ---------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is( (select count(*) from public.audit_logs), 0::bigint,
  'finance has no audit.read in 3A (not over-exposed)' );

-- ---- Cross-tenant: Owner B cannot see org A (SI-7) --------------------------
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-0000000000b1"}', true);
select is( public.current_org(), 'b0000000-0000-0000-0000-000000000002'::uuid,
  'owner B current_org() is org B' );
select is(
  (select count(*) from public.organizations
     where id = 'a0000000-0000-0000-0000-000000000001'),
  0::bigint, 'cross-tenant: owner B cannot see org A (SI-7)'
);
select is(
  (select count(*) from public.memberships
     where organization_id = 'a0000000-0000-0000-0000-000000000001'),
  0::bigint, 'cross-tenant: owner B cannot see org A memberships'
);
select is(
  (select count(*) from public.teams
     where organization_id = 'a0000000-0000-0000-0000-000000000001'),
  0::bigint, 'cross-tenant: owner B cannot see org A teams'
);
select is( (select count(*) from public.organizations), 1::bigint,
  'owner B sees only their own org (positive)' );

-- ---- Support active grant: read tenant data without membership (D4) ---------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000aa"}', true);
select is( public.has_support_grant('a0000000-0000-0000-0000-000000000001'), true,
  'support-active has an active grant for org A' );
select is(
  (select count(*) from public.teams
     where organization_id = 'a0000000-0000-0000-0000-000000000001'),
  2::bigint, 'support-active can read org A teams via grant'
);
select is(
  (select count(*) from public.memberships
     where organization_id = 'a0000000-0000-0000-0000-000000000001'),
  9::bigint, 'support-active can read org A memberships via grant'
);

-- ---- Support expired grant: no access (expires_at > now() check) -------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000ab"}', true);
select is( public.has_support_grant('a0000000-0000-0000-0000-000000000001'), false,
  'support-expired grant is inactive (time-expired)' );
select is(
  (select count(*) from public.teams
     where organization_id = 'a0000000-0000-0000-0000-000000000001'),
  0::bigint, 'support-expired cannot read org A teams (no active grant)'
);

-- ---- Owner A: can create a team (positive write authz) — keep last -----------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a1"}', true);
select lives_ok(
  $$ insert into public.teams (organization_id, name)
     values ('a0000000-0000-0000-0000-000000000001', 'Team Gamma') $$,
  'owner (team.manage) can create a team'
);

reset role;
select * from finish();
rollback;
