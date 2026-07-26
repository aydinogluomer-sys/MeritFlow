-- =============================================================================
-- pgTAP — Phase 3 blocking suite: disputes + dispute_events foundation
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 07, 14/15 (disputes §), 16 (§6 dispute machine, SI-6/SI-7), ADR-006, D9.
--
-- Section A = privileged (bypassrls); Section B = RLS as authenticated. disputes is a
-- MUTABLE state machine; dispute_events is APPEND-ONLY and AUTO-written by the
-- log_dispute_event() trigger (actor_id = auth.uid()). We set request.jwt.claims so
-- auth.uid() resolves for the auto-event actor even under the bypassrls role.
--
-- Seed fixtures: Org A dispute 70 (complainant a7, decision owner a5, reviewer a6,
-- status under_review) with two auto-events (opened by a7, assigned by a3). Org B
-- dispute 70 (complainant b2, open).
-- =============================================================================
begin;
select no_plan();

-- =============================================================================
-- SECTION A — privileged (bypassrls)
-- =============================================================================

-- (#1) Tables exist.
select has_table('public', 'disputes',       'disputes table exists');
select has_table('public', 'dispute_events', 'dispute_events table exists');

-- (#2) RLS ENABLED + FORCE.
select is(
  (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
    where oid in ('public.disputes'::regclass, 'public.dispute_events'::regclass)),
  true, 'RLS ENABLED + FORCE on both (SI-6)');

-- (#3) Privileges.
select is(has_table_privilege('authenticated', 'public.disputes', 'INSERT'), true,  'disputes INSERT');
select is(has_table_privilege('authenticated', 'public.disputes', 'UPDATE'), true,  'disputes UPDATE');
select is(has_table_privilege('authenticated', 'public.disputes', 'DELETE'), false, 'disputes no DELETE');
select is(has_table_privilege('authenticated', 'public.dispute_events', 'SELECT'), true,  'dispute_events SELECT');
select is(has_table_privilege('authenticated', 'public.dispute_events', 'INSERT'), false, 'dispute_events no INSERT (auto-only)');
select is(has_table_privilege('authenticated', 'public.dispute_events', 'UPDATE'), false, 'dispute_events no UPDATE (append-only)');
select is(has_table_privilege('authenticated', 'public.dispute_events', 'DELETE'), false, 'dispute_events no DELETE (append-only)');

-- (#4) dispute permissions: open (employee) + resolve (hr + manager). The HR assign action
-- is gated on has_role('hr') — no new permission added (permission catalog stays unchanged).
select is((select count(*) from public.role_permissions where permission_key='dispute.open' and role_key='employee'),
  1::bigint, 'dispute.open granted to employee');
select is((select count(*) from public.role_permissions where permission_key='dispute.resolve'
             and role_key in ('hr','manager')),
  2::bigint, 'dispute.resolve granted to hr + manager');

-- ---- State machine (throwaway dispute 80, walked open -> ... -> closed) --------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select lives_ok(
  $$ insert into public.disputes (id, organization_id, complainant_id, dispute_type, target_type, target_id, decision_owner_id)
     values ('a0000000-0000-0000-0000-000000000080','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a7','system_error','other','a0000000-0000-0000-0000-000000000081','a0000000-0000-0000-0000-0000000000a5') $$,
  'dispute opens (status defaults to open; auto-event written)');
-- (#5) INSERT must start open.
select throws_ok(
  $$ insert into public.disputes (organization_id, complainant_id, dispute_type, target_type, target_id, status)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a7','system_error','other','a0000000-0000-0000-0000-000000000082','under_review') $$,
  '23514', 'dispute must start in status open (got under_review)', 'dispute must start in status open');
-- skip / illegal open-transitions.
select throws_ok(
  $$ update public.disputes set status='resolved' where id='a0000000-0000-0000-0000-000000000080' $$,
  '23514', 'invalid dispute transition: open -> resolved', 'skip open -> resolved rejected');
select throws_ok(
  $$ update public.disputes set status='needs_info' where id='a0000000-0000-0000-0000-000000000080' $$,
  '23514', 'invalid dispute transition: open -> needs_info', 'skip open -> needs_info rejected');
select throws_ok(
  $$ update public.disputes set status='under_review' where id='a0000000-0000-0000-0000-000000000080' $$,
  '23514', 'dispute cannot move to under_review without an assigned reviewer (D9/assign)',
  'open -> under_review without reviewer rejected');
-- identity immutability (open).
select throws_ok(
  $$ update public.disputes set complainant_id='a0000000-0000-0000-0000-0000000000a8' where id='a0000000-0000-0000-0000-000000000080' $$,
  '23001', 'dispute identity (org/complainant/type/target/opened_at) is immutable',
  'complainant_id immutable after open (identity)');
-- valid walk (HR assigns, then reviewer routes/resolves).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select lives_ok(
  $$ update public.disputes set status='under_review', assigned_reviewer_id='a0000000-0000-0000-0000-0000000000a6' where id='a0000000-0000-0000-0000-000000000080' $$,
  'open -> under_review with assigned reviewer');
select throws_ok(
  $$ update public.disputes set status='resolved' where id='a0000000-0000-0000-0000-000000000080' $$,
  '23514', 'new row for relation "disputes" violates check constraint "disputes_resolved_consistency_chk"',
  'resolve without resolution/note/resolved_at rejected');
select lives_ok(
  $$ update public.disputes set status='needs_info' where id='a0000000-0000-0000-0000-000000000080' $$,
  'under_review -> needs_info');
select lives_ok(
  $$ update public.disputes set status='under_review' where id='a0000000-0000-0000-0000-000000000080' $$,
  'needs_info -> under_review');
select lives_ok(
  $$ update public.disputes set status='resolved', resolution='rejected', decision_note='seed test rejection', resolved_at=now() where id='a0000000-0000-0000-0000-000000000080' $$,
  'under_review -> resolved with resolution + note + resolved_at');
select throws_ok(
  $$ update public.disputes set status='open' where id='a0000000-0000-0000-0000-000000000080' $$,
  '23514', 'invalid dispute transition: resolved -> open', 'reopen (resolved -> open) rejected');
select lives_ok(
  $$ update public.disputes set status='closed' where id='a0000000-0000-0000-0000-000000000080' $$,
  'resolved -> closed');
select throws_ok(
  $$ update public.disputes set status='under_review' where id='a0000000-0000-0000-0000-000000000080' $$,
  '23514', 'invalid dispute transition: closed -> under_review', 'closed -> * rejected');

-- (#6) D9 structural CHECKs.
select throws_ok(
  $$ insert into public.disputes (organization_id, complainant_id, dispute_type, target_type, target_id, decision_owner_id, assigned_reviewer_id)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a7','unfair_rejection','task','a0000000-0000-0000-0000-000000000083','a0000000-0000-0000-0000-0000000000a5','a0000000-0000-0000-0000-0000000000a5') $$,
  '23514', 'new row for relation "disputes" violates check constraint "disputes_reviewer_not_owner_chk"',
  'assigned reviewer cannot be the decision owner (D9)');
select throws_ok(
  $$ insert into public.disputes (organization_id, complainant_id, dispute_type, target_type, target_id, assigned_reviewer_id)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a7','unfair_rejection','task','a0000000-0000-0000-0000-000000000084','a0000000-0000-0000-0000-0000000000a7') $$,
  '23514', 'new row for relation "disputes" violates check constraint "disputes_reviewer_not_complainant_chk"',
  'assigned reviewer cannot be the complainant (D9)');

-- (#7) Auto-written dispute_events (seed dispute 70 walked open -> under_review).
select is((select count(*) from public.dispute_events where dispute_id='a0000000-0000-0000-0000-000000000070'),
  2::bigint, 'dispute 70 has 2 auto-events (opened + assigned)');
select ok(exists (select 1 from public.dispute_events
    where dispute_id='a0000000-0000-0000-0000-000000000070' and event_type='opened'
      and to_status='open' and actor_id='a0000000-0000-0000-0000-0000000000a7'),
  'opened event auto-written with complainant actor (a7)');
select ok(exists (select 1 from public.dispute_events
    where dispute_id='a0000000-0000-0000-0000-000000000070' and event_type='assigned'
      and from_status='open' and to_status='under_review' and actor_id='a0000000-0000-0000-0000-0000000000a3'),
  'assigned event auto-written with HR actor (a3)');

-- (#8) Append-only dispute_events + DELETE guard on disputes.
select throws_ok(
  $$ update public.dispute_events set note='x' where dispute_id='a0000000-0000-0000-0000-000000000070' $$,
  '23001', 'append-only: UPDATE on dispute_events is not permitted',
  'UPDATE on dispute_events blocked (append-only)');
select throws_ok(
  $$ delete from public.dispute_events where dispute_id='a0000000-0000-0000-0000-000000000070' $$,
  '23001', 'append-only: DELETE on dispute_events is not permitted',
  'DELETE on dispute_events blocked (append-only)');
select throws_ok(
  $$ delete from public.disputes where id='a0000000-0000-0000-0000-000000000070' $$,
  '23001', 'delete forbidden: disputes is retained (supersede only; deletion is a legal-review item)',
  'DELETE on disputes blocked (retention)');

-- (#9) SLA sanity: due_at must be after opened_at.
select throws_ok(
  $$ insert into public.disputes (organization_id, complainant_id, dispute_type, target_type, target_id, opened_at, due_at)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a7','system_error','other','a0000000-0000-0000-0000-000000000086', now(), now() - interval '1 day') $$,
  '23514', 'new row for relation "disputes" violates check constraint "disputes_due_at_chk"',
  'due_at must be after opened_at');

-- (#10) Cross-tenant composite FK negatives (SI-7).
select throws_ok(
  $$ insert into public.disputes (organization_id, complainant_id, dispute_type, target_type, target_id)
     values ('a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-0000000000b2','system_error','other','a0000000-0000-0000-0000-000000000087') $$,
  '23503', 'insert or update on table "disputes" violates foreign key constraint "disputes_complainant_org_fk"',
  'cross-org complainant rejected (SI-7)');
select throws_ok(
  $$ insert into public.disputes (organization_id, complainant_id, dispute_type, target_type, target_id, assigned_reviewer_id)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a7','system_error','other','a0000000-0000-0000-0000-000000000088','b0000000-0000-0000-0000-0000000000b2') $$,
  '23503', 'insert or update on table "disputes" violates foreign key constraint "disputes_reviewer_org_fk"',
  'cross-org reviewer rejected (SI-7)');
-- dispute_events composite FK (manual bypassrls insert): org A event -> org B dispute.
select throws_ok(
  $$ insert into public.dispute_events (organization_id, dispute_id, event_type, actor_id, to_status)
     values ('a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000070','note','a0000000-0000-0000-0000-0000000000a7','open') $$,
  '23503', 'insert or update on table "dispute_events" violates foreign key constraint "dispute_events_dispute_org_fk"',
  'cross-org dispute_event vs dispute rejected (SI-7)');

-- (#11) Audit from seed dispute 70 (insert + assign update).
select ok(exists (select 1 from public.audit_logs where target_id='a0000000-0000-0000-0000-000000000070' and action='disputes.insert'),
  'dispute insert produced an audit row');
select ok(exists (select 1 from public.audit_logs where target_id='a0000000-0000-0000-0000-000000000070' and action='disputes.update'),
  'dispute assign (update) produced an audit row');

-- (#12) D9 helper owns_review_decision.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select is(public.owns_review_decision('a0000000-0000-0000-0000-000000000070'), true,
  'owns_review_decision TRUE for the decision owner (a5) — D9');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a6"}', true);
select is(public.owns_review_decision('a0000000-0000-0000-0000-000000000070'), false,
  'owns_review_decision FALSE for the assigned reviewer (a6) — D9');

-- =============================================================================
-- SECTION B — RLS as authenticated users
-- =============================================================================
set local role authenticated;

-- ---- disputes read: complainant + assigned reviewer + HR + Auditor -------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.disputes where id='a0000000-0000-0000-0000-000000000070'),
  1::bigint, 'complainant can read own dispute');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a6"}', true);
select is((select count(*) from public.disputes where id='a0000000-0000-0000-0000-000000000070'),
  1::bigint, 'assigned reviewer can read the dispute');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.disputes where id='a0000000-0000-0000-0000-000000000070'),
  1::bigint, 'HR can read the dispute');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select is((select count(*) from public.disputes where id='a0000000-0000-0000-0000-000000000070'),
  1::bigint, 'Auditor can read the dispute');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select is((select count(*) from public.disputes where id='a0000000-0000-0000-0000-000000000070'),
  0::bigint, 'decision owner (non-reviewer/complainant) cannot read the dispute');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a8"}', true);
select is((select count(*) from public.disputes where id='a0000000-0000-0000-0000-000000000070'),
  0::bigint, 'unrelated employee cannot read the dispute');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is((select count(*) from public.disputes where id='a0000000-0000-0000-0000-000000000070'),
  0::bigint, 'Finance cannot read disputes');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000aa"}', true);
select is((select count(*) from public.disputes where id='a0000000-0000-0000-0000-000000000070'),
  0::bigint, 'support (grant) cannot read disputes');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.disputes where id='b0000000-0000-0000-0000-000000000070'),
  0::bigint, 'cross-tenant: HR A cannot read org B dispute (SI-7)');

-- ---- dispute_events read follows parent-dispute visibility ---------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.dispute_events where dispute_id='a0000000-0000-0000-0000-000000000070'),
  2::bigint, 'complainant sees own dispute events');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a6"}', true);
select is((select count(*) from public.dispute_events where dispute_id='a0000000-0000-0000-0000-000000000070'),
  2::bigint, 'assigned reviewer sees dispute events');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a8"}', true);
select is((select count(*) from public.dispute_events where dispute_id='a0000000-0000-0000-0000-000000000070'),
  0::bigint, 'unrelated employee cannot see dispute events');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select is((select count(*) from public.dispute_events where dispute_id='a0000000-0000-0000-0000-000000000070'),
  0::bigint, 'decision owner (non-viewer) cannot see dispute events');

-- ---- write authz: open (complainant self) + resolve (assigned reviewer) --------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a8"}', true);
select lives_ok(
  $$ insert into public.disputes (id, organization_id, complainant_id, dispute_type, target_type, target_id)
     values ('a0000000-0000-0000-0000-000000000085','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a8','missing_task_credit','task','a0000000-0000-0000-0000-000000000089') $$,
  'employee opens OWN dispute (dispute.open + complainant=self)');
select throws_ok(
  $$ insert into public.disputes (organization_id, complainant_id, dispute_type, target_type, target_id)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a7','missing_task_credit','task','a0000000-0000-0000-0000-00000000008a') $$,
  '42501', 'new row violates row-level security policy for table "disputes"',
  'employee cannot open a dispute for another complainant');
-- HR cannot perform the resolve act (must be the assigned reviewer).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select throws_ok(
  $$ update public.disputes set status='resolved', resolution='accepted', decision_note='hr', resolved_at=now() where id='a0000000-0000-0000-0000-000000000070' $$,
  '42501', 'new row violates row-level security policy for table "disputes"',
  'HR cannot resolve (only the assigned reviewer resolves — D9)');
-- Assigned reviewer a6 resolves the dispute.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a6"}', true);
select lives_ok(
  $$ update public.disputes set status='resolved', resolution='rejected', decision_note='reviewer decision', resolved_at=now() where id='a0000000-0000-0000-0000-000000000070' $$,
  'assigned reviewer (≠ decision owner) can resolve');
-- HR assigns a reviewer to the employee-opened dispute (open -> under_review).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select lives_ok(
  $$ update public.disputes set status='under_review', assigned_reviewer_id='a0000000-0000-0000-0000-0000000000a5' where id='a0000000-0000-0000-0000-000000000085' $$,
  'HR (dispute.assign) assigns a reviewer and moves to under_review');

reset role;
select * from finish();
rollback;
