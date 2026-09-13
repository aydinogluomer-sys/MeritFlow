-- =============================================================================
-- pgTAP — Phase P3 / slice 2-B: AUDITED opportunity-flag resolution on intelligence_insights.
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: migration 0049; §2.7 (resolution AUDITED), §2.8 (status lifecycle), §4.8/§4.9. Proves: the
--   authenticated UPDATE (resolution) is permitted ONLY for insight_type='opportunity_flag' AND only
--   by an intelligence.manage holder (owner/admin) OR the manager of the subject employee's PRIMARY
--   team (NO cross-team resolution); finance / the subject employee cannot resolve; cross-tenant is
--   blocked; the resolution UPDATE is AUDITED (audit_logs); permission catalog unchanged (23).
-- Fixtures (seed): a0..f9 (Org A opportunity_flag, subject emp-alpha a7 [PRIMARY team f1 managed by
--   a5], status 'reviewed') + b0..f9 (Org B). Actors: a1 owner, a2 admin (intelligence.manage);
--   a5 manager(f1); a4 finance; a7 emp-alpha (subject); b1 Org B owner.
-- =============================================================================
begin;
select no_plan();

-- ---- update-trigger + grant shape --------------------------------------------
select ok(
  exists (select 1 from pg_trigger where tgname = 'trg_audit_intelligence_insights_update'
          and tgrelid = 'public.intelligence_insights'::regclass),
  'after-update audit trigger exists on intelligence_insights (§2.7)');
select ok(has_table_privilege('authenticated', 'public.intelligence_insights', 'UPDATE'),
  'authenticated has UPDATE privilege (RLS policy scopes it to opportunity_flag resolution)');

-- ---- permission catalog unchanged (23; 2-B adds no permission) ---------------
select is((select count(*) from public.permissions), 23::bigint,
  'permission catalog unchanged at 23 (2-B adds no permission)');

set local role authenticated;

-- ---- Finance a4 (intelligence.read but NOT intelligence.manage, manages no team) CANNOT resolve ----
-- RLS UPDATE USING excludes the row → update affects 0 rows; status stays 'reviewed'.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
update public.intelligence_insights set status = 'dismissed'
  where id = 'a0000000-0000-0000-0000-0000000000f9';
select is(
  (select status from public.intelligence_insights where id = 'a0000000-0000-0000-0000-0000000000f9'),
  'reviewed', 'finance cannot resolve an opportunity_flag (RLS UPDATE denied — status unchanged)');

-- ---- Subject employee a7 (own flag, no manage, does not manage the team) CANNOT resolve ----
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
update public.intelligence_insights set status = 'dismissed'
  where id = 'a0000000-0000-0000-0000-0000000000f9';
select is(
  (select status from public.intelligence_insights where id = 'a0000000-0000-0000-0000-0000000000f9'),
  'reviewed', 'the subject employee cannot resolve their own opportunity_flag (RLS UPDATE denied)');

-- ---- Manager a6 of a DIFFERENT team (Team Beta f2) CANNOT resolve emp-alpha's flag (no cross-team) ----
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a6"}', true);
update public.intelligence_insights set status = 'dismissed'
  where id = 'a0000000-0000-0000-0000-0000000000f9';
select is(
  (select status from public.intelligence_insights where id = 'a0000000-0000-0000-0000-0000000000f9'),
  'reviewed', 'a manager of a DIFFERENT team cannot resolve another team''s opportunity_flag (no cross-team)');

-- ---- The policy is scoped to insight_type='opportunity_flag': a5 cannot resolve a policy_health insight ----
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
update public.intelligence_insights set status = 'dismissed'
  where id = 'a0000000-0000-0000-0000-0000000000f8';
select is(
  (select status from public.intelligence_insights where id = 'a0000000-0000-0000-0000-0000000000f8'),
  'reviewed', 'the resolution policy is scoped to opportunity_flag (a non-opportunity insight is not resolvable)');

-- ---- Column-restricted grant: a permitted resolver CANNOT write authoritative deterministic_payload ----
select throws_ok($$
  update public.intelligence_insights set deterministic_payload = '{}'::jsonb
  where id = 'a0000000-0000-0000-0000-0000000000f9' $$,
  '42501', NULL, 'a resolver cannot overwrite deterministic_payload (column-level grant blocks it)');

-- ---- Org A owner a1 cannot resolve the Org B flag (cross-tenant) ----
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1"}', true);
update public.intelligence_insights set status = 'dismissed'
  where id = 'b0000000-0000-0000-0000-0000000000f9';
-- (owner a1 cannot even see the Org B row; the update matches nothing.)

-- ---- Manager a5 (manages emp-alpha a7's PRIMARY team f1) CAN resolve reviewed -> dismissed ----
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
update public.intelligence_insights set status = 'dismissed', resolution_code = 'reviewed_no_action'
  where id = 'a0000000-0000-0000-0000-0000000000f9';
select is(
  (select status from public.intelligence_insights where id = 'a0000000-0000-0000-0000-0000000000f9'),
  'dismissed', 'manager of the subject PRIMARY team can resolve the opportunity_flag (reviewed -> dismissed)');
select is(
  (select resolution_code from public.intelligence_insights where id = 'a0000000-0000-0000-0000-0000000000f9'),
  'reviewed_no_action', 'the resolution reason is persisted (§2.7 — captured for the audited outcome)');

reset role;

-- ---- the resolution UPDATE was AUDITED (§2.7) --------------------------------
select ok(
  exists (select 1 from public.audit_logs al
          where al.target_id = 'a0000000-0000-0000-0000-0000000000f9'
            and al.action = 'intelligence_insights.update'
            and al.actor_id = 'a0000000-0000-0000-0000-0000000000a5'),
  'the resolution is audited WITH the resolving actor (§2.7: manager a5, non-null actor_id)');

-- ---- Org B flag remained unresolved (cross-tenant isolation held) ------------
select is(
  (select status from public.intelligence_insights where id = 'b0000000-0000-0000-0000-0000000000f9'),
  'reviewed', 'Org B opportunity_flag is untouched by Org A actors (cross-tenant isolation)');

select * from finish();
rollback;
