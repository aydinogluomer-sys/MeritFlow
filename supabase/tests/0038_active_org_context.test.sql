-- =============================================================================
-- pgTAP — ENGINEERING-14 current_org() tenant-context resolution
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: migration 0038, 0006_rls_helpers, 15_RLS_POLICY_MATRIX, Decision Lock AD1
--
-- Impersonation: set role authenticated + request.jwt.claims.sub (auth.uid()).
-- Whole file runs in a transaction and is rolled back; seed data is assumed
-- present (supabase db reset applies migrations + seed).
--
-- Known seed UUIDs:
--   org A            = a0000000-0000-0000-0000-000000000001
--   org B            = b0000000-0000-0000-0000-000000000002
--   employee alpha A = a0000000-0000-0000-0000-0000000000a7  (active membership: org A)
--   owner B          = b0000000-0000-0000-0000-0000000000b1  (active membership: org B)
--
-- NOTE: The request.headers path (x-meritflow-org-id header) is not
-- testable via pgTAP because pgTAP runs outside PostgREST and the
-- request.headers GUC is never set in that context. The header injection
-- and end-to-end wiring is proven in tests/unit/auth/active-org-context.test.ts
-- (createTenantClient header injection test).
-- =============================================================================
begin;
select no_plan();

set local role authenticated;

-- 1. Anonymous session (auth.uid() null) → current_org() returns NULL.
select set_config('request.jwt.claims', '', true);
select set_config('app.current_org', '', true);
select is(
  public.current_org(), null::uuid,
  'anonymous (auth.uid() null) → current_org() is NULL'
);

-- 2. app.current_org GUC set to a valid org where the user has an active
--    membership → returns that org (backward-compat legacy path).
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-0000000000b1"}', true);
select set_config('app.current_org', 'b0000000-0000-0000-0000-000000000002', true);
select is(
  public.current_org(), 'b0000000-0000-0000-0000-000000000002'::uuid,
  'app.current_org GUC (valid membership) → returns that org (backward compat)'
);

-- 3. app.current_org GUC set to an org where the user has NO membership →
--    returns NULL (fail closed; does NOT fall through to first membership).
select set_config('app.current_org', 'a0000000-0000-0000-0000-000000000001', true);
select is(
  public.current_org(), null::uuid,
  'app.current_org GUC present but no membership → NULL (fail closed, no fallback)'
);

-- 4. No GUC set, no request.headers → user''s first active membership (joined_at asc).
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select set_config('app.current_org', '', true);
select is(
  public.current_org(), 'a0000000-0000-0000-0000-000000000001'::uuid,
  'no GUC/header → first active membership (org A for employee alpha)'
);

reset role;
select * from finish();
rollback;
