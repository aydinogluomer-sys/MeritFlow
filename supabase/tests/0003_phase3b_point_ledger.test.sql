-- =============================================================================
-- pgTAP — Phase 3B-B blocking suite: point_ledger + team_of() + append-only
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 18 §6.3/§7/§9, 15_RLS_POLICY_MATRIX (point_ledger), 16 (SI-2/SI-7/SI-12),
--       ADR-005/ADR-012, Decision Lock. Strict 4-arg throws_ok(sql, sqlstate, errmsg, desc).
--
-- Same conventions as 0001/0002: whole file in a rolled-back transaction; seed
-- assumed present. Section A = privileged (bypassrls) structural/constraint/
-- append-only/audit checks; Section B = RLS as authenticated via request.jwt.claims.sub.
--
-- Seed fixtures (seed_test_tenants.sql):
--   e1   = a0000000-...-e1  manual_adjustment, emp-alpha (a7), org A, spv=d2
--   e2   = a0000000-...-e2  reversal of e1, emp-alpha (a7), org A
--   e3   = a0000000-...-e3  manual_adjustment, emp-beta (a8), org A
--   b_e1 = b0000000-...-e1  manual_adjustment, emp-b (b2), org B
--   team alpha = ...-f1 (mgr a5) ; team beta = ...-f2 (mgr a6)
-- Requirement #31 (full suite still passes) is exercised by `supabase test db`
-- running 0001 + 0002 + this file together.
-- =============================================================================
begin;
select no_plan();

-- =============================================================================
-- SECTION A — privileged (bypassrls)
-- =============================================================================

-- (#1) Table exists.
select has_table('public', 'point_ledger', 'point_ledger table exists');

-- (#2) RLS ENABLED + FORCE.
select is(
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'public.point_ledger'::regclass),
  true, 'RLS ENABLED + FORCE on point_ledger (SI-6)'
);

-- (#3) authenticated has SELECT.
select is(has_table_privilege('authenticated', 'public.point_ledger', 'SELECT'),
  true, 'authenticated has SELECT on point_ledger');

-- (#4) authenticated has NO INSERT/UPDATE/DELETE (server-only writes).
select is(has_table_privilege('authenticated', 'public.point_ledger', 'INSERT'),
  false, 'authenticated has no INSERT on point_ledger (server-only)');
select is(has_table_privilege('authenticated', 'public.point_ledger', 'UPDATE'),
  false, 'authenticated has no UPDATE on point_ledger (append-only)');
select is(has_table_privilege('authenticated', 'public.point_ledger', 'DELETE'),
  false, 'authenticated has no DELETE on point_ledger (append-only)');

-- (#21) Privileged/server insert path works (manual_adjustment).
select lives_ok(
  $$ insert into public.point_ledger
       (id, organization_id, employee_id, event_type, points_delta, reason, created_by)
     values ('a0000000-0000-0000-0000-0000000000ea',
             'a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-0000000000a7', 'manual_adjustment', 1,
             'test: privileged insert', 'a0000000-0000-0000-0000-0000000000a3') $$,
  'privileged/server insert path works (manual_adjustment)'
);

-- (#22) UPDATE blocked by append-only trigger (SI-2).
select throws_ok(
  $$ update public.point_ledger set reason = 'tamper'
     where id = 'a0000000-0000-0000-0000-0000000000e1' $$,
  '23001',
  'append-only: UPDATE on point_ledger is not permitted',
  'append-only: UPDATE on point_ledger is blocked (SI-2)'
);

-- (#23) DELETE blocked by append-only trigger (SI-2).
select throws_ok(
  $$ delete from public.point_ledger
     where id = 'a0000000-0000-0000-0000-0000000000e1' $$,
  '23001',
  'append-only: DELETE on point_ledger is not permitted',
  'append-only: DELETE on point_ledger is blocked (SI-2)'
);

-- (#24) invalid event_type rejected (minimal CHECK).
select throws_ok(
  $$ insert into public.point_ledger
       (organization_id, employee_id, event_type, points_delta, reason, created_by)
     values ('a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-0000000000a7', 'invalid_event_type', 1,
             'x', 'a0000000-0000-0000-0000-0000000000a3') $$,
  '23514',
  'new row for relation "point_ledger" violates check constraint "point_ledger_event_type_chk"',
  'invalid event_type rejected (minimal CHECK)'
);

-- (#25) reversal WITHOUT reverses_entry_id rejected.
select throws_ok(
  $$ insert into public.point_ledger
       (organization_id, employee_id, event_type, points_delta, reason, created_by)
     values ('a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-0000000000a7', 'reversal', -1,
             'x', 'a0000000-0000-0000-0000-0000000000a3') $$,
  '23514',
  'new row for relation "point_ledger" violates check constraint "point_ledger_reversal_ref_chk"',
  'reversal without reverses_entry_id rejected'
);

-- (#26) manual_adjustment WITH reverses_entry_id rejected.
select throws_ok(
  $$ insert into public.point_ledger
       (organization_id, employee_id, event_type, points_delta, reason, reverses_entry_id, created_by)
     values ('a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-0000000000a7', 'manual_adjustment', 1, 'x',
             'a0000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000a3') $$,
  '23514',
  'new row for relation "point_ledger" violates check constraint "point_ledger_manual_no_ref_chk"',
  'manual_adjustment with reverses_entry_id rejected'
);

-- (#27) reverses_entry_id cannot point across tenants (composite self-FK).
--       org B reversal pointing at org A entry e1.
select throws_ok(
  $$ insert into public.point_ledger
       (organization_id, employee_id, event_type, points_delta, reason, reverses_entry_id, created_by)
     values ('b0000000-0000-0000-0000-000000000002',
             'b0000000-0000-0000-0000-0000000000b2', 'reversal', -1, 'x',
             'a0000000-0000-0000-0000-0000000000e1', 'b0000000-0000-0000-0000-0000000000b1') $$,
  '23503',
  'insert or update on table "point_ledger" violates foreign key constraint "point_ledger_reverses_fk"',
  'cross-tenant reverses_entry_id rejected (same-org self-FK)'
);

-- (#28) scoring_policy_version_id cannot point across tenants (composite FK).
--       org B row referencing org A version d2.
select throws_ok(
  $$ insert into public.point_ledger
       (organization_id, employee_id, event_type, points_delta, reason, scoring_policy_version_id, created_by)
     values ('b0000000-0000-0000-0000-000000000002',
             'b0000000-0000-0000-0000-0000000000b2', 'manual_adjustment', 1, 'x',
             'a0000000-0000-0000-0000-0000000000d2', 'b0000000-0000-0000-0000-0000000000b1') $$,
  '23503',
  'insert or update on table "point_ledger" violates foreign key constraint "point_ledger_policy_version_fk"',
  'cross-tenant scoring_policy_version_id rejected (same-org composite FK)'
);

-- (#29) manual_adjustment insert produces an audit_logs row.
insert into public.point_ledger
  (id, organization_id, employee_id, event_type, points_delta, reason, created_by)
values ('a0000000-0000-0000-0000-0000000000eb',
        'a0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-0000000000a7', 'manual_adjustment', 2,
        'test: audit manual', 'a0000000-0000-0000-0000-0000000000a3');
select ok(
  exists (select 1 from public.audit_logs
            where target_id = 'a0000000-0000-0000-0000-0000000000eb'
              and action = 'point_ledger.insert'),
  'manual_adjustment insert creates an audit_logs row'
);

-- (#30) reversal insert produces an audit_logs row.
insert into public.point_ledger
  (id, organization_id, employee_id, event_type, points_delta, reason, reverses_entry_id, created_by)
values ('a0000000-0000-0000-0000-0000000000ec',
        'a0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-0000000000a7', 'reversal', -2,
        'test: audit reversal', 'a0000000-0000-0000-0000-0000000000e1',
        'a0000000-0000-0000-0000-0000000000a3');
select ok(
  exists (select 1 from public.audit_logs
            where target_id = 'a0000000-0000-0000-0000-0000000000ec'
              and action = 'point_ledger.insert'),
  'reversal insert creates an audit_logs row'
);

-- =============================================================================
-- SECTION B — RLS as authenticated users
-- =============================================================================
set local role authenticated;

-- ---- team_of() correctness ---------------------------------------------------
-- HR A (org A): resolves a teammate's primary team; null for a member-less profile.
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
-- (#5) primary team for an employee in current org.
select is( public.team_of('a0000000-0000-0000-0000-0000000000a7'),
  'a0000000-0000-0000-0000-0000000000f1'::uuid,
  'team_of(emp-alpha) returns primary team alpha (current org)' );
-- (#6) null when employee has no primary team.
select is( public.team_of('a0000000-0000-0000-0000-0000000000a3'),
  null::uuid, 'team_of(hr) is null (no primary team)' );

-- Owner B (org B): cross-tenant employee does not resolve.
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-0000000000b1"}', true);
-- (#7) cross-tenant employee/team not resolved (current org = B).
select is( public.team_of('a0000000-0000-0000-0000-0000000000a7'),
  null::uuid, 'team_of does not resolve cross-tenant employee (current org B)' );

-- ---- Employee Alpha (a7): own rows only -------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
-- (#8) employee reads own row.
select is(
  (select count(*) from public.point_ledger
     where id = 'a0000000-0000-0000-0000-0000000000e1'),
  1::bigint, 'employee can read own point_ledger row' );
-- (#9) employee cannot read another employee's row.
select is(
  (select count(*) from public.point_ledger
     where id = 'a0000000-0000-0000-0000-0000000000e3'),
  0::bigint, 'employee cannot read another employee''s point_ledger row' );

-- ---- Manager Alpha (a5): managed primary-team members only ------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
-- (#10) manager reads a managed team member's row (emp-alpha in team alpha).
select is(
  (select count(*) from public.point_ledger
     where id = 'a0000000-0000-0000-0000-0000000000e1'),
  1::bigint, 'manager reads managed primary-team member row (team alpha)' );
-- (#11) manager cannot read a row outside the managed team (emp-beta in team beta).
select is(
  (select count(*) from public.point_ledger
     where id = 'a0000000-0000-0000-0000-0000000000e3'),
  0::bigint, 'manager cannot read row outside managed team (team beta)' );

-- ---- Org-wide readers: owner / admin / hr / auditor see e1 + e3 -------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a1"}', true);
-- (#12) owner reads org rows.
select is(
  (select count(*) from public.point_ledger
     where id in ('a0000000-0000-0000-0000-0000000000e1',
                  'a0000000-0000-0000-0000-0000000000e3')),
  2::bigint, 'owner reads org point_ledger rows' );

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a2"}', true);
-- (#13) admin reads org rows.
select is(
  (select count(*) from public.point_ledger
     where id in ('a0000000-0000-0000-0000-0000000000e1',
                  'a0000000-0000-0000-0000-0000000000e3')),
  2::bigint, 'admin reads org point_ledger rows' );

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
-- (#14) HR reads org rows.
select is(
  (select count(*) from public.point_ledger
     where id in ('a0000000-0000-0000-0000-0000000000e1',
                  'a0000000-0000-0000-0000-0000000000e3')),
  2::bigint, 'HR reads org point_ledger rows' );

select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
-- (#15) auditor reads org rows.
select is(
  (select count(*) from public.point_ledger
     where id in ('a0000000-0000-0000-0000-0000000000e1',
                  'a0000000-0000-0000-0000-0000000000e3')),
  2::bigint, 'auditor reads org point_ledger rows' );

-- ---- Finance: NO raw org-wide point_ledger access (SI-12) -------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
-- (#16) finance sees no raw point_ledger rows (no own rows, not a role reader).
select is(
  (select count(*) from public.point_ledger),
  0::bigint, 'finance has NO raw org-wide point_ledger access (SI-12)' );

-- ---- Support active grant (org A; no membership): scoped read ---------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000aa"}', true);
-- (#17) active support grant reads scoped org rows.
select is(
  (select count(*) from public.point_ledger
     where id in ('a0000000-0000-0000-0000-0000000000e1',
                  'a0000000-0000-0000-0000-0000000000e3')),
  2::bigint, 'support-active reads org A point_ledger rows via grant' );

-- ---- Support expired grant: no access --------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000ab"}', true);
-- (#18) expired support grant reads nothing.
select is(
  (select count(*) from public.point_ledger),
  0::bigint, 'support-expired cannot read point_ledger (no active grant)' );

-- ---- Cross-tenant: org A user cannot see org B row (SI-7) -------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a1"}', true);
-- (#19) cross-tenant rows hidden.
select is(
  (select count(*) from public.point_ledger
     where id = 'b0000000-0000-0000-0000-0000000000e1'),
  0::bigint, 'cross-tenant: org A user cannot read org B point_ledger row (SI-7)' );

-- ---- Authenticated INSERT denied (server-only) -----------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
-- (#20) authenticated cannot INSERT (no privilege).
select throws_ok(
  $$ insert into public.point_ledger
       (organization_id, employee_id, event_type, points_delta, reason, created_by)
     values ('a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-0000000000a3', 'manual_adjustment', 1,
             'rogue', 'a0000000-0000-0000-0000-0000000000a3') $$,
  '42501',
  'permission denied for table point_ledger',
  'authenticated cannot INSERT point_ledger (server-only; no privilege)'
);

reset role;
select * from finish();
rollback;
