-- =============================================================================
-- pgTAP — Phase P2 / slice 1-A: policy_health_evaluations (incentive-health evaluation store).
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: migration 0046; §3.3/§3.4/§3.6/§3.9; §26 (Health gate: NO OPAQUE SCORE). Proves: RLS
--   ENABLE+FORCE + least-priv grants; read gated by policy.manage; cross-tenant isolation (org A vs
--   org B) — BLOCKING; server-only writes; append-only IMMUTABILITY (UPDATE/DELETE blocked); audited
--   on INSERT; same-org composite FK to scoring_policy_versions rejects cross-org; unique guard;
--   overall_score range 0–100; the stored breakdown is a transparent object (no opaque score);
--   permission catalog unchanged (23).
-- Fixtures (seed): a0..eb (Org A, version d2) + b0..eb (Org B, version b-d2), rule_set 'health-v1'.
--   Actors: a1 owner + a3 hr (policy.manage) read; a4 finance / a7 employee / a9 auditor cannot; b1 owner.
-- =============================================================================
begin;
select no_plan();

-- ---- table + RLS shape -------------------------------------------------------
select has_table('public', 'policy_health_evaluations', 'policy_health_evaluations table exists');
select ok(
  (select relrowsecurity from pg_class where relname = 'policy_health_evaluations' and relnamespace = 'public'::regnamespace),
  'RLS ENABLED on policy_health_evaluations');
select ok(
  (select relforcerowsecurity from pg_class where relname = 'policy_health_evaluations' and relnamespace = 'public'::regnamespace),
  'RLS FORCED on policy_health_evaluations');

-- ---- least-privilege grants (server-only writes) -----------------------------
select ok(has_table_privilege('authenticated', 'public.policy_health_evaluations', 'SELECT'),
  'authenticated may SELECT');
select ok(not has_table_privilege('authenticated', 'public.policy_health_evaluations', 'INSERT'),
  'authenticated may NOT INSERT (server-only writes)');
select ok(not has_table_privilege('authenticated', 'public.policy_health_evaluations', 'UPDATE'),
  'authenticated may NOT UPDATE (immutable)');
select ok(not has_table_privilege('authenticated', 'public.policy_health_evaluations', 'DELETE'),
  'authenticated may NOT DELETE (immutable)');

-- ---- permission catalog unchanged (23; 1-A reuses policy.manage, adds no permission) --------------
select is((select count(*) from public.permissions), 23::bigint,
  'permission catalog unchanged at 23 (1-A reuses policy.manage)');

-- ---- score contract: overall in range + transparent (object, not opaque) breakdown (§26) ----------
select is(
  (select count(*) from public.policy_health_evaluations
   where overall_score < 0 or overall_score > 100), 0::bigint,
  'every overall_score is within the 0–100 health range');
select is(
  (select jsonb_typeof(dimensions) from public.policy_health_evaluations
   where id = 'a0000000-0000-0000-0000-0000000000eb'), 'object',
  'dimensions is a transparent structured object (items + weights), never an opaque number');
-- NO OPAQUE SCORE (§26): the seeded overall (95) is the published weighted mean of the stored
-- sub-scores — re-derive it from dimensions.items + dimensions.weights and confirm equality.
select is(
  (select round(
     sum((item->>'score')::numeric * (w->>'weight')::numeric)
     / sum((w->>'weight')::numeric))
   from public.policy_health_evaluations e
   cross join lateral jsonb_array_elements(e.dimensions->'items') as item
   join lateral jsonb_array_elements(e.dimensions->'weights') as w
     on w->>'dimension' = item->>'dimension'
   where e.id = 'a0000000-0000-0000-0000-0000000000eb'),
  (select overall_score from public.policy_health_evaluations
   where id = 'a0000000-0000-0000-0000-0000000000eb'),
  'overall_score is re-derivable from the stored sub-scores + weights (no opaque score, §26)');

-- =============================================================================
-- RLS reads (switch to authenticated). Read is gated by policy.manage (owner/admin/hr).
-- =============================================================================
set local role authenticated;

-- Owner a1 (policy.manage) sees the Org A evaluation; NONE of Org B (cross-tenant isolation).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1"}', true);
select ok((select count(*) from public.policy_health_evaluations) >= 1,
  'RLS: owner (policy.manage) sees Org A evaluation(s)');
select is((select count(*) from public.policy_health_evaluations
           where organization_id = 'b0000000-0000-0000-0000-000000000002'::uuid), 0::bigint,
  'RLS: owner cannot see Org B evaluations (cross-tenant isolation)');

-- HR a3 (policy.manage) also sees Org A.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select ok((select count(*) from public.policy_health_evaluations) >= 1,
  'RLS: HR (policy.manage) sees Org A evaluation(s)');

-- Finance a4, employee a7, auditor a9 (NO policy.manage) see NONE.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is((select count(*) from public.policy_health_evaluations), 0::bigint,
  'RLS: finance (no policy.manage) sees nothing');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.policy_health_evaluations), 0::bigint,
  'RLS: employee (no policy.manage) sees nothing');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select is((select count(*) from public.policy_health_evaluations), 0::bigint,
  'RLS: auditor (no policy.manage) sees nothing');

-- Org B owner b1 sees only the Org B evaluation (isolation, other direction).
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-0000000000b1"}', true);
select is((select count(*) from public.policy_health_evaluations
           where organization_id = 'a0000000-0000-0000-0000-000000000001'::uuid), 0::bigint,
  'RLS: Org B owner cannot see Org A evaluations (cross-tenant isolation)');
select ok((select count(*) from public.policy_health_evaluations) >= 1,
  'RLS: Org B owner sees the Org B evaluation');

reset role;

-- =============================================================================
-- Immutability + audit + same-org FK + unique (bypassrls; triggers apply universally).
-- =============================================================================
-- UPDATE blocked (prevent_mutation — reproducible/immutable).
select throws_ok($$
  update public.policy_health_evaluations set overall_score = 1
  where id = 'a0000000-0000-0000-0000-0000000000eb' $$,
  NULL, 'policy_health_evaluations UPDATE is blocked (immutable)');

-- DELETE blocked (prevent_mutation).
select throws_ok($$
  delete from public.policy_health_evaluations where id = 'a0000000-0000-0000-0000-0000000000eb' $$,
  NULL, 'policy_health_evaluations DELETE is blocked (immutable)');

-- INSERT is audited (the seed insert produced an audit_logs row).
select ok(
  exists (select 1 from public.audit_logs al
          where al.target_id = 'a0000000-0000-0000-0000-0000000000eb'
            and al.action = 'policy_health_evaluations.insert'),
  'the evaluation INSERT is written to audit_logs (policy_health_evaluations.insert)');

-- Reproducibility guard: one evaluation per (policy_version_id, rule_set_version).
select throws_ok($$
  insert into public.policy_health_evaluations
    (organization_id, policy_version_id, rule_set_version, overall_score, dimensions)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d2',
          'health-v1', 50, '{"items":[],"weights":[],"deferred":[]}'::jsonb) $$,
  '23505', NULL, 'unique (policy_version_id, rule_set_version) — no silent overwrite');

-- Same-org composite FK: an Org A evaluation cannot reference an Org B scoring version -> 23503.
select throws_ok($$
  insert into public.policy_health_evaluations
    (organization_id, policy_version_id, rule_set_version, overall_score, dimensions)
  values ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000d2',
          'health-v2', 50, '{"items":[],"weights":[],"deferred":[]}'::jsonb) $$,
  '23503', NULL, 'same-org FK: Org A evaluation cannot reference an Org B scoring version');

-- Range CHECK: an out-of-range overall_score is rejected (0–100 health range).
select throws_ok($$
  insert into public.policy_health_evaluations
    (organization_id, policy_version_id, rule_set_version, overall_score, dimensions)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d2',
          'health-range', 101, '{"items":[],"weights":[],"deferred":[]}'::jsonb) $$,
  '23514', NULL, 'overall_score > 100 rejected (0–100 health range CHECK)');

select * from finish();
rollback;
