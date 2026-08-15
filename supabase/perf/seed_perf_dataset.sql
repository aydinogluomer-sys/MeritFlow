-- =============================================================================
-- ENGINEERING-10 — ICP performance dataset generator (NOT a migration; not run by
-- `supabase db reset` / migration-lint / drift / the pgTAP suite). Applied on demand by
-- scripts/perf-benchmark.sh against a local/CI Supabase. Never production (ADR-014).
--
-- Approach (deliberate scope): inject realistic VOLUME into the seeded Org C
-- (c...003) — the two largest, seq-scan-risk read surfaces `tasks` and `point_ledger`
-- — rather than bootstrapping a fresh N-employee org (auth.users + scoring-policy jsonb +
-- the engine pipeline, none of which can be verified without a live DB). Org C already has
-- employees, a team, and a published scoring policy from the seed; all ids are fetched
-- dynamically so nothing is hard-coded. Volume is what triggers seq-scans; employee
-- cardinality (Org C's seeded members) is sufficient to exercise the index paths.
--
-- Scale: reads the `perf.scale` GUC (rows to generate per big table); default 1000
-- ("expected" ICP: ~50 employees × ~20 tasks). scripts/perf-benchmark.sh sets it via
-- PGOPTIONS for the 3x / 10x profiles. Insert-only (point_ledger is append-only): a fresh
-- CI reset yields clean volume; a local re-run simply adds more.
-- =============================================================================
do $$
declare
  v_org     uuid := 'c0000000-0000-0000-0000-000000000003';
  v_scale   int  := coalesce(nullif(current_setting('perf.scale', true), '')::int, 1000);
  v_team    uuid;
  v_version uuid;
  v_members uuid[];
  v_creator uuid;
  v_emp     uuid;
  v_rev     uuid;
  v_cx      text;
  v_im      text;
  i         int;
  cxs       text[] := array['low', 'medium', 'high', 'critical'];
  ims       text[] := array['low', 'medium', 'high', 'strategic'];
begin
  select id into v_team from public.teams where organization_id = v_org order by created_at limit 1;
  select id into v_version from public.scoring_policy_versions
    where organization_id = v_org and status = 'published' order by version_no desc limit 1;
  select array_agg(profile_id) into v_members from public.memberships where organization_id = v_org;

  if v_team is null or v_members is null or array_length(v_members, 1) is null then
    raise exception 'perf seed: Org C base data missing (team/members) — was the seed applied?';
  end if;
  v_creator := v_members[1];

  for i in 1..v_scale loop
    v_emp := v_members[1 + (i % array_length(v_members, 1))];
    v_rev := v_members[1 + ((i + 1) % array_length(v_members, 1))];
    v_cx  := cxs[1 + (i % 4)];
    v_im  := ims[1 + (i % 4)];

    -- tasks: status 'assigned' (no review trigger dependency). Marked title for identifiability.
    insert into public.tasks
      (id, organization_id, team_id, title, status, created_by, assigned_to, reviewer_id,
       complexity, impact, base_points, scoring_policy_version_id)
    values
      (gen_random_uuid(), v_org, v_team, 'perf: task ' || i, 'assigned', v_creator, v_emp, v_rev,
       v_cx, v_im, 10 + (i % 90), v_version);

    -- point_ledger: manual_adjustment is the only directly-insertable event_type (task_approved
    -- is trigger-written). reverses_entry_id must be null for manual_adjustment.
    insert into public.point_ledger
      (id, organization_id, employee_id, event_type, points_delta, reason,
       scoring_policy_version_id, reverses_entry_id, created_by)
    values
      (gen_random_uuid(), v_org, v_emp, 'manual_adjustment', 1 + (i % 50), 'perf: adj ' || i,
       v_version, null, v_creator);
  end loop;

  raise notice 'perf seed: inserted % tasks + % point_ledger rows into Org C (scale=%)',
    v_scale, v_scale, v_scale;
end $$;
