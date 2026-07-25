-- =============================================================================
-- pgTAP — Phase 3 blocking suite: compensation_records (comp-sensitive) + masked audit
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 14/15 (compensation_records §), 16 (SI-5/SI-6/SI-7/SI-16), ADR-018/012/006,
--       Decision Lock D7/AD3/AD6. Strict throws_ok; errcode-only (NULL msg) where the
--       privilege-denial message is version-dependent.
--
-- Model (AD3/D7): DIRECT raw SELECT is CLOSED. No SELECT policy; authenticated has
-- column SELECT only on `id` (for UPDATE ... WHERE id). Raw salary/cap-basis/notes
-- are never directly selectable. ALL raw reads go through
-- read_compensation_record(employee, reason) — comp.read/auditor + non-empty reason
-- + MASKED access audit. INSERT/UPDATE gated on comp.read; DELETE forbidden.
--
-- Seed fixtures (seed_test_tenants.sql):
--   c1   = a0000000-...-c1  active comp, emp-alpha (a7), org A, gross 5000000
--   c2   = a0000000-...-c2  active comp, emp-beta  (a8), org A, cap_basis NULL
--   b_c1 = b0000000-...-c1  active comp, emp-b     (b2), org B
-- comp.read is granted to hr + finance ONLY.
-- =============================================================================
begin;
select no_plan();

-- =============================================================================
-- SECTION A — privileged (bypassrls): existence, RLS, privileges (raw SELECT
--             closed), comp.read grants, constraints, DELETE block, masked audit.
-- =============================================================================

-- (#1) Table exists.
select has_table('public', 'compensation_records', 'compensation_records table exists');

-- (#2) RLS ENABLED + FORCE.
select is(
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'public.compensation_records'::regclass),
  true, 'RLS ENABLED + FORCE on compensation_records (SI-6)'
);

-- (#3) Privilege shape: INSERT/UPDATE yes; DELETE no; raw columns NOT selectable;
--      only `id` column is selectable (for UPDATE ... WHERE id).
select is(has_table_privilege('authenticated', 'public.compensation_records', 'INSERT'),
  true,  'authenticated has INSERT');
select is(has_table_privilege('authenticated', 'public.compensation_records', 'UPDATE'),
  true,  'authenticated has UPDATE');
select is(has_table_privilege('authenticated', 'public.compensation_records', 'DELETE'),
  false, 'authenticated has NO DELETE (retention/supersede-only)');
select is(has_column_privilege('authenticated', 'public.compensation_records', 'gross_salary_minor', 'SELECT'),
  false, 'authenticated CANNOT SELECT gross_salary_minor (raw closed — AD3/D7)');
select is(has_column_privilege('authenticated', 'public.compensation_records', 'cap_basis_minor', 'SELECT'),
  false, 'authenticated CANNOT SELECT cap_basis_minor (raw closed)');
select is(has_column_privilege('authenticated', 'public.compensation_records', 'notes', 'SELECT'),
  false, 'authenticated CANNOT SELECT notes (raw closed)');
select is(has_column_privilege('authenticated', 'public.compensation_records', 'id', 'SELECT'),
  true,  'authenticated can SELECT only id (for UPDATE targeting)');

-- (#4) comp.read exists and is granted to hr/finance ONLY.
select is((select count(*) from public.permissions where key = 'comp.read'),
  1::bigint, 'comp.read permission exists');
select is(
  (select count(*) from public.role_permissions
     where permission_key = 'comp.read' and role_key in ('hr', 'finance')),
  2::bigint, 'comp.read granted to hr + finance');
select is(
  (select count(*) from public.role_permissions
     where permission_key = 'comp.read'
       and role_key in ('owner', 'admin', 'manager', 'employee', 'auditor')),
  0::bigint, 'comp.read NOT granted to owner/admin/manager/employee/auditor');

-- (#5) Constraint negatives (each isolated to one constraint).
select throws_ok(
  $$ insert into public.compensation_records
       (organization_id, employee_id, gross_salary_minor, effective_from, created_by)
     values ('a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-0000000000a7', 111, date '2026-03-01',
             'a0000000-0000-0000-0000-0000000000a3') $$,
  '23505',
  'duplicate key value violates unique constraint "uq_comp_active_per_employee"',
  'duplicate active comp per (org, employee) rejected');

select throws_ok(
  $$ insert into public.compensation_records
       (organization_id, employee_id, gross_salary_minor, effective_from, created_by)
     values ('a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-0000000000a9', -1, date '2026-01-01',
             'a0000000-0000-0000-0000-0000000000a3') $$,
  '23514',
  'new row for relation "compensation_records" violates check constraint "compensation_records_salary_pos_chk"',
  'negative gross_salary rejected');

select throws_ok(
  $$ insert into public.compensation_records
       (organization_id, employee_id, gross_salary_minor, currency, effective_from, created_by)
     values ('a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-0000000000a9', 100, 'TR', date '2026-01-01',
             'a0000000-0000-0000-0000-0000000000a3') $$,
  '23514',
  'new row for relation "compensation_records" violates check constraint "compensation_records_currency_chk"',
  'currency length != 3 rejected');

select throws_ok(
  $$ insert into public.compensation_records
       (organization_id, employee_id, gross_salary_minor, effective_from, effective_to, status, created_by)
     values ('a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-0000000000a9', 100, date '2026-02-01', date '2026-01-01',
             'superseded', 'a0000000-0000-0000-0000-0000000000a3') $$,
  '23514',
  'new row for relation "compensation_records" violates check constraint "compensation_records_range_chk"',
  'effective_to <= effective_from rejected');

select throws_ok(
  $$ insert into public.compensation_records
       (organization_id, employee_id, gross_salary_minor, effective_from, effective_to, status, created_by)
     values ('a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-0000000000a9', 100, date '2026-01-01', date '2026-02-01',
             'active', 'a0000000-0000-0000-0000-0000000000a3') $$,
  '23514',
  'new row for relation "compensation_records" violates check constraint "compensation_records_active_consistency_chk"',
  'active record with effective_to rejected (active_consistency)');

select throws_ok(
  $$ insert into public.compensation_records
       (organization_id, employee_id, gross_salary_minor, effective_from, status, created_by)
     values ('a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-0000000000a9', 100, date '2026-01-01',
             'superseded', 'a0000000-0000-0000-0000-0000000000a3') $$,
  '23514',
  'new row for relation "compensation_records" violates check constraint "compensation_records_active_consistency_chk"',
  'superseded record without effective_to rejected (active_consistency)');

-- (#6) DELETE blocked (prevent_delete) even for bypassrls role.
select throws_ok(
  $$ delete from public.compensation_records
     where id = 'a0000000-0000-0000-0000-0000000000c1' $$,
  '23001',
  'delete forbidden: compensation_records is retained (supersede only; deletion is a legal-review item)',
  'DELETE on compensation_records is blocked (retention; supersede-only)');

-- (#7) Masked write-audit — INSERT (seed c1) never stores raw salary (AD3/SI-5).
select ok(
  exists (select 1 from public.audit_logs
            where target_id = 'a0000000-0000-0000-0000-0000000000c1'
              and action = 'compensation_records.insert' and is_sensitive),
  'comp insert produces an is_sensitive audit row');
select is(
  (select after->>'gross_salary_minor' from public.audit_logs
     where target_id = 'a0000000-0000-0000-0000-0000000000c1'
       and action = 'compensation_records.insert' order by created_at limit 1),
  '***masked***',
  'comp insert audit masks gross_salary_minor (raw salary never in audit_logs — AD3/SI-5)');

-- (#8) Masked write-audit — UPDATE masks before+after.
update public.compensation_records set notes = 'privileged note'
  where id = 'a0000000-0000-0000-0000-0000000000c2';
select is(
  (select (before->>'gross_salary_minor') || '|' || (after->>'gross_salary_minor')
     from public.audit_logs
    where target_id = 'a0000000-0000-0000-0000-0000000000c2'
      and action = 'compensation_records.update' order by created_at desc limit 1),
  '***masked***|***masked***',
  'comp update audit masks before+after gross_salary_minor (AD3/SI-5)');

-- =============================================================================
-- SECTION B — RLS as authenticated users
-- =============================================================================
set local role authenticated;

-- ---- HR (a3, comp.read): NO direct row read; raw column closed ---------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
-- (#9) HR cannot directly SELECT rows (no SELECT policy).
select is(
  (select count(id) from public.compensation_records),
  0::bigint, 'HR has NO direct row visibility on compensation_records (no SELECT policy)');
-- (#10) HR cannot select the raw salary column (privilege denied).
select throws_ok(
  $$ select gross_salary_minor from public.compensation_records
       where id = 'a0000000-0000-0000-0000-0000000000c1' $$,
  '42501', NULL,
  'HR cannot directly SELECT gross_salary_minor (raw column closed — AD3/D7)');

-- ---- Finance (a4, comp.read): also no direct row read ------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
-- (#11) Finance cannot directly SELECT rows.
select is(
  (select count(id) from public.compensation_records),
  0::bigint, 'Finance has NO direct row visibility on compensation_records');

-- ---- Employee alpha (a7): no access, raw column closed -----------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
-- (#12) Employee cannot directly SELECT rows (incl. own).
select is(
  (select count(id) from public.compensation_records),
  0::bigint, 'employee cannot directly SELECT compensation_records (incl. own; SI-5)');
-- (#13) Employee cannot select the raw salary column.
select throws_ok(
  $$ select gross_salary_minor from public.compensation_records $$,
  '42501', NULL,
  'employee cannot SELECT gross_salary_minor (raw column closed)');
-- (#14) Employee INSERT denied (no comp.read).
select throws_ok(
  $$ insert into public.compensation_records
       (organization_id, employee_id, gross_salary_minor, effective_from, created_by)
     values ('a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-0000000000a7', 999, date '2026-01-01',
             'a0000000-0000-0000-0000-0000000000a7') $$,
  '42501',
  'new row violates row-level security policy for table "compensation_records"',
  'employee cannot INSERT compensation record (no comp.read)');

-- ---- Manager (a5) / Owner (a1): no access -----------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
-- (#15) Manager cannot directly SELECT rows.
select is(
  (select count(id) from public.compensation_records),
  0::bigint, 'manager cannot directly SELECT compensation_records (SI-5)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1"}', true);
-- (#16) Owner cannot directly SELECT rows (least privilege; no comp.read).
select is(
  (select count(id) from public.compensation_records),
  0::bigint, 'owner cannot directly SELECT compensation_records (no comp.read)');

-- ---- HR write paths ---------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
-- (#17) HR can INSERT a comp for an employee with none (manager a5 has no comp).
select lives_ok(
  $$ insert into public.compensation_records
       (organization_id, employee_id, gross_salary_minor, effective_from, created_by)
     values ('a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-0000000000a5', 3500000, date '2026-01-01',
             'a0000000-0000-0000-0000-0000000000a3') $$,
  'HR (comp.read) can INSERT a compensation record');
-- (#18) HR can UPDATE (supersede c2 by id — needs SELECT(id) + UPDATE policy).
select lives_ok(
  $$ update public.compensation_records
       set status = 'superseded', effective_to = date '2026-06-01'
     where id = 'a0000000-0000-0000-0000-0000000000c2' $$,
  'HR (comp.read) can UPDATE (supersede) a compensation record');
-- (#19) Cross-tenant write denied: HR A cannot INSERT into org B.
select throws_ok(
  $$ insert into public.compensation_records
       (organization_id, employee_id, gross_salary_minor, effective_from, created_by)
     values ('b0000000-0000-0000-0000-000000000002',
             'b0000000-0000-0000-0000-0000000000b2', 100, date '2026-01-01',
             'a0000000-0000-0000-0000-0000000000a3') $$,
  '42501',
  'new row violates row-level security policy for table "compensation_records"',
  'cross-tenant: HR A cannot INSERT org B compensation record (SI-7)');

-- ---- read_compensation_record(): the ONLY raw-read path (audited + justified) --
-- (#20) HR read returns RAW salary (authorized).
select is(
  (public.read_compensation_record('a0000000-0000-0000-0000-0000000000a7', 'HR periodic review')).gross_salary_minor,
  5000000::bigint,
  'HR read_compensation_record returns raw gross_salary_minor (authorized raw access)');
-- (#21) …and writes a justified, is_sensitive access audit whose payload is MASKED.
select ok(
  exists (select 1 from public.audit_logs
            where action = 'compensation_records.access'
              and target_id = 'a0000000-0000-0000-0000-0000000000a7'
              and is_sensitive and reason = 'HR periodic review'),
  'read_compensation_record writes a justified, is_sensitive access audit (AD3)');
select is(
  (select after->>'gross_salary_minor' from public.audit_logs
     where action = 'compensation_records.access'
       and target_id = 'a0000000-0000-0000-0000-0000000000a7'
       and reason = 'HR periodic review' order by created_at desc limit 1),
  '***masked***',
  'access audit masks raw salary (no raw in audit_logs — AD3/req#4)');

-- (#22) Finance justified read works (Finance holds comp.read).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is(
  (public.read_compensation_record('a0000000-0000-0000-0000-0000000000a7', 'Finance payout check')).gross_salary_minor,
  5000000::bigint,
  'Finance read_compensation_record returns raw with reason (justified access)');

-- (#23) Auditor justified read works (raw only with reason — AD3).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select is(
  (public.read_compensation_record('a0000000-0000-0000-0000-0000000000a7', 'audit trail check')).gross_salary_minor,
  5000000::bigint,
  'auditor read_compensation_record returns raw with reason (AD3 auditor raw path)');

-- (#24) Employee cannot use the read function (forbidden).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select throws_ok(
  $$ select public.read_compensation_record('a0000000-0000-0000-0000-0000000000a7', 'let me see') $$,
  '42501',
  'forbidden: compensation access requires comp.read or auditor',
  'employee cannot read compensation via function (forbidden)');

-- (#25) Empty reason rejected (justification required — AD3).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select throws_ok(
  $$ select public.read_compensation_record('a0000000-0000-0000-0000-0000000000a7', '   ') $$,
  '22023',
  'reason required for compensation access (AD3)',
  'empty reason rejected (justification required)');

-- (#26) Cross-tenant via function: HR A reading org B employee resolves to null.
select is(
  (public.read_compensation_record('b0000000-0000-0000-0000-0000000000b2', 'cross tenant probe')).id,
  null::uuid,
  'read_compensation_record is org-anchored: HR A gets null for org B employee (SI-7)');
-- (#27) …and the cross-tenant probe audit carries NO raw salary.
select ok(
  not exists (
    select 1 from public.audit_logs
     where action = 'compensation_records.access'
       and reason = 'cross tenant probe'
       and (after ? 'gross_salary_minor')
         and after->>'gross_salary_minor' <> '***masked***'),
  'cross-tenant probe audit leaks no raw salary (masked / no-record only)');

reset role;
select * from finish();
rollback;
