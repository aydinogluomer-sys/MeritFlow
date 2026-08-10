-- =============================================================================
-- pgTAP — Phase post-10-B blocking suite: log_comp_access (AD3 raw-access audit)
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 0031 log_comp_access, 0005 audit_logs (append-only + prevent_mutation),
--       Decision Lock AD3 (raw comp/sensitive access is audited), CLAUDE.md.
--
-- Same conventions as 0003/0004: whole file in a rolled-back transaction; seed
-- assumed present. #0 writes one row via the SECURITY DEFINER function (privileged
-- bypassrls context) and asserts its shape; #1 authz denial as role `anon`
-- (execute revoked from public/anon); #2/#3 the 0005 append-only trigger blocks
-- UPDATE/DELETE (errcode 23001). Errcode-only throws_ok (NULL message) where the
-- denial/guard message is version-dependent (house style — cf. 0004/0018).
--
-- Seed fixtures (seed_test_tenants.sql):
--   org A  = a0000000-...-000000000001
--   actor  = a0000000-...-0000000000a3  (HR A)
-- =============================================================================
begin;
select plan(4);

-- (#0) Privileged/server call appends exactly one AD3 raw-access audit row with the
-- expected shape (action / is_sensitive / target_type / actor / org).
select public.log_comp_access(
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-0000000000a3',
  'test'
);
select is(
  (select count(*) from public.audit_logs
     where action = 'comp.raw_access'
       and is_sensitive = true
       and target_type = 'audit_logs'
       and actor_id = 'a0000000-0000-0000-0000-0000000000a3'
       and organization_id = 'a0000000-0000-0000-0000-000000000001'
       and reason = 'test'),
  1::bigint,
  'log_comp_access appends exactly one comp.raw_access audit row (AD3 shape)'
);

-- (#1) authz: EXECUTE is revoked from public/anon -> role anon is denied (42501).
set local role anon;
select throws_ok(
  $$ select public.log_comp_access(
       'a0000000-0000-0000-0000-000000000001',
       'a0000000-0000-0000-0000-0000000000a3',
       'anon attempt') $$,
  '42501', NULL,
  'anon cannot execute log_comp_access (revoked from public/anon)'
);
reset role;

-- (#2) append-only: UPDATE on audit_logs blocked by the 0005 trigger (23001).
select throws_ok(
  $$ update public.audit_logs set reason = 'x' where action = 'comp.raw_access' $$,
  '23001', NULL,
  'append-only: UPDATE on audit_logs is blocked (comp.raw_access row)'
);

-- (#3) append-only: DELETE on audit_logs blocked by the 0005 trigger (23001).
select throws_ok(
  $$ delete from public.audit_logs where action = 'comp.raw_access' $$,
  '23001', NULL,
  'append-only: DELETE on audit_logs is blocked (comp.raw_access row)'
);

select * from finish();
rollback;
