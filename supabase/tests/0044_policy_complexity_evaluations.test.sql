-- =============================================================================
-- pgTAP — Phase P1 / slice 4-A: policy_complexity_evaluations (static-complexity evaluation store).
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: migration 0045; plan §6.9; §26 (Policy Debt gate). Proves: RLS ENABLE+FORCE + least-priv
--   grants; read gated by policy.manage; cross-tenant isolation (org A vs org B) — BLOCKING;
--   server-only writes; append-only IMMUTABILITY (UPDATE/DELETE blocked); audited on INSERT; same-org
--   composite FK to scoring_policy_versions rejects cross-org; permission catalog unchanged (23).
-- Fixtures (seed): a0..ea (Org A, version d2) + b0..ea (Org B, version b-d2). Actors: a1 owner + a3 hr
--   (policy.manage) can read; a4 finance / a7 employee / a9 auditor (no policy.manage) cannot; b1 owner.
-- =============================================================================
begin;
select no_plan();

-- ---- table + RLS shape -------------------------------------------------------
select has_table('public', 'policy_complexity_evaluations', 'policy_complexity_evaluations table exists');
select ok(
  (select relrowsecurity from pg_class where relname = 'policy_complexity_evaluations' and relnamespace = 'public'::regnamespace),
  'RLS ENABLED on policy_complexity_evaluations');
select ok(
  (select relforcerowsecurity from pg_class where relname = 'policy_complexity_evaluations' and relnamespace = 'public'::regnamespace),
  'RLS FORCED on policy_complexity_evaluations');

-- ---- least-privilege grants (server-only writes) -----------------------------
select ok(has_table_privilege('authenticated', 'public.policy_complexity_evaluations', 'SELECT'),
  'authenticated may SELECT');
select ok(not has_table_privilege('authenticated', 'public.policy_complexity_evaluations', 'INSERT'),
  'authenticated may NOT INSERT (server-only writes)');
select ok(not has_table_privilege('authenticated', 'public.policy_complexity_evaluations', 'UPDATE'),
  'authenticated may NOT UPDATE (immutable)');
select ok(not has_table_privilege('authenticated', 'public.policy_complexity_evaluations', 'DELETE'),
  'authenticated may NOT DELETE (immutable)');

-- ---- permission catalog unchanged (23; 4-A adds no permission) --------------
select is((select count(*) from public.permissions), 23::bigint,
  'permission catalog unchanged at 23 (4-A reuses policy.manage)');

-- =============================================================================
-- RLS reads (switch to authenticated). Read is gated by policy.manage (owner/admin/hr).
-- =============================================================================
set local role authenticated;

-- Owner a1 (policy.manage) sees the Org A evaluation; NONE of Org B (cross-tenant isolation).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1"}', true);
select ok((select count(*) from public.policy_complexity_evaluations) >= 1,
  'RLS: owner (policy.manage) sees Org A evaluation(s)');
select is((select count(*) from public.policy_complexity_evaluations
           where organization_id = 'b0000000-0000-0000-0000-000000000002'::uuid), 0::bigint,
  'RLS: owner cannot see Org B evaluations (cross-tenant isolation)');

-- HR a3 (policy.manage) also sees Org A.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select ok((select count(*) from public.policy_complexity_evaluations) >= 1,
  'RLS: HR (policy.manage) sees Org A evaluation(s)');

-- Finance a4, employee a7, auditor a9 (NO policy.manage) see NONE.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is((select count(*) from public.policy_complexity_evaluations), 0::bigint,
  'RLS: finance (no policy.manage) sees nothing');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.policy_complexity_evaluations), 0::bigint,
  'RLS: employee (no policy.manage) sees nothing');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select is((select count(*) from public.policy_complexity_evaluations), 0::bigint,
  'RLS: auditor (no policy.manage) sees nothing');

-- Org B owner b1 sees only the Org B evaluation (isolation, other direction).
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-0000000000b1"}', true);
select is((select count(*) from public.policy_complexity_evaluations
           where organization_id = 'a0000000-0000-0000-0000-000000000001'::uuid), 0::bigint,
  'RLS: Org B owner cannot see Org A evaluations (cross-tenant isolation)');
select ok((select count(*) from public.policy_complexity_evaluations) >= 1,
  'RLS: Org B owner sees the Org B evaluation');

reset role;

-- =============================================================================
-- Immutability + audit + same-org FK (bypassrls; triggers apply universally).
-- =============================================================================
-- UPDATE blocked (prevent_mutation — reproducible/immutable).
select throws_ok($$
  update public.policy_complexity_evaluations set static_score = 999
  where id = 'a0000000-0000-0000-0000-0000000000ea' $$,
  NULL, 'policy_complexity_evaluations UPDATE is blocked (immutable)');

-- DELETE blocked (prevent_mutation).
select throws_ok($$
  delete from public.policy_complexity_evaluations where id = 'a0000000-0000-0000-0000-0000000000ea' $$,
  NULL, 'policy_complexity_evaluations DELETE is blocked (immutable)');

-- INSERT is audited (the seed insert produced an audit_logs row).
select ok(
  exists (select 1 from public.audit_logs al
          where al.target_id = 'a0000000-0000-0000-0000-0000000000ea'
            and al.action = 'policy_complexity_evaluations.insert'),
  'the evaluation INSERT is written to audit_logs (policy_complexity_evaluations.insert)');

-- Reproducibility guard: one evaluation per (policy_version_id, rule_set_version).
select throws_ok($$
  insert into public.policy_complexity_evaluations
    (organization_id, policy_version_id, rule_set_version, static_score, total_score, components)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d2',
          'static-v1', 1, 1, '[]'::jsonb) $$,
  '23505', NULL, 'unique (policy_version_id, rule_set_version) — no silent overwrite');

-- Same-org composite FK: an Org A evaluation cannot reference an Org B scoring version -> 23503.
select throws_ok($$
  insert into public.policy_complexity_evaluations
    (organization_id, policy_version_id, rule_set_version, static_score, total_score, components)
  values ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000d2',
          'static-v2', 1, 1, '[]'::jsonb) $$,
  '23503', NULL, 'same-org FK: Org A evaluation cannot reference an Org B scoring version');

select * from finish();
rollback;
