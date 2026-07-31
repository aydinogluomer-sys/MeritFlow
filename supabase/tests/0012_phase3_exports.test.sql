-- =============================================================================
-- pgTAP — Phase 3 blocking suite: exports foundation
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 14 (exports §444-451), 15 (§149-152), 16 (§8 export machine, SI-3/SI-15),
--       Decision Lock AD6/INV-7, ADR-006/018/020.
--
-- Section A = privileged (bypassrls); Section B = RLS as authenticated. exports is an
-- APPEND-ONLY financial record: Finance INSERT via payout.export; no client UPDATE/
-- DELETE; prevent_delete retention. snapshot_id NOT NULL (SI-3). AD6/SI-15: export is
-- blocked when the snapshot's calculation_run has any pending_missing_cap_basis
-- allocation — checked by run (bonus_allocations), not just the snapshot row.
--
-- Seed fixtures: clean export 48 (org A, snapshot 35) + b48 (org B). AD6 gate: snapshot
-- 64 (run 62, alloc status=pending) and snapshot 67 (run 65, alloc cap_applied=pending).
-- =============================================================================
begin;
select no_plan();

-- =============================================================================
-- SECTION A — privileged (bypassrls)
-- =============================================================================

-- (#1) Table exists.
select has_table('public', 'exports', 'exports table exists');

-- (#2) Columns present.
select has_column('public', 'exports', 'id',              'has id');
select has_column('public', 'exports', 'organization_id', 'has organization_id');
select has_column('public', 'exports', 'bonus_period_id', 'has bonus_period_id');
select has_column('public', 'exports', 'snapshot_id',     'has snapshot_id');
select has_column('public', 'exports', 'exported_by',     'has exported_by');
select has_column('public', 'exports', 'format',          'has format');
select has_column('public', 'exports', 'status',          'has status');
select has_column('public', 'exports', 'file_path',       'has file_path');
select has_column('public', 'exports', 'row_count',       'has row_count');
select has_column('public', 'exports', 'checksum',        'has checksum');
select has_column('public', 'exports', 'created_at',      'has created_at');

-- (#3) RLS ENABLED + FORCE.
select is(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.exports'::regclass),
  true, 'RLS ENABLED + FORCE on exports (SI-6)');

-- (#4) Privileges: SELECT/INSERT yes; append-only (no UPDATE/DELETE); service_role all.
select is(has_table_privilege('authenticated', 'public.exports', 'SELECT'), true,  'exports SELECT (authenticated)');
select is(has_table_privilege('authenticated', 'public.exports', 'INSERT'), true,  'exports INSERT (authenticated)');
select is(has_table_privilege('authenticated', 'public.exports', 'UPDATE'), false, 'exports no UPDATE (append-only)');
select is(has_table_privilege('authenticated', 'public.exports', 'DELETE'), false, 'exports no DELETE (retention)');
select is(has_table_privilege('service_role',  'public.exports', 'DELETE'), true,  'service_role full access');

-- (#5) snapshot_id NOT NULL (canonical not-null violation).
select throws_ok(
  $$ insert into public.exports (organization_id, bonus_period_id, snapshot_id, exported_by, format)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000030', null,
             'a0000000-0000-0000-0000-0000000000a4','csv') $$,
  '23502', null, 'snapshot_id NOT NULL rejected (SI-3/INV-7)');

-- (#6) CHECK: status enum.
select throws_ok(
  $$ insert into public.exports (organization_id, bonus_period_id, snapshot_id, exported_by, format, status)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000030',
             'a0000000-0000-0000-0000-000000000035','a0000000-0000-0000-0000-0000000000a4','csv','archived') $$,
  '23514', 'new row for relation "exports" violates check constraint "exports_status_chk"',
  'invalid status rejected');

-- (#7) CHECK: format non-empty.
select throws_ok(
  $$ insert into public.exports (organization_id, bonus_period_id, snapshot_id, exported_by, format)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000030',
             'a0000000-0000-0000-0000-000000000035','a0000000-0000-0000-0000-0000000000a4','') $$,
  '23514', 'new row for relation "exports" violates check constraint "exports_format_nonempty_chk"',
  'empty format rejected');

-- (#8) CHECK: row_count >= 0 / checksum non-empty / file_path non-empty.
select throws_ok(
  $$ insert into public.exports (organization_id, bonus_period_id, snapshot_id, exported_by, format, row_count)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000030',
             'a0000000-0000-0000-0000-000000000035','a0000000-0000-0000-0000-0000000000a4','csv', -1) $$,
  '23514', 'new row for relation "exports" violates check constraint "exports_row_count_nonneg_chk"',
  'negative row_count rejected');
select throws_ok(
  $$ insert into public.exports (organization_id, bonus_period_id, snapshot_id, exported_by, format, checksum)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000030',
             'a0000000-0000-0000-0000-000000000035','a0000000-0000-0000-0000-0000000000a4','csv','') $$,
  '23514', 'new row for relation "exports" violates check constraint "exports_checksum_nonempty_chk"',
  'empty checksum rejected');
select throws_ok(
  $$ insert into public.exports (organization_id, bonus_period_id, snapshot_id, exported_by, format, file_path)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000030',
             'a0000000-0000-0000-0000-000000000035','a0000000-0000-0000-0000-0000000000a4','csv','  ') $$,
  '23514', 'new row for relation "exports" violates check constraint "exports_file_path_nonempty_chk"',
  'blank file_path rejected');

-- (#9) Same-org FK: cross-org snapshot (validate_export not-found belt fires first, 23503).
select throws_ok(
  $$ insert into public.exports (organization_id, bonus_period_id, snapshot_id, exported_by, format)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000030',
             'b0000000-0000-0000-0000-000000000035','a0000000-0000-0000-0000-0000000000a4','csv') $$,
  '23503', null, 'cross-org snapshot rejected (SI-7)');

-- (#10) Same-org FK: cross-org exported_by (composite FK, 23503).
select throws_ok(
  $$ insert into public.exports (organization_id, bonus_period_id, snapshot_id, exported_by, format)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000030',
             'a0000000-0000-0000-0000-000000000035','b0000000-0000-0000-0000-0000000000b2','csv') $$,
  '23503', 'insert or update on table "exports" violates foreign key constraint "exports_exported_by_org_fk"',
  'cross-org exported_by rejected (SI-7)');

-- (#11) E: exports.bonus_period_id must match the snapshot's period.
--   snapshot 35 belongs to period 30; using period fa (a different org-A period) mismatches.
select throws_ok(
  $$ insert into public.exports (organization_id, bonus_period_id, snapshot_id, exported_by, format)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000fa',
             'a0000000-0000-0000-0000-000000000035','a0000000-0000-0000-0000-0000000000a4','csv') $$,
  '23514', 'export bonus_period_id a0000000-0000-0000-0000-0000000000fa does not match snapshot period a0000000-0000-0000-0000-000000000030',
  'bonus_period_id must match snapshot period (E)');
-- cross-org period is likewise caught (period ≠ snapshot period).
select throws_ok(
  $$ insert into public.exports (organization_id, bonus_period_id, snapshot_id, exported_by, format)
     values ('a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000030',
             'a0000000-0000-0000-0000-000000000035','a0000000-0000-0000-0000-0000000000a4','csv') $$,
  '23514', null, 'cross-org period rejected (period ≠ snapshot period)');

-- (#12) AD6/SI-15 gate: pending_missing_cap_basis blocks export — by status and by cap_applied.
select throws_ok(
  $$ insert into public.exports (organization_id, bonus_period_id, snapshot_id, exported_by, format)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000060',
             'a0000000-0000-0000-0000-000000000064','a0000000-0000-0000-0000-0000000000a4','csv') $$,
  '23514', 'export blocked: calculation run a0000000-0000-0000-0000-000000000062 has pending_missing_cap_basis allocation(s) (AD6/SI-15)',
  'AD6 gate blocks export (allocation status=pending_missing_cap_basis)');
select throws_ok(
  $$ insert into public.exports (organization_id, bonus_period_id, snapshot_id, exported_by, format)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000060',
             'a0000000-0000-0000-0000-000000000067','a0000000-0000-0000-0000-0000000000a4','csv') $$,
  '23514', 'export blocked: calculation run a0000000-0000-0000-0000-000000000065 has pending_missing_cap_basis allocation(s) (AD6/SI-15)',
  'AD6 gate blocks export (allocation cap_applied=pending_missing_cap_basis only)');

-- (#13) Happy path: export against a clean snapshot succeeds (privileged).
select lives_ok(
  $$ insert into public.exports (id, organization_id, bonus_period_id, snapshot_id, exported_by, format)
     values ('a0000000-0000-0000-0000-00000000004a','a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-000000000030','a0000000-0000-0000-0000-000000000035',
             'a0000000-0000-0000-0000-0000000000a4','csv') $$,
  'export insert against clean snapshot 35 succeeds');

-- (#14) prevent_delete: DELETE is retained (privileged delete blocked).
select throws_ok(
  $$ delete from public.exports where id='a0000000-0000-0000-0000-000000000048' $$,
  '23001', 'delete forbidden: exports is retained (supersede only; deletion is a legal-review item)',
  'DELETE on exports blocked (retention)');

-- (#15) Audit on INSERT (seed export 48).
select ok(exists (select 1 from public.audit_logs where target_id='a0000000-0000-0000-0000-000000000048' and action='exports.insert'),
  'export insert produced an audit row');

-- =============================================================================
-- SECTION B — RLS as authenticated users
-- =============================================================================
set local role authenticated;

-- ---- Finance INSERT (payout.export): clean succeeds; pending-cap blocked (AD6) --------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select lives_ok(
  $$ insert into public.exports (id, organization_id, bonus_period_id, snapshot_id, exported_by, format)
     values ('a0000000-0000-0000-0000-00000000004b','a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-000000000030','a0000000-0000-0000-0000-000000000035',
             'a0000000-0000-0000-0000-0000000000a4','csv') $$,
  'Finance can INSERT a clean export (payout.export)');
select throws_ok(
  $$ insert into public.exports (organization_id, bonus_period_id, snapshot_id, exported_by, format)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000060',
             'a0000000-0000-0000-0000-000000000064','a0000000-0000-0000-0000-0000000000a4','csv') $$,
  '23514', 'export blocked: calculation run a0000000-0000-0000-0000-000000000062 has pending_missing_cap_basis allocation(s) (AD6/SI-15)',
  'Finance cannot INSERT a pending-cap export (AD6)');
-- actor integrity: Finance cannot record ANOTHER same-org user as the exporter.
select throws_ok(
  $$ insert into public.exports (organization_id, bonus_period_id, snapshot_id, exported_by, format)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000030',
             'a0000000-0000-0000-0000-000000000035','a0000000-0000-0000-0000-0000000000a5','csv') $$,
  '42501', 'new row violates row-level security policy for table "exports"',
  'Finance cannot spoof exported_by (must be auth.uid())');

-- ---- SELECT: Finance + Auditor only ---------------------------------------------------
select is((select count(*) from public.exports where id='a0000000-0000-0000-0000-000000000048'),
  1::bigint, 'Finance can read exports');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select is((select count(*) from public.exports where id='a0000000-0000-0000-0000-000000000048'),
  1::bigint, 'Auditor can read exports');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.exports where id='a0000000-0000-0000-0000-000000000048'),
  0::bigint, 'HR cannot read exports');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select is((select count(*) from public.exports where id='a0000000-0000-0000-0000-000000000048'),
  0::bigint, 'Manager cannot read exports');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.exports where id='a0000000-0000-0000-0000-000000000048'),
  0::bigint, 'Employee cannot read exports');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000aa"}', true);
select is((select count(*) from public.exports where id='a0000000-0000-0000-0000-000000000048'),
  0::bigint, 'support (grant) cannot read exports');

-- ---- INSERT authz: only payout.export holders (Finance) -------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select throws_ok(
  $$ insert into public.exports (organization_id, bonus_period_id, snapshot_id, exported_by, format)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000030',
             'a0000000-0000-0000-0000-000000000035','a0000000-0000-0000-0000-0000000000a9','csv') $$,
  '42501', 'new row violates row-level security policy for table "exports"',
  'Auditor cannot INSERT (no payout.export)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select throws_ok(
  $$ insert into public.exports (organization_id, bonus_period_id, snapshot_id, exported_by, format)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000030',
             'a0000000-0000-0000-0000-000000000035','a0000000-0000-0000-0000-0000000000a7','csv') $$,
  '42501', 'new row violates row-level security policy for table "exports"',
  'Employee cannot INSERT (no payout.export)');

-- ---- append-only: Finance cannot UPDATE or DELETE ------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select throws_ok(
  $$ update public.exports set status='generated' where id='a0000000-0000-0000-0000-000000000048' $$,
  '42501', 'permission denied for table exports',
  'Finance cannot UPDATE an export (append-only)');
select throws_ok(
  $$ delete from public.exports where id='a0000000-0000-0000-0000-000000000048' $$,
  '42501', 'permission denied for table exports',
  'Finance cannot DELETE an export (append-only)');

-- ---- cross-tenant isolation ----------------------------------------------------------
select is((select count(*) from public.exports where id='b0000000-0000-0000-0000-000000000048'),
  0::bigint, 'cross-tenant: Finance A cannot read org-B export (SI-7)');

-- ---- no new permission: catalog unchanged (matches 0001) -----------------------------
reset role;
select is((select count(*) from public.permissions), 20::bigint,
  'permission catalog unchanged (20) — exports added NO permission (payout.export pre-existed)');

select * from finish();
rollback;
