-- =============================================================================
-- pgTAP — Phase 3 blocking suite: anti_gaming_flags foundation
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 08, 14/15 (anti_gaming_flags §), 16 (§7 flag machine, SI-6/SI-7), ADR-006, D5.
--
-- Section A = privileged (bypassrls); Section B = RLS as authenticated. Flags are a
-- MUTABLE review lifecycle; INSERT is server-only (rule engine). D5: a confirmed flag
-- has NO automatic financial effect — the table is isolated from all ledgers, proven by
-- asserting point_ledger / bonus_ledger counts do not change when a flag is confirmed.
--
-- Seed fixtures: Org A flag 90 (duplicate_task, subject a7/team f1/mgr a5, open);
-- flag 91 (period_end_spike, subject a8, confirmed by a6). Org B flag 90 (open).
-- =============================================================================
begin;
select no_plan();

-- =============================================================================
-- SECTION A — privileged (bypassrls)
-- =============================================================================

-- (#1) Table exists.
select has_table('public', 'anti_gaming_flags', 'anti_gaming_flags table exists');

-- (#2) RLS ENABLED + FORCE.
select is(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.anti_gaming_flags'::regclass),
  true, 'RLS ENABLED + FORCE on anti_gaming_flags (SI-6)');

-- (#3) Privileges: SELECT/UPDATE yes; INSERT server-only; no DELETE.
select is(has_table_privilege('authenticated', 'public.anti_gaming_flags', 'SELECT'), true,  'flags SELECT');
select is(has_table_privilege('authenticated', 'public.anti_gaming_flags', 'UPDATE'), true,  'flags UPDATE');
select is(has_table_privilege('authenticated', 'public.anti_gaming_flags', 'INSERT'), false, 'flags no INSERT (server-only)');
select is(has_table_privilege('authenticated', 'public.anti_gaming_flags', 'DELETE'), false, 'flags no DELETE');

-- (#4) State machine (throwaway flag 92, walked open -> reviewing -> confirmed).
select lives_ok(
  $$ insert into public.anti_gaming_flags (id, organization_id, rule, subject_employee_id)
     values ('a0000000-0000-0000-0000-000000000092','a0000000-0000-0000-0000-000000000001','tiny_task_splitting','a0000000-0000-0000-0000-0000000000a7') $$,
  'flag opens (status defaults to open)');
select throws_ok(
  $$ insert into public.anti_gaming_flags (organization_id, rule, subject_employee_id, status)
     values ('a0000000-0000-0000-0000-000000000001','duplicate_task','a0000000-0000-0000-0000-0000000000a7','reviewing') $$,
  '23514', 'anti_gaming_flag must start in status open (got reviewing)', 'flag must start open');
select throws_ok(
  $$ update public.anti_gaming_flags set status='confirmed' where id='a0000000-0000-0000-0000-000000000092' $$,
  '23514', 'invalid anti_gaming_flag transition: open -> confirmed', 'skip open -> confirmed rejected');
select throws_ok(
  $$ update public.anti_gaming_flags set status='dismissed' where id='a0000000-0000-0000-0000-000000000092' $$,
  '23514', 'invalid anti_gaming_flag transition: open -> dismissed', 'skip open -> dismissed rejected');
select lives_ok(
  $$ update public.anti_gaming_flags set status='reviewing' where id='a0000000-0000-0000-0000-000000000092' $$,
  'open -> reviewing');
select throws_ok(
  $$ update public.anti_gaming_flags set status='open' where id='a0000000-0000-0000-0000-000000000092' $$,
  '23514', 'invalid anti_gaming_flag transition: reviewing -> open', 'reviewing -> open rejected');
select throws_ok(
  $$ update public.anti_gaming_flags set status='confirmed' where id='a0000000-0000-0000-0000-000000000092' $$,
  '23514', 'new row for relation "anti_gaming_flags" violates check constraint "anti_gaming_flags_review_consistency_chk"',
  'confirm without reviewed_by/review_note rejected');
select lives_ok(
  $$ update public.anti_gaming_flags set status='confirmed', reviewed_by='a0000000-0000-0000-0000-0000000000a5', review_note='ok' where id='a0000000-0000-0000-0000-000000000092' $$,
  'reviewing -> confirmed with reviewed_by + note');
select throws_ok(
  $$ update public.anti_gaming_flags set status='dismissed' where id='a0000000-0000-0000-0000-000000000092' $$,
  '23514', 'invalid anti_gaming_flag transition: confirmed -> dismissed', 'confirmed -> dismissed rejected (terminal cannot transition)');
select throws_ok(
  $$ update public.anti_gaming_flags set review_note='changed' where id='a0000000-0000-0000-0000-000000000092' $$,
  '23001', 'confirmed/dismissed anti_gaming_flag is immutable', 'confirmed flag fields are immutable (terminal no-op)');
-- identity immutability (open flag 90).
select throws_ok(
  $$ update public.anti_gaming_flags set rule='period_end_spike' where id='a0000000-0000-0000-0000-000000000090' $$,
  '23001', 'anti_gaming_flag identity (org/rule/subject/related/evidence/created_at) is immutable',
  'rule immutable after insert (identity)');

-- (#5) Review consistency + reviewer <> subject.
select throws_ok(
  $$ insert into public.anti_gaming_flags (organization_id, rule, subject_employee_id, reviewed_by, review_note)
     values ('a0000000-0000-0000-0000-000000000001','duplicate_task','a0000000-0000-0000-0000-0000000000a7','a0000000-0000-0000-0000-0000000000a5','x') $$,
  '23514', 'new row for relation "anti_gaming_flags" violates check constraint "anti_gaming_flags_review_consistency_chk"',
  'open flag cannot carry reviewed_by/review_note');
insert into public.anti_gaming_flags (id, organization_id, rule, subject_employee_id)
  values ('a0000000-0000-0000-0000-000000000093','a0000000-0000-0000-0000-000000000001','duplicate_task','a0000000-0000-0000-0000-0000000000a7');
update public.anti_gaming_flags set status='reviewing' where id='a0000000-0000-0000-0000-000000000093';
select throws_ok(
  $$ update public.anti_gaming_flags set status='confirmed', reviewed_by='a0000000-0000-0000-0000-0000000000a7', review_note='self' where id='a0000000-0000-0000-0000-000000000093' $$,
  '23514', 'new row for relation "anti_gaming_flags" violates check constraint "anti_gaming_flags_reviewer_not_subject_chk"',
  'reviewer cannot be the subject');

-- (#6) D5: confirming a flag produces NO financial side effect (no ledger rows).
create temp table _agf_d5 as
  select (select count(*) from public.point_ledger) as pl,
         (select count(*) from public.bonus_ledger) as bl;
insert into public.anti_gaming_flags (id, organization_id, rule, subject_employee_id)
  values ('a0000000-0000-0000-0000-000000000094','a0000000-0000-0000-0000-000000000001','same_reviewer_concentration','a0000000-0000-0000-0000-0000000000a7');
update public.anti_gaming_flags set status='reviewing' where id='a0000000-0000-0000-0000-000000000094';
update public.anti_gaming_flags set status='confirmed', reviewed_by='a0000000-0000-0000-0000-0000000000a5', review_note='confirmed'
  where id='a0000000-0000-0000-0000-000000000094';
select is((select count(*) from public.point_ledger), (select pl from _agf_d5),
  'confirming a flag adds NO point_ledger rows (D5 — no auto-punish)');
select is((select count(*) from public.bonus_ledger), (select bl from _agf_d5),
  'confirming a flag adds NO bonus_ledger rows (D5 — no auto-punish)');

-- (#7) Cross-tenant composite FK negatives (SI-7).
select throws_ok(
  $$ insert into public.anti_gaming_flags (organization_id, rule, subject_employee_id)
     values ('a0000000-0000-0000-0000-000000000001','duplicate_task','b0000000-0000-0000-0000-0000000000b2') $$,
  '23503', 'insert or update on table "anti_gaming_flags" violates foreign key constraint "anti_gaming_flags_subject_org_fk"',
  'cross-org subject rejected (SI-7)');
select throws_ok(
  $$ insert into public.anti_gaming_flags (organization_id, rule, subject_employee_id, related_reviewer_id)
     values ('a0000000-0000-0000-0000-000000000001','same_reviewer_concentration','a0000000-0000-0000-0000-0000000000a7','b0000000-0000-0000-0000-0000000000b2') $$,
  '23503', 'insert or update on table "anti_gaming_flags" violates foreign key constraint "anti_gaming_flags_reviewer_org_fk"',
  'cross-org related_reviewer rejected (SI-7)');

-- (#8) DELETE blocked (retention).
select throws_ok(
  $$ delete from public.anti_gaming_flags where id='a0000000-0000-0000-0000-000000000090' $$,
  '23001', 'delete forbidden: anti_gaming_flags is retained (supersede only; deletion is a legal-review item)',
  'DELETE on anti_gaming_flags blocked (retention)');

-- (#9) Audit from seed flags.
select ok(exists (select 1 from public.audit_logs where target_id='a0000000-0000-0000-0000-000000000090' and action='anti_gaming_flags.insert'),
  'flag insert produced an audit row');
select ok(exists (select 1 from public.audit_logs where target_id='a0000000-0000-0000-0000-000000000091' and action='anti_gaming_flags.update'),
  'flag confirm (update) produced an audit row');

-- Throwaway flag 95 left at 'reviewing' for the Section B reviewed_by=self test.
insert into public.anti_gaming_flags (id, organization_id, rule, subject_employee_id)
  values ('a0000000-0000-0000-0000-000000000095','a0000000-0000-0000-0000-000000000001','duplicate_task','a0000000-0000-0000-0000-0000000000a7');
update public.anti_gaming_flags set status='reviewing' where id='a0000000-0000-0000-0000-000000000095';

-- =============================================================================
-- SECTION B — RLS as authenticated users
-- =============================================================================
set local role authenticated;

-- ---- read: subject-own + own-team Manager + HR + Auditor -----------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.anti_gaming_flags where id='a0000000-0000-0000-0000-000000000090'),
  1::bigint, 'subject can read own flag');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select is((select count(*) from public.anti_gaming_flags where id='a0000000-0000-0000-0000-000000000090'),
  1::bigint, 'own-team manager can read the flag (manages_team(team_of(subject)))');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a6"}', true);
select is((select count(*) from public.anti_gaming_flags where id='a0000000-0000-0000-0000-000000000090'),
  0::bigint, 'other-team manager cannot read the flag');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.anti_gaming_flags where id='a0000000-0000-0000-0000-000000000090'),
  1::bigint, 'HR can read the flag');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select is((select count(*) from public.anti_gaming_flags where id='a0000000-0000-0000-0000-000000000090'),
  1::bigint, 'Auditor can read the flag');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is((select count(*) from public.anti_gaming_flags where id='a0000000-0000-0000-0000-000000000090'),
  0::bigint, 'Finance cannot read flags');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000aa"}', true);
select is((select count(*) from public.anti_gaming_flags where id='a0000000-0000-0000-0000-000000000090'),
  0::bigint, 'support (grant) cannot read flags');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a8"}', true);
select is((select count(*) from public.anti_gaming_flags where id='a0000000-0000-0000-0000-000000000090'),
  0::bigint, 'unrelated employee cannot read another subject flag');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.anti_gaming_flags where id='b0000000-0000-0000-0000-000000000090'),
  0::bigint, 'cross-tenant: HR A cannot read org B flag (SI-7)');

-- ---- review authz: own-team manager confirms; reviewed_by must be the actor ----------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select lives_ok(
  $$ update public.anti_gaming_flags set status='reviewing' where id='a0000000-0000-0000-0000-000000000090' $$,
  'own-team manager can move flag open -> reviewing');
select lives_ok(
  $$ update public.anti_gaming_flags set status='confirmed', reviewed_by='a0000000-0000-0000-0000-0000000000a5', review_note='confirmed by manager' where id='a0000000-0000-0000-0000-000000000090' $$,
  'own-team manager can confirm (reviewed_by = self)');
-- HR can target (has_role hr) but the recorded reviewer must be the actor.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select throws_ok(
  $$ update public.anti_gaming_flags set status='confirmed', reviewed_by='a0000000-0000-0000-0000-0000000000a5', review_note='hr' where id='a0000000-0000-0000-0000-000000000095' $$,
  '42501', 'new row violates row-level security policy for table "anti_gaming_flags"',
  'reviewer must record themselves (reviewed_by = auth.uid)');

-- ---- server-only INSERT: no authenticated INSERT (no privilege) ----------------------
select throws_ok(
  $$ insert into public.anti_gaming_flags (organization_id, rule, subject_employee_id)
     values ('a0000000-0000-0000-0000-000000000001','duplicate_task','a0000000-0000-0000-0000-0000000000a7') $$,
  '42501', 'permission denied for table anti_gaming_flags',
  'authenticated cannot INSERT a flag (server-only)');

reset role;
select * from finish();
rollback;
