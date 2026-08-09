-- =============================================================================
-- pgTAP — Phase 6-d blocking suite: bonus engine authz hardening
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 0021 run_bonus_calculation, 0022 post_bonus_accrual, 0024 (the fix),
--       Decision Lock AD1 (authorization from the DB, not ambient session state).
--
-- WHAT THIS PROVES: after 0024, the entry authz of both engines actually enforces
-- period.manage for authenticated callers, and still admits a trusted server/job
-- context (auth.uid() IS NULL). The authz check runs BEFORE any period/pool lookup,
-- so bogus identifiers are sufficient:
--   (a) authenticated WITHOUT period.manage (Finance C, c4) -> 42501 (rejected)
--   (b) authenticated WITH    period.manage (HR C, c3)      -> passes authz, then
--       23503 (bogus period not found) — i.e. the privileged path is admitted
--   (c) trusted context (auth.uid() IS NULL)                -> passes authz, then 23503
-- Regression for the trusted path is also covered end-to-end by 0015/0016 (their
-- engine calls all run in a trusted context and stay green).
--
-- Note: before 0024 the same authz used `current_user not in ('authenticated','anon')`,
-- which is ALWAYS true inside a SECURITY DEFINER (current_user = owner), so scenario
-- (a) would NOT have raised — this suite locks the fix against regression.
-- All identifiers below are deliberately non-existent (all-f UUIDs).
-- =============================================================================
begin;
select no_plan();

-- Bogus, non-existent identifiers (authz raises before any lookup; on the admitted
-- paths the subsequent period lookup raises 23503).
-- =============================================================================
-- SANITY
-- =============================================================================
select has_function('public', 'run_bonus_calculation', 'run_bonus_calculation exists');
select has_function('public', 'post_bonus_accrual', 'post_bonus_accrual exists');

-- =============================================================================
-- SCENARIO (a) — authenticated WITHOUT period.manage (Finance C, c4) => 42501
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c4"}', true);

select throws_ok(
  $$ select public.run_bonus_calculation('ffffffff-ffff-ffff-ffff-ffffffffffff','ffffffff-ffff-ffff-ffff-ffffffffffff','ffffffff-ffff-ffff-ffff-ffffffffffff','p6d-a-run','ffffffff-ffff-ffff-ffff-ffffffffffff') $$,
  '42501', NULL,
  'run_bonus_calculation: authenticated Finance C (no period.manage) is rejected 42501');

select throws_ok(
  $$ select public.post_bonus_accrual('ffffffff-ffff-ffff-ffff-ffffffffffff','ffffffff-ffff-ffff-ffff-ffffffffffff','ffffffff-ffff-ffff-ffff-ffffffffffff') $$,
  '42501', NULL,
  'post_bonus_accrual: authenticated Finance C (no period.manage) is rejected 42501');

-- =============================================================================
-- SCENARIO (b) — authenticated WITH period.manage (HR C, c3) => authz passes, 23503
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c3"}', true);

select throws_ok(
  $$ select public.run_bonus_calculation('ffffffff-ffff-ffff-ffff-ffffffffffff','ffffffff-ffff-ffff-ffff-ffffffffffff','ffffffff-ffff-ffff-ffff-ffffffffffff','p6d-b-run','ffffffff-ffff-ffff-ffff-ffffffffffff') $$,
  '23503', NULL,
  'run_bonus_calculation: authenticated HR C (period.manage) passes authz -> 23503 (period not found)');

select throws_ok(
  $$ select public.post_bonus_accrual('ffffffff-ffff-ffff-ffff-ffffffffffff','ffffffff-ffff-ffff-ffff-ffffffffffff','ffffffff-ffff-ffff-ffff-ffffffffffff') $$,
  '23503', NULL,
  'post_bonus_accrual: authenticated HR C (period.manage) passes authz -> 23503 (period not found)');

-- =============================================================================
-- SCENARIO (c) — trusted server/job context (auth.uid() IS NULL) => authz passes, 23503
-- =============================================================================
reset role;
select set_config('request.jwt.claims', '', true);   -- clear JWT identity => auth.uid() IS NULL

select throws_ok(
  $$ select public.run_bonus_calculation('ffffffff-ffff-ffff-ffff-ffffffffffff','ffffffff-ffff-ffff-ffff-ffffffffffff','ffffffff-ffff-ffff-ffff-ffffffffffff','p6d-c-run','ffffffff-ffff-ffff-ffff-ffffffffffff') $$,
  '23503', NULL,
  'run_bonus_calculation: trusted context (auth.uid() null) passes authz -> 23503 (period not found)');

select throws_ok(
  $$ select public.post_bonus_accrual('ffffffff-ffff-ffff-ffff-ffffffffffff','ffffffff-ffff-ffff-ffff-ffffffffffff','ffffffff-ffff-ffff-ffff-ffffffffffff') $$,
  '23503', NULL,
  'post_bonus_accrual: trusted context (auth.uid() null) passes authz -> 23503 (period not found)');

select * from finish();
rollback;
