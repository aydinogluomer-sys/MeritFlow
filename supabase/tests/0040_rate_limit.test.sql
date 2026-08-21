-- =============================================================================
-- pgTAP — ENGINEERING-19 rate-limit RPC authz
-- Run: supabase test db   (dev/staging local; never production)
--
-- WHAT THIS PROVES:
--   (a) the server-only check_rate_limit() RPC exists
--   (b) only service_role can execute it
--   (c) authenticated cannot execute it, preventing cross-tenant counter exhaustion
-- =============================================================================
begin;
select no_plan();

select has_function(
  'public',
  'check_rate_limit',
  ARRAY['text', 'uuid', 'int4', 'int4'],
  'check_rate_limit(text, uuid, int4, int4) exists'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.check_rate_limit(text, uuid, int, int)',
    'EXECUTE'
  ),
  'service_role can execute check_rate_limit()'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.check_rate_limit(text, uuid, int, int)',
    'EXECUTE'
  ),
  'authenticated cannot execute check_rate_limit()'
);

select * from finish();
rollback;
