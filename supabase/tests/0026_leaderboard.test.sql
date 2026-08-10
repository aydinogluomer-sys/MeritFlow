-- =============================================================================
-- pgTAP — Phase post-10-C leaderboard RPC (get_leaderboard)
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 0032_leaderboard.sql, Decision Lock AD5 (privacy-first leaderboard),
--       CLAUDE.md (cross-tenant non-negotiable).
--
-- Same conventions as 0001/0025: whole file in a rolled-back transaction; seed
-- assumed present (supabase db reset). Three assertions:
--   #0  is_self=true row gets the caller's real display_name (AD5 — own name visible)
--   #1  is_self=false rows are anonymised as 'Çalışan #<rank>' (AD5 — others hidden)
--   #2  CRITICAL cross-tenant block: org-B user calling get_leaderboard(orgA) → 0 rows
--
-- Seed fixtures (seed_test_tenants.sql):
--   org A       = a0000000-0000-0000-0000-000000000001
--   org B       = b0000000-0000-0000-0000-000000000002
--   emp-alpha   = a0000000-0000-0000-0000-0000000000a7  (display_name: 'Employee Alpha')
--   emp-beta    = a0000000-0000-0000-0000-0000000000a8  (display_name: 'Employee Beta')
--   owner-b     = b0000000-0000-0000-0000-0000000000b1  (org B member only)
--
-- Point ledger (seed): org A — emp-alpha e1 manual_adjustment +10, emp-beta e3 +5.
-- get_leaderboard includes manual_adjustment → emp-alpha rank 1 (10 pts),
-- emp-beta rank 2 (5 pts) when called as emp-alpha (a7).
-- =============================================================================
begin;
select plan(3);

set local role authenticated;

-- =============================================================================
-- Test #0 — is_self=true row shows the caller's real display_name (AD5)
-- Caller: emp-alpha (a7) in org A. Expects 'Employee Alpha' on their own row.
-- =============================================================================
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);

select is(
  (select display_name
     from public.get_leaderboard('a0000000-0000-0000-0000-000000000001'::uuid)
    where is_self = true
    limit 1),
  'Employee Alpha',
  '#0 is_self row shows caller''s real display_name (AD5)'
);

-- =============================================================================
-- Test #1 — is_self=false rows are anonymised as 'Çalışan #<rank>'
-- Same caller (a7 / org A). emp-beta ranks 2nd → anonymised as 'Çalışan #2'.
-- =============================================================================
select ok(
  (select display_name
     from public.get_leaderboard('a0000000-0000-0000-0000-000000000001'::uuid)
    where is_self = false
    limit 1) like 'Çalışan #%',
  '#1 is_self=false rows are anonymised as Çalışan #<rank> (AD5)'
);

-- =============================================================================
-- Test #2 — CRITICAL cross-tenant block (CLAUDE.md non-negotiable)
-- Caller: owner-b (b1) — active member of org B only, no membership in org A.
-- Calling get_leaderboard(orgA) must return 0 rows (memberships guard fires).
-- =============================================================================
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-0000000000b1"}', true);

select is(
  (select count(*)
     from public.get_leaderboard('a0000000-0000-0000-0000-000000000001'::uuid)),
  0::bigint,
  '#2 cross-tenant: org-B user cannot read org-A leaderboard (memberships guard)'
);

select * from finish();
rollback;
