-- =============================================================================
-- pgTAP — Phase P1 / slice 6-A: policy_change_requests (Policy Change Impact governance).
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: migration 0043; plan §8.2/§8.7/§8.11; §26 gate (published version never mutated).
-- Proves: RLS ENABLE+FORCE + least-priv grants; cross-tenant isolation (org A vs org B) — BLOCKING;
--   read gated by policy.impact.read; create gated by policy.manage; DUAL HR/Finance approval role
--   gating + auto-approve; approval mutation AUDITED; state-machine + retroactive (§8.11) rules;
--   published scoring_policy_version cannot be mutated (§8.2/§26); permission catalog = 23.
-- Fixtures (seed): Org A request a0..cf (submitted; from published d2 -> draft d3 of policy d1),
--   requested_by HR a3. Org B request b0..cf. Actors: a1 owner(policy.manage), a3 hr, a4 finance,
--   a5 manager, a7 employee, a9 auditor; b1 owner (Org B).
-- =============================================================================
begin;
select no_plan();

-- ---- table + RLS shape -------------------------------------------------------
select has_table('public', 'policy_change_requests', 'policy_change_requests table exists');
select ok(
  (select relrowsecurity from pg_class where relname = 'policy_change_requests' and relnamespace = 'public'::regnamespace),
  'RLS ENABLED on policy_change_requests');
select ok(
  (select relforcerowsecurity from pg_class where relname = 'policy_change_requests' and relnamespace = 'public'::regnamespace),
  'RLS FORCED on policy_change_requests');

-- ---- least-privilege grants --------------------------------------------------
select ok(has_table_privilege('authenticated', 'public.policy_change_requests', 'SELECT'),
  'authenticated may SELECT');
select ok(has_table_privilege('authenticated', 'public.policy_change_requests', 'INSERT'),
  'authenticated may INSERT (RLS gates by policy.manage)');
select ok(has_table_privilege('authenticated', 'public.policy_change_requests', 'UPDATE'),
  'authenticated may UPDATE (RLS + trigger gate)');
select ok(not has_table_privilege('authenticated', 'public.policy_change_requests', 'DELETE'),
  'authenticated may NOT DELETE');

-- ---- permission catalog (22 -> 23) ------------------------------------------
select is((select count(*) from public.permissions), 23::bigint,
  'permission catalog is 23 (P1 6-A added policy.impact.read)');
select is((select count(*) from public.permissions where key = 'policy.impact.read'), 1::bigint,
  'policy.impact.read exists');
select is((select count(*) from public.role_permissions
           where permission_key = 'policy.impact.read' and role_key = 'employee'), 0::bigint,
  'employee does NOT hold policy.impact.read');

-- =============================================================================
-- RLS reads (switch to authenticated).
-- =============================================================================
set local role authenticated;

-- HR a3 (policy.impact.read) sees the Org A request; NONE of Org B (cross-tenant isolation).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select ok((select count(*) from public.policy_change_requests) >= 1,
  'RLS: HR (policy.impact.read) sees Org A change request(s)');
select is((select count(*) from public.policy_change_requests
           where organization_id = 'b0000000-0000-0000-0000-000000000002'::uuid), 0::bigint,
  'RLS: HR cannot see Org B change requests (cross-tenant isolation)');
select is((select organization_id from public.policy_change_requests limit 1),
  'a0000000-0000-0000-0000-000000000001'::uuid, 'RLS: visible rows are Org A only');

-- Employee a7 (no policy.impact.read) sees NONE.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.policy_change_requests), 0::bigint,
  'RLS: employee (no policy.impact.read) sees nothing');

-- Manager a5 (no policy.impact.read) sees NONE.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select is((select count(*) from public.policy_change_requests), 0::bigint,
  'RLS: manager (no policy.impact.read) sees nothing');

-- Auditor a9 (policy.impact.read) sees the Org A request.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select ok((select count(*) from public.policy_change_requests) >= 1,
  'RLS: auditor (policy.impact.read) sees Org A change request(s)');

-- Org B owner b1 sees only the Org B request (isolation, other direction).
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-0000000000b1"}', true);
select is((select count(*) from public.policy_change_requests
           where organization_id = 'a0000000-0000-0000-0000-000000000001'::uuid), 0::bigint,
  'RLS: Org B owner cannot see Org A change requests (cross-tenant isolation)');
select ok((select count(*) from public.policy_change_requests) >= 1,
  'RLS: Org B owner sees the Org B change request');

-- =============================================================================
-- INSERT gating (create = policy.manage) + §8.11 retroactive + version relationship.
-- =============================================================================
-- Employee a7 (no policy.manage) cannot create a request -> 42501 (RLS with_check).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select throws_ok($$
  insert into public.policy_change_requests
    (organization_id, scoring_policy_id, from_version_id, to_draft_version_id, reason, requested_by)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d1',
          'a0000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000d3',
          'emp cannot create', 'a0000000-0000-0000-0000-0000000000a7') $$,
  '42501', NULL, 'RLS: employee without policy.manage cannot create a change request');

-- HR a3 (policy.manage) with a PAST effective_date and allow_retroactive=false -> 23514 (§8.11).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select throws_ok($$
  insert into public.policy_change_requests
    (organization_id, scoring_policy_id, from_version_id, to_draft_version_id, reason, requested_by,
     effective_date, allow_retroactive)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d1',
          'a0000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000d3',
          'retroactive', 'a0000000-0000-0000-0000-0000000000a3', date '2020-01-01', false) $$,
  '23514', NULL, 'retroactive effective_date blocked when allow_retroactive=false (§8.11)');

-- =============================================================================
-- Dual HR/Finance approval role gating on the seeded submitted Org A request (a0..cf).
-- =============================================================================
-- Finance a4 passes RLS (has finance role) but stamping the HR slot -> trigger 42501.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select throws_ok($$
  update public.policy_change_requests set hr_approved_by = 'a0000000-0000-0000-0000-0000000000a4'
  where id = 'a0000000-0000-0000-0000-0000000000cf' $$,
  '42501', NULL, 'non-HR (finance) cannot stamp the HR approval slot');

-- Owner a1 (policy.manage) stamping the HR slot -> trigger 42501 (owner is not HR).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1"}', true);
select throws_ok($$
  update public.policy_change_requests set hr_approved_by = 'a0000000-0000-0000-0000-0000000000a1'
  where id = 'a0000000-0000-0000-0000-0000000000cf' $$,
  '42501', NULL, 'non-HR (owner) cannot stamp the HR approval slot');

-- Reject without a decision_note -> 23514.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select throws_ok($$
  update public.policy_change_requests set status = 'rejected'
  where id = 'a0000000-0000-0000-0000-0000000000cf' $$,
  '23514', NULL, 'reject requires a decision_note');

-- Direct submitted -> approved without both approvals -> 23514.
select throws_ok($$
  update public.policy_change_requests set status = 'approved'
  where id = 'a0000000-0000-0000-0000-0000000000cf' $$,
  '23514', NULL, 'approval requires BOTH hr and finance approvals');

-- HR a3 stamps the HR slot (self) -> succeeds; status stays submitted; hr_approved_at set.
select lives_ok($$
  update public.policy_change_requests set hr_approved_by = 'a0000000-0000-0000-0000-0000000000a3'
  where id = 'a0000000-0000-0000-0000-0000000000cf' $$,
  'HR approves (self-stamp) succeeds');
select is((select status from public.policy_change_requests where id = 'a0000000-0000-0000-0000-0000000000cf'),
  'submitted', 'still submitted after a single (HR) approval');
select ok((select hr_approved_at is not null from public.policy_change_requests
           where id = 'a0000000-0000-0000-0000-0000000000cf'),
  'hr_approved_at was stamped by the trigger');

-- Approval mutation is AUDITED (a3 can read audit_logs via audit.read).
select ok(
  exists (select 1 from public.audit_logs al
          where al.target_id = 'a0000000-0000-0000-0000-0000000000cf'
            and al.action = 'policy_change_requests.update'
            and al.actor_id = 'a0000000-0000-0000-0000-0000000000a3'),
  'the HR approval UPDATE is written to audit_logs (actor = a3)');

-- Finance a4 stamps the Finance slot -> BOTH present -> auto-promote to approved.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select lives_ok($$
  update public.policy_change_requests set finance_approved_by = 'a0000000-0000-0000-0000-0000000000a4'
  where id = 'a0000000-0000-0000-0000-0000000000cf' $$,
  'Finance approves (self-stamp) succeeds');
select is((select status from public.policy_change_requests where id = 'a0000000-0000-0000-0000-0000000000cf'),
  'approved', 'both approvals present -> auto-promoted to approved');
select ok((select decided_at is not null from public.policy_change_requests
           where id = 'a0000000-0000-0000-0000-0000000000cf'),
  'decided_at stamped on approval');

-- An approved (terminal) request is immutable.
select throws_ok($$
  update public.policy_change_requests set reason = 'tamper'
  where id = 'a0000000-0000-0000-0000-0000000000cf' $$,
  '23001', NULL, 'an approved change request is immutable');

reset role;

-- =============================================================================
-- §8.2 / §26 gate: a PUBLISHED scoring_policy_version can NEVER be mutated (defense-in-depth;
-- this slice only READS published versions). Enforced by the 0008 immutability trigger.
-- =============================================================================
select throws_ok($$
  update public.scoring_policy_versions set notes = 'tamper'
  where id = 'a0000000-0000-0000-0000-0000000000d2' $$,
  '23001', NULL, 'published scoring_policy_version cannot be mutated (§8.2/§26)');

-- DELETE is blocked (prevent_delete) even for a bypassrls writer.
select throws_ok($$
  delete from public.policy_change_requests where id = 'a0000000-0000-0000-0000-0000000000cf' $$,
  NULL, 'policy_change_requests DELETE is blocked (prevent_delete)');

select * from finish();
rollback;
