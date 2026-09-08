-- =============================================================================
-- pgTAP — Phase P1 / slice 6-B: policy_change_impacts (append-only impact artifact) + scoring parity.
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: migration 0044; plan §8.5/§8.8; §26 gate. Proves: RLS ENABLE+FORCE + least-priv grants;
--   cross-tenant isolation (org A vs org B) — BLOCKING; read gated by policy.impact.read; IMMUTABILITY
--   (UPDATE/DELETE blocked); audited on INSERT; same-org composite FK to policy_change_requests;
--   permission catalog unchanged (23). Plus the SCORING-MIRROR PARITY anchor: the seeded Org C worked
--   example's point_ledger.points_delta (real 0020 scoring) equals the golden value the TS mirror
--   produces (Ali task 210 = 1000), and compute_final_points reproduces it.
-- Fixtures (seed): impacts a0..e6 (Org A, request cf, period 30) + b0..e6 (Org B). Actors: a1 owner,
--   a3 hr, a5 manager, a7 employee, a9 auditor (policy.impact.read: owner/hr/finance/auditor); b1 owner.
-- =============================================================================
begin;
select no_plan();

-- ---- table + RLS shape -------------------------------------------------------
select has_table('public', 'policy_change_impacts', 'policy_change_impacts table exists');
select ok(
  (select relrowsecurity from pg_class where relname = 'policy_change_impacts' and relnamespace = 'public'::regnamespace),
  'RLS ENABLED on policy_change_impacts');
select ok(
  (select relforcerowsecurity from pg_class where relname = 'policy_change_impacts' and relnamespace = 'public'::regnamespace),
  'RLS FORCED on policy_change_impacts');

-- ---- least-privilege grants (server-only writes) -----------------------------
select ok(has_table_privilege('authenticated', 'public.policy_change_impacts', 'SELECT'),
  'authenticated may SELECT');
select ok(not has_table_privilege('authenticated', 'public.policy_change_impacts', 'INSERT'),
  'authenticated may NOT INSERT (server-only writes)');
select ok(not has_table_privilege('authenticated', 'public.policy_change_impacts', 'UPDATE'),
  'authenticated may NOT UPDATE (immutable)');
select ok(not has_table_privilege('authenticated', 'public.policy_change_impacts', 'DELETE'),
  'authenticated may NOT DELETE (immutable)');

-- ---- permission catalog unchanged (23; 6-B adds no permission) --------------
select is((select count(*) from public.permissions), 23::bigint,
  'permission catalog unchanged at 23 (6-B adds no permission)');

-- ---- scoring-mirror PARITY anchor (Org C worked example) --------------------
-- The seed scored Ali's task 210 (base 1000, low/low/good/on_time, rev 0) via the REAL 0020 engine.
-- The TS mirror produces 1000 for those inputs; assert the DB agrees (point_ledger + compute_final_points).
select is(
  (select points_delta from public.point_ledger
     where task_id = 'a0000000-0000-0000-0000-000000000210' and event_type = 'task_approved'),
  1000::numeric, 'mirror parity: point_ledger points_delta for Ali task 210 = 1000 (mirror agrees)');
select is(
  public.compute_final_points(
    1000::numeric,
    (select multipliers from public.scoring_policy_versions where id = 'c0000000-0000-0000-0000-0000000000d2'),
    (select revision_penalty_rule from public.scoring_policy_versions where id = 'c0000000-0000-0000-0000-0000000000d2'),
    'low', 'low', 'good', 'on_time', 0),
  1000::numeric, 'mirror parity: compute_final_points(base 1000, low/low/good/on_time) = 1000');
-- A revision-penalty golden the mirror must also match: base 100, medium/high/good/on_time under the
-- standard multipliers = 100 × 1.25 × 1.5 × 1 × 1 × (1 − 0) = 187.5.
select is(
  public.compute_final_points(
    100::numeric,
    (select multipliers from public.scoring_policy_versions where id = 'c0000000-0000-0000-0000-0000000000d2'),
    (select revision_penalty_rule from public.scoring_policy_versions where id = 'c0000000-0000-0000-0000-0000000000d2'),
    'medium', 'high', 'good', 'on_time', 0),
  187.5::numeric, 'mirror parity: compute_final_points(base 100, medium/high) = 187.5');

-- =============================================================================
-- RLS reads (switch to authenticated).
-- =============================================================================
set local role authenticated;

-- HR a3 (policy.impact.read) sees the Org A impact; NONE of Org B (cross-tenant isolation).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select ok((select count(*) from public.policy_change_impacts) >= 1,
  'RLS: HR (policy.impact.read) sees Org A impact artifact(s)');
select is((select count(*) from public.policy_change_impacts
           where organization_id = 'b0000000-0000-0000-0000-000000000002'::uuid), 0::bigint,
  'RLS: HR cannot see Org B impacts (cross-tenant isolation)');

-- Employee a7 + Manager a5 (no policy.impact.read) see NONE.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.policy_change_impacts), 0::bigint,
  'RLS: employee (no policy.impact.read) sees nothing');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select is((select count(*) from public.policy_change_impacts), 0::bigint,
  'RLS: manager (no policy.impact.read) sees nothing');

-- Auditor a9 (policy.impact.read) sees the Org A impact.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select ok((select count(*) from public.policy_change_impacts) >= 1,
  'RLS: auditor (policy.impact.read) sees Org A impact artifact(s)');

-- Org B owner b1 sees only the Org B impact (isolation, other direction).
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-0000000000b1"}', true);
select is((select count(*) from public.policy_change_impacts
           where organization_id = 'a0000000-0000-0000-0000-000000000001'::uuid), 0::bigint,
  'RLS: Org B owner cannot see Org A impacts (cross-tenant isolation)');
select ok((select count(*) from public.policy_change_impacts) >= 1,
  'RLS: Org B owner sees the Org B impact');

reset role;

-- =============================================================================
-- Immutability + audit + same-org FK (bypassrls; trigger guarantees apply universally).
-- =============================================================================
-- UPDATE blocked (prevent_mutation — immutable artifact).
select throws_ok($$
  update public.policy_change_impacts set impact_version = 2
  where id = 'a0000000-0000-0000-0000-0000000000e6' $$,
  NULL, 'policy_change_impacts UPDATE is blocked (immutable)');

-- DELETE blocked (prevent_mutation — immutable artifact).
select throws_ok($$
  delete from public.policy_change_impacts where id = 'a0000000-0000-0000-0000-0000000000e6' $$,
  NULL, 'policy_change_impacts DELETE is blocked (immutable)');

-- INSERT is audited (the seed insert produced an audit_logs row).
select ok(
  exists (select 1 from public.audit_logs al
          where al.target_id = 'a0000000-0000-0000-0000-0000000000e6'
            and al.action = 'policy_change_impacts.insert'),
  'the impact INSERT is written to audit_logs (policy_change_impacts.insert)');

-- Same-org composite FK: an Org A impact cannot reference Org B's change request -> 23503.
select throws_ok($$
  insert into public.policy_change_impacts
    (organization_id, change_request_id, reference_period_id, impact_version,
     from_version_id, to_draft_version_id, financial_impact, employee_distribution)
  values ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000cf',
          'a0000000-0000-0000-0000-000000000030', 9,
          'a0000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000d3',
          '{}'::jsonb, '[]'::jsonb) $$,
  '23503', NULL, 'same-org FK: Org A impact cannot reference an Org B change request');

select * from finish();
rollback;
