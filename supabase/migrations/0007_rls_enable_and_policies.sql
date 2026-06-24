-- =============================================================================
-- Migration 0007 — RLS enable (FORCE) + policies for all 11 Phase 3A tables
-- Refs: 15_RLS_POLICY_MATRIX, 17 §8/§8A/§7A, 16 (SI-6/SI-7/SI-11), Decision Lock
--
-- Principles:
--   * Every table: RLS ENABLED + FORCE (SI-6).
--   * Tenant-scoped tables: every policy is anchored on organization_id = current_org()
--     -> cross-tenant always blocked (SI-7).
--   * Global/catalog tables (organizations root, profiles, roles, permissions,
--     role_permissions) follow §8A exceptions (no organization_id anchor).
--   * Least privilege: authenticated is NEVER granted DELETE (no-delete / append-only
--     enforced at the privilege layer too); catalog tables are read-only to clients;
--     service_role (bypassrls) is the trusted server writer.
--   * memberships has a NON-RECURSIVE base SELECT policy (§7A).
-- =============================================================================

-- ====================== organizations (tenant root) ==========================
alter table public.organizations enable row level security;
alter table public.organizations force row level security;
revoke all on public.organizations from anon, authenticated;
grant select, update on public.organizations to authenticated;
grant all on public.organizations to service_role;

create policy organizations_select on public.organizations
  for select to authenticated
  using (id = public.current_org() or public.has_support_grant(id));

create policy organizations_update on public.organizations
  for update to authenticated
  using (id = public.current_org() and public.has_permission('org.settings.write'))
  with check (id = public.current_org() and public.has_permission('org.settings.write'));
-- INSERT/DELETE: no client policy (org lifecycle via service_role/onboarding).

-- ========================= organization_settings =============================
alter table public.organization_settings enable row level security;
alter table public.organization_settings force row level security;
revoke all on public.organization_settings from anon, authenticated;
grant select, insert, update on public.organization_settings to authenticated;
grant all on public.organization_settings to service_role;

create policy organization_settings_select on public.organization_settings
  for select to authenticated
  using (organization_id = public.current_org() or public.has_support_grant(organization_id));

create policy organization_settings_insert on public.organization_settings
  for insert to authenticated
  with check (organization_id = public.current_org() and public.has_permission('org.settings.write'));

create policy organization_settings_update on public.organization_settings
  for update to authenticated
  using (organization_id = public.current_org() and public.has_permission('org.settings.write'))
  with check (organization_id = public.current_org() and public.has_permission('org.settings.write'));

-- ============================== profiles (§8A) ===============================
-- Global identity: no organization_id. Visibility = own profile OR same-org via membership.
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
revoke all on public.profiles from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_org(id));

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
-- DELETE: none (cascade from auth.users only).

-- ===================== roles / permissions / role_permissions =================
-- Global catalog (§8A): read-only to clients; writes via system migration / service_role.
alter table public.roles enable row level security;
alter table public.roles force row level security;
revoke all on public.roles from anon, authenticated;
grant select on public.roles to authenticated;
grant all on public.roles to service_role;

create policy roles_select on public.roles
  for select to authenticated
  using (true);

alter table public.permissions enable row level security;
alter table public.permissions force row level security;
revoke all on public.permissions from anon, authenticated;
grant select on public.permissions to authenticated;
grant all on public.permissions to service_role;

create policy permissions_select on public.permissions
  for select to authenticated
  using (true);

alter table public.role_permissions enable row level security;
alter table public.role_permissions force row level security;
revoke all on public.role_permissions from anon, authenticated;
grant select on public.role_permissions to authenticated;
grant all on public.role_permissions to service_role;

create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (true);
-- No client write policies (custom org catalog = V1).

-- ============================ memberships (§7A) ==============================
alter table public.memberships enable row level security;
alter table public.memberships force row level security;
revoke all on public.memberships from anon, authenticated;
grant select, insert, update on public.memberships to authenticated;
grant all on public.memberships to service_role;

-- NON-RECURSIVE base SELECT policy: self-row only, does NOT call any helper (§7A).
create policy memberships_select_self on public.memberships
  for select to authenticated
  using (profile_id = auth.uid());

-- Broad SELECT policy (OR-ed): org admins/HR/auditor see org members.
-- Helpers here are SECURITY DEFINER (bypassrls) so reading memberships does not recurse.
create policy memberships_select_org on public.memberships
  for select to authenticated
  using (
    organization_id = public.current_org()
    and (
      public.has_permission('user.invite')
      or public.has_role('hr')
      or public.has_role('owner')
      or public.has_role('admin')
      or public.has_role('auditor')
    )
  );

-- Support read (active grant only) — separate permissive policy (§13 support model, D4).
create policy memberships_select_support on public.memberships
  for select to authenticated
  using (public.has_support_grant(organization_id));

create policy memberships_insert on public.memberships
  for insert to authenticated
  with check (organization_id = public.current_org() and public.has_permission('user.invite'));

create policy memberships_update on public.memberships
  for update to authenticated
  using (organization_id = public.current_org() and public.has_permission('user.invite'))
  with check (organization_id = public.current_org() and public.has_permission('user.invite'));
-- DELETE: none (deactivate = status update; privilege not granted).

-- ================================ teams ======================================
alter table public.teams enable row level security;
alter table public.teams force row level security;
revoke all on public.teams from anon, authenticated;
grant select, insert, update on public.teams to authenticated;
grant all on public.teams to service_role;

create policy teams_select on public.teams
  for select to authenticated
  using (organization_id = public.current_org() or public.has_support_grant(organization_id));

create policy teams_insert on public.teams
  for insert to authenticated
  with check (organization_id = public.current_org() and public.has_permission('team.manage'));

create policy teams_update on public.teams
  for update to authenticated
  using (organization_id = public.current_org()
         and (public.has_permission('team.manage') or public.manages_team(id)))
  with check (organization_id = public.current_org()
         and (public.has_permission('team.manage') or public.manages_team(id)));

-- =========================== team_memberships ================================
alter table public.team_memberships enable row level security;
alter table public.team_memberships force row level security;
revoke all on public.team_memberships from anon, authenticated;
grant select, insert, update on public.team_memberships to authenticated;
grant all on public.team_memberships to service_role;

create policy team_memberships_select on public.team_memberships
  for select to authenticated
  using (
    public.has_support_grant(organization_id)
    or (
      organization_id = public.current_org()
      and (
        profile_id = auth.uid()
        or public.manages_team(team_id)
        or public.has_role('hr')
        or public.has_role('owner')
        or public.has_role('admin')
        or public.has_role('auditor')
      )
    )
  );

create policy team_memberships_insert on public.team_memberships
  for insert to authenticated
  with check (organization_id = public.current_org()
              and (public.has_permission('team.manage') or public.manages_team(team_id)));

create policy team_memberships_update on public.team_memberships
  for update to authenticated
  using (organization_id = public.current_org()
         and (public.has_permission('team.manage') or public.manages_team(team_id)))
  with check (organization_id = public.current_org()
         and (public.has_permission('team.manage') or public.manages_team(team_id)));

-- ========================= support_access_grants =============================
alter table public.support_access_grants enable row level security;
alter table public.support_access_grants force row level security;
revoke all on public.support_access_grants from anon, authenticated;
grant select, insert, update on public.support_access_grants to authenticated;
grant all on public.support_access_grants to service_role;

create policy support_access_grants_select on public.support_access_grants
  for select to authenticated
  using (organization_id = public.current_org()
         and (public.has_role('owner') or public.has_role('auditor')));

create policy support_access_grants_insert on public.support_access_grants
  for insert to authenticated
  with check (organization_id = public.current_org() and public.has_permission('support.grant'));

create policy support_access_grants_update on public.support_access_grants
  for update to authenticated
  using (organization_id = public.current_org() and public.has_permission('support.grant'))
  with check (organization_id = public.current_org() and public.has_permission('support.grant'));

-- =============================== audit_logs ==================================
-- Append-only (trigger blocks UPDATE/DELETE). Writes via SECURITY DEFINER triggers
-- / service_role only -> NO client INSERT policy and no INSERT privilege.
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;
revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (organization_id = public.current_org() and public.has_permission('audit.read'));
-- INSERT: only via log_audit() (SECURITY DEFINER) or service_role.
-- UPDATE/DELETE: blocked by trg_audit_logs_append_only + no policy + no privilege.
