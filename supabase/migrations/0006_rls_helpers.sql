-- =============================================================================
-- Migration 0006 — RLS helper functions  (RECURSIVE-RLS SAFE — see plan §7A)
-- Phase 3A: current_org, has_role, has_permission, manages_team,
--           has_support_grant, shares_org (profiles support helper)
-- Refs: 15_RLS_POLICY_MATRIX (helpers), 17 §7A, Decision Lock AD1
--
-- RECURSIVE RLS MITIGATION (binding — §7A):
--   * SECURITY DEFINER ALONE is not enough under FORCE RLS. These functions are
--     owned by the migration role (postgres, BYPASSRLS), so their internal reads
--     of memberships/role_permissions DO NOT re-enter RLS policies → no recursion.
--   * As a second guard, migration 0007 gives `memberships` a NON-RECURSIVE base
--     SELECT policy (profile_id = auth.uid()) that does NOT call these helpers.
--   * The owner role (postgres/BYPASSRLS) is NEVER the client/anon/service_role.
--   * Every function pins a fixed empty search_path.
--   * Authorization is read from DB here, never from JWT (AD1); auth.uid() is
--     identity only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- current_org(): active organization for the session.
--   * If GUC app.current_org is set, return it ONLY when the caller has an
--     active membership there (server sets it after verifying membership).
--   * Otherwise fall back to the caller's (single) active membership org.
-- -----------------------------------------------------------------------------
create or replace function public.current_org()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claimed uuid;
  v_result  uuid;
begin
  begin
    v_claimed := nullif(current_setting('app.current_org', true), '')::uuid;
  exception when others then
    v_claimed := null;
  end;

  if v_claimed is not null then
    select m.organization_id into v_result
    from public.memberships m
    where m.profile_id = auth.uid()
      and m.organization_id = v_claimed
      and m.status = 'active'
    limit 1;
    return v_result;  -- null if caller has no active membership in claimed org
  end if;

  select m.organization_id into v_result
  from public.memberships m
  where m.profile_id = auth.uid()
    and m.status = 'active'
  order by m.joined_at asc
  limit 1;
  return v_result;
end;
$$;

comment on function public.current_org() is
  'Active org for session (GUC app.current_org validated against active membership, '
  'else single active membership). SECURITY DEFINER + fixed search_path (§7A).';

-- -----------------------------------------------------------------------------
-- has_role(role_key): caller has this primary_role in current_org().
-- -----------------------------------------------------------------------------
create or replace function public.has_role(role_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.profile_id = auth.uid()
      and m.organization_id = public.current_org()
      and m.status = 'active'
      and m.primary_role = role_key
  );
$$;

comment on function public.has_role(text) is
  'True if caller holds the given primary_role in current_org (DB lookup, AD1).';

-- -----------------------------------------------------------------------------
-- has_permission(perm_key): caller's primary_role grants this permission.
-- -----------------------------------------------------------------------------
create or replace function public.has_permission(perm_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.role_permissions rp on rp.role_key = m.primary_role
    where m.profile_id = auth.uid()
      and m.organization_id = public.current_org()
      and m.status = 'active'
      and rp.permission_key = perm_key
  );
$$;

comment on function public.has_permission(text) is
  'True if caller''s primary_role maps to the permission (role_permissions, AD1).';

-- -----------------------------------------------------------------------------
-- manages_team(team_id): caller is the manager of this team in current_org().
-- -----------------------------------------------------------------------------
create or replace function public.manages_team(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.teams t
    where t.id = p_team_id
      and t.organization_id = public.current_org()
      and t.manager_id = auth.uid()
  );
$$;

comment on function public.manages_team(uuid) is
  'True if caller is manager_id of the team within current_org.';

-- -----------------------------------------------------------------------------
-- has_support_grant(org): caller has an active, unexpired support grant for org.
-- -----------------------------------------------------------------------------
create or replace function public.has_support_grant(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.support_access_grants g
    where g.organization_id = p_org
      and g.grantee_id = auth.uid()
      and g.status = 'active'
      and g.expires_at > now()
  );
$$;

comment on function public.has_support_grant(uuid) is
  'True if caller has an active, unexpired support grant for the org (D4).';

-- -----------------------------------------------------------------------------
-- shares_org(profile): target profile has an active membership in current_org().
-- Support helper for profiles same-org visibility (§8A). SECURITY DEFINER so it
-- can read other users'' membership rows without tripping memberships RLS.
-- -----------------------------------------------------------------------------
create or replace function public.shares_org(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.profile_id = p_profile
      and m.organization_id = public.current_org()
      and m.status = 'active'
  );
$$;

comment on function public.shares_org(uuid) is
  'True if target profile shares the caller''s current_org via active membership (§8A profiles visibility).';

-- -----------------------------------------------------------------------------
-- Least-privilege EXECUTE grants. Callers (authenticated) need EXECUTE even
-- though the body runs as the definer. anon gets nothing.
-- -----------------------------------------------------------------------------
revoke execute on function
  public.current_org(),
  public.has_role(text),
  public.has_permission(text),
  public.manages_team(uuid),
  public.has_support_grant(uuid),
  public.shares_org(uuid)
from public, anon;

grant execute on function
  public.current_org(),
  public.has_role(text),
  public.has_permission(text),
  public.manages_team(uuid),
  public.has_support_grant(uuid),
  public.shares_org(uuid)
to authenticated, service_role;
