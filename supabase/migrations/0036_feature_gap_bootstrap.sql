-- =============================================================================
-- Migration 0036 — ENGINEERING-00.5 FEATURE-GAP: golden-path bootstrap
-- Refs: 0033 (create_organization), 0004 (teams/team_memberships), 0006 (manages_team),
--       0008 (scoring_policies/versions), 0019 (tasks lifecycle), 0011 (bonus periods/pools),
--       seed_test_tenants.sql (team + published scoring policy reference), 0035 (base data).
--
-- Purpose: make a freshly created org golden-path-ready. Two changes:
--   (1a) grant the owner role task.create + task.assign (so an owner can create/assign
--        tasks — 0035 grants owner org/team/period/policy/support/audit but NOT these).
--   (1b) redefine create_organization (0033 is append-only, so CREATE OR REPLACE): PRESERVE
--        every existing insert, then atomically add a default TEAM (owner as manager +
--        primary team_membership) and a default scoring_policy + PUBLISHED policy version
--        (so task approval can score — AD7 requires a published version), plus an
--        'org.bootstrap' audit row.
--
-- All new work runs in the same SECURITY DEFINER (bypassrls) + `set search_path = ''`
-- context as 0033, using v_org_id + auth.uid(). Idempotent under `db reset`. Local
-- dev/staging only (ADR-014). RLS + append-only + snapshot invariants untouched.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (1a) Owner gets task.create + task.assign (golden-path task authoring).
--      permission rows themselves are seeded in 0035 (task.create/task.assign exist).
-- -----------------------------------------------------------------------------
insert into public.role_permissions (role_key, permission_key)
values ('owner', 'task.create'), ('owner', 'task.assign')
on conflict (role_key, permission_key) do nothing;

-- -----------------------------------------------------------------------------
-- (1b) create_organization: PRESERVE 0033 body verbatim, then bootstrap a default
--      team + owner team-membership + a published scoring policy version + audit.
-- -----------------------------------------------------------------------------
create or replace function public.create_organization(
  p_name         text,
  p_slug         text,
  p_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id    uuid;
  v_team_id   uuid;
  v_policy_id uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if p_slug !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' then
    raise exception 'invalid_slug_format' using errcode = '22023';
  end if;

  insert into public.organizations (name, slug)
  values (p_name, p_slug)
  returning id into v_org_id;

  insert into public.profiles (id, display_name)
  values (auth.uid(), p_display_name)
  on conflict (id) do nothing;

  insert into public.memberships (organization_id, profile_id, primary_role, status)
  values (v_org_id, auth.uid(), 'owner', 'active');

  insert into public.audit_logs (organization_id, actor_id, action, target_type, target_id)
  values (v_org_id, auth.uid(), 'org.created', 'organizations', v_org_id);

  -- ---------------------------------------------------------------------------
  -- Default team 'Genel'. manager_id = owner so manages_team(v_team_id) is TRUE
  -- (0006 checks teams.manager_id = auth.uid()). The owner also gets a PRIMARY
  -- team_membership (AD9: primary team = team_memberships.is_primary).
  -- ---------------------------------------------------------------------------
  insert into public.teams (organization_id, name, manager_id)
  values (v_org_id, 'Genel', auth.uid())
  returning id into v_team_id;

  insert into public.team_memberships
    (organization_id, team_id, profile_id, role_in_team, is_primary)
  values (v_org_id, v_team_id, auth.uid(), 'lead', true);

  -- ---------------------------------------------------------------------------
  -- Default scoring policy + PUBLISHED v1 (AD7): task approval needs a published
  -- version to score. Multiplier/penalty config mirrors seed_test_tenants.sql.
  -- created_by/published_by = owner (owner holds policy.manage via 0035).
  -- ---------------------------------------------------------------------------
  insert into public.scoring_policies (organization_id, name, status, created_by)
  values (v_org_id, 'Default Scoring', 'active', auth.uid())
  returning id into v_policy_id;

  insert into public.scoring_policy_versions
    (organization_id, scoring_policy_id, version_no, status,
     multipliers, revision_penalty_rule, timeliness_thresholds,
     published_at, published_by, created_by)
  values (
    v_org_id, v_policy_id, 1, 'published',
    '{"complexity":{"low":1.0,"medium":1.25,"high":1.5,"critical":2.0},"impact":{"low":1.0,"medium":1.2,"high":1.5,"strategic":2.0},"quality":{"acceptable":0.75,"good":1.0,"excellent":1.25,"poor":0},"timeliness":{"early":1.1,"on_time":1.0,"late_minor":0.85,"late_major":0.5}}'::jsonb,
    '{"rate_per_revision":0.05,"cap":0.25}'::jsonb,
    '{}'::jsonb,
    now(), auth.uid(), auth.uid()
  );

  insert into public.audit_logs (organization_id, actor_id, action, target_type, target_id)
  values (v_org_id, auth.uid(), 'org.bootstrap', 'organizations', v_org_id);

  return v_org_id;
end;
$$;

comment on function public.create_organization(text, text, text) is
  'Onboarding bootstrap: creates org + owner membership + default team (owner=manager, '
  'primary membership) + default published scoring policy version + audit, atomically '
  '(SECURITY DEFINER, bypasses RLS). Multi-org allowed per Decision Lock — no double-join guard.';

-- Least-privilege grants preserved (server-only; authenticated-only EXECUTE).
revoke execute on function public.create_organization(text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text) to authenticated;
