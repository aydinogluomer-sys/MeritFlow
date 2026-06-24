-- =============================================================================
-- Migration 0004 — Teams
-- Phase 3A: teams, team_memberships (tenant-scoped)
-- Refs: 14_DATA_DICTIONARY (org structure), Decision Lock AD9
--   - Canonical primary team = team_memberships.is_primary (at most one per
--     (organization_id, profile_id)) — AD9 single-team evaluation.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- teams (tenant-scoped)
-- -----------------------------------------------------------------------------
create table public.teams (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  status          text not null default 'active',
  manager_id      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint teams_org_name_uq unique (organization_id, name),
  constraint teams_status_chk check (status in ('active', 'archived'))
);

comment on table public.teams is
  'Team unit (tenant-scoped). manager_id drives manages_team(). Sensitivity: internal.';

create index idx_teams_org on public.teams (organization_id);
create index idx_teams_manager on public.teams (manager_id);

create trigger trg_teams_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- team_memberships (tenant-scoped); is_primary = canonical primary team (AD9)
-- -----------------------------------------------------------------------------
create table public.team_memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id         uuid not null references public.teams(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  role_in_team    text not null default 'member',
  is_primary      boolean not null default false,
  joined_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  constraint team_memberships_team_profile_uq unique (team_id, profile_id),
  constraint team_memberships_role_chk check (role_in_team in ('member', 'lead'))
);

comment on table public.team_memberships is
  'Employee<->team. is_primary marks the single evaluation team per employee (AD9).';

-- At most ONE primary team per employee per org (AD9).
create unique index uq_team_memberships_one_primary
  on public.team_memberships (organization_id, profile_id)
  where is_primary;

create index idx_team_memberships_team_profile on public.team_memberships (team_id, profile_id);
create index idx_team_memberships_profile on public.team_memberships (profile_id);
