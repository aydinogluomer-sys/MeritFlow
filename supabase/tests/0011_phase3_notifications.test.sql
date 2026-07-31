-- =============================================================================
-- pgTAP — Phase 3 blocking suite: notifications foundation
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 14 (notifications §424-429), 15 (§139-142), 16 (notification effects), ADR-020.
--
-- Section A = privileged (bypassrls); Section B = RLS as authenticated. Notifications
-- are a per-recipient delivery sink with a one-way unread→read lifecycle. INSERT is
-- server-only (service_role); no client DELETE (retention/TTL → V1). Read is
-- RECIPIENT-ONLY — HR / Auditor / Manager / Finance / Support are all excluded (§429).
--
-- Seed fixtures: Org A n80 (recipient a7, unread); n81 (recipient a7, read).
-- Org B n80 (recipient b2, unread) for cross-tenant negatives.
-- =============================================================================
begin;
select no_plan();

-- =============================================================================
-- SECTION A — privileged (bypassrls)
-- =============================================================================

-- (#1) Table exists.
select has_table('public', 'notifications', 'notifications table exists');

-- (#2) Columns present.
select has_column('public', 'notifications', 'id',              'has id');
select has_column('public', 'notifications', 'organization_id', 'has organization_id');
select has_column('public', 'notifications', 'recipient_id',    'has recipient_id');
select has_column('public', 'notifications', 'type',            'has type');
select has_column('public', 'notifications', 'payload',         'has payload');
select has_column('public', 'notifications', 'link',            'has link');
select has_column('public', 'notifications', 'status',          'has status');
select has_column('public', 'notifications', 'read_at',         'has read_at');
select has_column('public', 'notifications', 'created_at',      'has created_at');
select has_column('public', 'notifications', 'updated_at',      'has updated_at');

-- (#3) RLS ENABLED + FORCE.
select is(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.notifications'::regclass),
  true, 'RLS ENABLED + FORCE on notifications');

-- (#4) Privileges: SELECT/UPDATE yes; INSERT server-only; no DELETE; service_role writes.
select is(has_table_privilege('authenticated', 'public.notifications', 'SELECT'), true,  'notifications SELECT (authenticated)');
select is(has_table_privilege('authenticated', 'public.notifications', 'UPDATE'), true,  'notifications UPDATE (authenticated)');
select is(has_table_privilege('authenticated', 'public.notifications', 'INSERT'), false, 'notifications no INSERT (server-only)');
select is(has_table_privilege('authenticated', 'public.notifications', 'DELETE'), false, 'notifications no DELETE');
select is(has_table_privilege('service_role',  'public.notifications', 'INSERT'), true,  'service_role can INSERT (server path)');

-- (#5) CHECK: status ∈ (unread, read).
select throws_ok(
  $$ insert into public.notifications (organization_id, recipient_id, type, status)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a7','task.approved','archived') $$,
  '23514', 'new row for relation "notifications" violates check constraint "notifications_status_chk"',
  'invalid status rejected');

-- (#6) CHECK: type must be non-empty.
select throws_ok(
  $$ insert into public.notifications (organization_id, recipient_id, type)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a7','') $$,
  '23514', 'new row for relation "notifications" violates check constraint "notifications_type_nonempty_chk"',
  'empty type rejected');
select throws_ok(
  $$ insert into public.notifications (organization_id, recipient_id, type)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a7','   ') $$,
  '23514', 'new row for relation "notifications" violates check constraint "notifications_type_nonempty_chk"',
  'whitespace-only type rejected');

-- (#7) CHECK: payload must be a JSON object.
select throws_ok(
  $$ insert into public.notifications (organization_id, recipient_id, type, payload)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a7','task.approved','[]'::jsonb) $$,
  '23514', 'new row for relation "notifications" violates check constraint "notifications_payload_object_chk"',
  'array payload rejected');
select throws_ok(
  $$ insert into public.notifications (organization_id, recipient_id, type, payload)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a7','task.approved','1'::jsonb) $$,
  '23514', 'new row for relation "notifications" violates check constraint "notifications_payload_object_chk"',
  'scalar payload rejected');

-- (#8) CHECK: read consistency (status=read requires read_at; unread requires null).
select throws_ok(
  $$ insert into public.notifications (organization_id, recipient_id, type, status, read_at)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a7','task.approved','read', null) $$,
  '23514', 'new row for relation "notifications" violates check constraint "notifications_read_consistency_chk"',
  'read without read_at rejected');
select throws_ok(
  $$ insert into public.notifications (organization_id, recipient_id, type, status, read_at)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a7','task.approved','unread', now()) $$,
  '23514', 'new row for relation "notifications" violates check constraint "notifications_read_consistency_chk"',
  'unread with read_at rejected');

-- (#9) Same-org composite FK rejects a cross-org recipient (SI-7).
select throws_ok(
  $$ insert into public.notifications (organization_id, recipient_id, type)
     values ('a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-0000000000b2','task.approved') $$,
  '23503', 'insert or update on table "notifications" violates foreign key constraint "notifications_recipient_org_fk"',
  'cross-org recipient rejected (SI-7)');

-- (#10) Transition: unread→read server-stamps read_at (throwaway n82).
insert into public.notifications (id, organization_id, recipient_id, type)
  values ('a0000000-0000-0000-0000-000000000082','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a7','task.approved');
select lives_ok(
  $$ update public.notifications set status='read' where id='a0000000-0000-0000-0000-000000000082' $$,
  'unread→read (mark read) succeeds without supplying read_at');
select is(
  (select read_at is not null and status='read' from public.notifications where id='a0000000-0000-0000-0000-000000000082'),
  true, 'unread→read server-stamps read_at');

-- (#11) Identity fields are immutable after insert (privileged; on seed n80).
select throws_ok(
  $$ update public.notifications set type='changed' where id='a0000000-0000-0000-0000-000000000080' $$,
  '23001', 'notification identity (org/recipient/type/payload/link/created_at) is immutable',
  'type immutable after insert');
select throws_ok(
  $$ update public.notifications set link='/x' where id='a0000000-0000-0000-0000-000000000080' $$,
  '23001', 'notification identity (org/recipient/type/payload/link/created_at) is immutable',
  'link immutable after insert');
select throws_ok(
  $$ update public.notifications set created_at = now() where id='a0000000-0000-0000-0000-000000000080' $$,
  '23001', 'notification identity (org/recipient/type/payload/link/created_at) is immutable',
  'created_at immutable after insert');
select throws_ok(
  $$ update public.notifications set organization_id='b0000000-0000-0000-0000-000000000002' where id='a0000000-0000-0000-0000-000000000080' $$,
  '23001', 'notification identity (org/recipient/type/payload/link/created_at) is immutable',
  'organization_id immutable after insert');

-- (#12) No new permission was added — catalog count matches the 0001 assertion (20).
select is((select count(*) from public.permissions), 20::bigint,
  'permission catalog unchanged (20) — notifications added NO permission');

-- =============================================================================
-- SECTION B — RLS as authenticated users
-- =============================================================================
set local role authenticated;

-- ---- recipient can read own notification ---------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.notifications where id='a0000000-0000-0000-0000-000000000080'),
  1::bigint, 'recipient can read own notification');

-- ---- recipient cannot mutate identity fields (payload / recipient) --------------------
select throws_ok(
  $$ update public.notifications set payload='{"x":1}'::jsonb where id='a0000000-0000-0000-0000-000000000080' $$,
  '23001', 'notification identity (org/recipient/type/payload/link/created_at) is immutable',
  'recipient cannot change payload');
select throws_ok(
  $$ update public.notifications set recipient_id='a0000000-0000-0000-0000-0000000000a8' where id='a0000000-0000-0000-0000-000000000080' $$,
  '23001', 'notification identity (org/recipient/type/payload/link/created_at) is immutable',
  'recipient cannot reassign recipient_id');

-- ---- read is one-way: read→unread rejected (seed n81 is read) -------------------------
select throws_ok(
  $$ update public.notifications set status='unread' where id='a0000000-0000-0000-0000-000000000081' $$,
  '23514', 'notification cannot be marked unread again (read is terminal)',
  'read→unread rejected (one-way)');

-- ---- recipient-only read: everyone else sees 0 (D) -----------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a8"}', true);
select is((select count(*) from public.notifications where id='a0000000-0000-0000-0000-000000000080'),
  0::bigint, 'unrelated employee cannot read another recipient notification');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.notifications where id='a0000000-0000-0000-0000-000000000080'),
  0::bigint, 'HR cannot read another user notification (recipient-only)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select is((select count(*) from public.notifications where id='a0000000-0000-0000-0000-000000000080'),
  0::bigint, 'Auditor cannot read another user notification (recipient-only)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select is((select count(*) from public.notifications where id='a0000000-0000-0000-0000-000000000080'),
  0::bigint, 'own-team Manager cannot read a team member notification (recipient-only)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is((select count(*) from public.notifications where id='a0000000-0000-0000-0000-000000000080'),
  0::bigint, 'Finance cannot read another user notification (recipient-only)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000aa"}', true);
select is((select count(*) from public.notifications where id='a0000000-0000-0000-0000-000000000080'),
  0::bigint, 'support (grant) cannot read another user notification (recipient-only)');

-- ---- cross-tenant isolation ----------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.notifications where id='b0000000-0000-0000-0000-000000000080'),
  0::bigint, 'cross-tenant: org-A recipient cannot see org-B notification (SI-7)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.notifications where id='b0000000-0000-0000-0000-000000000080'),
  0::bigint, 'cross-tenant: HR A cannot see org-B notification (SI-7)');

-- ---- server-only INSERT + no client DELETE -------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select throws_ok(
  $$ insert into public.notifications (organization_id, recipient_id, type)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a7','task.approved') $$,
  '42501', 'permission denied for table notifications',
  'authenticated cannot INSERT a notification (server-only)');
select throws_ok(
  $$ delete from public.notifications where id='a0000000-0000-0000-0000-000000000080' $$,
  '42501', 'permission denied for table notifications',
  'authenticated cannot DELETE a notification (no client delete)');

-- ---- recipient can mark own notification read (A) ------------------------------------
select lives_ok(
  $$ update public.notifications set status='read' where id='a0000000-0000-0000-0000-000000000080' $$,
  'recipient marks own unread notification read');
select is(
  (select read_at is not null and status='read' from public.notifications where id='a0000000-0000-0000-0000-000000000080'),
  true, 'mark-read set status=read and stamped read_at');

reset role;
select * from finish();
rollback;
