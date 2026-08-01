-- =============================================================================
-- Seed — Phase 3A test tenants (DEV/STAGING ONLY — never production)
-- Refs: 17 §10, 04_ROLE_PERMISSION_MATRIX, Decision Lock D4/AD1/AD2/AD9
--
-- Deterministic UUIDs for reproducible RLS / cross-tenant tests.
-- Two tenants: Org A (acme) and Org B (globex).
-- Support actors have NO membership; they reach Org A only via grants (D4):
--   * support_active  -> active grant
--   * support_expired -> time-expired grant (tests expires_at > now()).
-- Runs as the migration role (bypassrls); audit triggers auto-produce audit rows.
-- Intended for `supabase db reset`; on-conflict guards make re-runs safe.
-- =============================================================================

-- --------------------------------- roles -------------------------------------
insert into public.roles (key, label) values
  ('owner',    'Organization Owner'),
  ('admin',    'Admin'),
  ('hr',       'HR Manager'),
  ('finance',  'Finance Manager'),
  ('manager',  'Team Manager'),
  ('employee', 'Employee'),
  ('auditor',  'Auditor')
on conflict (key) do nothing;

-- ------------------------------ permissions ----------------------------------
insert into public.permissions (key, label, domain, is_sensitive) values
  ('org.settings.write', 'Edit org settings',     'organizations', false),
  ('user.invite',        'Invite / manage users', 'users',         false),
  ('team.manage',        'Manage teams',          'teams',         false),
  ('task.create',        'Create tasks',          'tasks',         false),
  ('task.assign',        'Assign tasks',          'tasks',         false),
  ('task.submit',        'Submit own task',       'tasks',         false),
  ('task.review',        'Review tasks',          'reviews',       false),
  ('point.override',     'Manual point override', 'scoring',       false),
  ('period.manage',      'Manage bonus periods',  'bonus',         false),
  ('pool.create',        'Create bonus pool',     'bonus',         false),
  ('calculation.approve','Approve calculation',   'bonus',         false),
  ('payout.export',      'Export payout',         'bonus',         false),
  ('payout.mark_paid',   'Mark payout paid',      'bonus',         false),
  ('clawback.review',    'Review clawback',       'bonus',         false),
  ('dispute.open',       'Open dispute',          'disputes',      false),
  ('dispute.resolve',    'Resolve dispute',       'disputes',      false),
  ('audit.read',         'Read audit log',        'audit',         false),
  ('comp.read',          'Read compensation',     'compensation',  true),
  ('support.grant',      'Grant support access',  'governance',    false)
on conflict (key) do nothing;

-- ---------------------------- role_permissions -------------------------------
-- 3A-relevant keys exercised by RLS: org.settings.write, user.invite, team.manage,
-- audit.read, support.grant. Others are seeded forward-compatibly.
-- Finance is intentionally NOT granted audit.read in 3A (financial-subset filter
-- is a later slice; see 15_RLS_POLICY_MATRIX).
insert into public.role_permissions (role_key, permission_key)
select r, p from (values
  ('owner','org.settings.write'), ('owner','user.invite'), ('owner','team.manage'),
  ('owner','period.manage'), ('owner','support.grant'), ('owner','audit.read'),
  ('admin','user.invite'), ('admin','team.manage'), ('admin','audit.read'),
  ('hr','period.manage'), ('hr','calculation.approve'), ('hr','dispute.resolve'),
  ('hr','audit.read'), ('hr','comp.read'),
  ('finance','pool.create'), ('finance','payout.export'), ('finance','payout.mark_paid'),
  ('finance','clawback.review'), ('finance','comp.read'),
  ('manager','task.create'), ('manager','task.assign'), ('manager','task.review'),
  ('manager','dispute.resolve'),
  ('employee','task.submit'), ('employee','dispute.open'),
  ('auditor','audit.read')
) as rp(r, p)
on conflict (role_key, permission_key) do nothing;

-- ------------------------------ auth.users -----------------------------------
-- Minimal auth users so profiles.id FK (-> auth.users) is satisfiable.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       u.email, extensions.crypt('password123', extensions.gen_salt('bf')),
       now(), now(), now(), '', '', '', ''
from (values
  ('a0000000-0000-0000-0000-0000000000a1'::uuid, 'owner-a@acme.test'),
  ('a0000000-0000-0000-0000-0000000000a2'::uuid, 'admin-a@acme.test'),
  ('a0000000-0000-0000-0000-0000000000a3'::uuid, 'hr-a@acme.test'),
  ('a0000000-0000-0000-0000-0000000000a4'::uuid, 'finance-a@acme.test'),
  ('a0000000-0000-0000-0000-0000000000a5'::uuid, 'mgr-alpha-a@acme.test'),
  ('a0000000-0000-0000-0000-0000000000a6'::uuid, 'mgr-beta-a@acme.test'),
  ('a0000000-0000-0000-0000-0000000000a7'::uuid, 'emp-alpha-a@acme.test'),
  ('a0000000-0000-0000-0000-0000000000a8'::uuid, 'emp-beta-a@acme.test'),
  ('a0000000-0000-0000-0000-0000000000a9'::uuid, 'auditor-a@acme.test'),
  ('a0000000-0000-0000-0000-0000000000aa'::uuid, 'support-active@meritflow.test'),
  ('a0000000-0000-0000-0000-0000000000ab'::uuid, 'support-expired@meritflow.test'),
  ('b0000000-0000-0000-0000-0000000000b1'::uuid, 'owner-b@globex.test'),
  ('b0000000-0000-0000-0000-0000000000b2'::uuid, 'emp-b@globex.test')
) as u(id, email)
on conflict (id) do nothing;

-- ------------------------------- profiles ------------------------------------
insert into public.profiles (id, display_name, alias)
select p.id, p.name, p.alias from (values
  ('a0000000-0000-0000-0000-0000000000a1'::uuid, 'Owner A',          'owner-a'),
  ('a0000000-0000-0000-0000-0000000000a2'::uuid, 'Admin A',          'admin-a'),
  ('a0000000-0000-0000-0000-0000000000a3'::uuid, 'HR A',             'hr-a'),
  ('a0000000-0000-0000-0000-0000000000a4'::uuid, 'Finance A',        'finance-a'),
  ('a0000000-0000-0000-0000-0000000000a5'::uuid, 'Manager Alpha',    'mgr-alpha'),
  ('a0000000-0000-0000-0000-0000000000a6'::uuid, 'Manager Beta',     'mgr-beta'),
  ('a0000000-0000-0000-0000-0000000000a7'::uuid, 'Employee Alpha',   'emp-alpha'),
  ('a0000000-0000-0000-0000-0000000000a8'::uuid, 'Employee Beta',    'emp-beta'),
  ('a0000000-0000-0000-0000-0000000000a9'::uuid, 'Auditor A',        'auditor-a'),
  ('a0000000-0000-0000-0000-0000000000aa'::uuid, 'Support Active',   'support-active'),
  ('a0000000-0000-0000-0000-0000000000ab'::uuid, 'Support Expired',  'support-expired'),
  ('b0000000-0000-0000-0000-0000000000b1'::uuid, 'Owner B',          'owner-b'),
  ('b0000000-0000-0000-0000-0000000000b2'::uuid, 'Employee B',       'emp-b')
) as p(id, name, alias)
on conflict (id) do nothing;

-- ----------------------------- organizations ---------------------------------
insert into public.organizations (id, name, slug) values
  ('a0000000-0000-0000-0000-000000000001', 'Acme A',   'acme'),
  ('b0000000-0000-0000-0000-000000000002', 'Globex B', 'globex')
on conflict (slug) do nothing;

insert into public.organization_settings (organization_id, cap_rate_default) values
  ('a0000000-0000-0000-0000-000000000001', 0.50),
  ('b0000000-0000-0000-0000-000000000002', 0.50)
on conflict (organization_id) do nothing;

-- ------------------------------ memberships ----------------------------------
-- Org A (support actors deliberately excluded — D4 default no access).
insert into public.memberships (organization_id, profile_id, primary_role)
select o, p, r from (values
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-0000000000a1'::uuid, 'owner'),
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-0000000000a2'::uuid, 'admin'),
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-0000000000a3'::uuid, 'hr'),
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-0000000000a4'::uuid, 'finance'),
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-0000000000a5'::uuid, 'manager'),
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-0000000000a6'::uuid, 'manager'),
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-0000000000a7'::uuid, 'employee'),
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-0000000000a8'::uuid, 'employee'),
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-0000000000a9'::uuid, 'auditor'),
  ('b0000000-0000-0000-0000-000000000002'::uuid, 'b0000000-0000-0000-0000-0000000000b1'::uuid, 'owner'),
  ('b0000000-0000-0000-0000-000000000002'::uuid, 'b0000000-0000-0000-0000-0000000000b2'::uuid, 'employee')
) as m(o, p, r)
on conflict (organization_id, profile_id) do nothing;

-- --------------------------------- teams -------------------------------------
insert into public.teams (id, organization_id, name, manager_id) values
  ('a0000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000001', 'Team Alpha',
   'a0000000-0000-0000-0000-0000000000a5'),
  ('a0000000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-000000000001', 'Team Beta',
   'a0000000-0000-0000-0000-0000000000a6')
on conflict (organization_id, name) do nothing;

-- ---------------------------- team_memberships -------------------------------
insert into public.team_memberships (organization_id, team_id, profile_id, role_in_team, is_primary)
select o, t, p, ro, pr from (values
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-0000000000f1'::uuid,
   'a0000000-0000-0000-0000-0000000000a5'::uuid, 'lead',   true),
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-0000000000f1'::uuid,
   'a0000000-0000-0000-0000-0000000000a7'::uuid, 'member', true),
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-0000000000f2'::uuid,
   'a0000000-0000-0000-0000-0000000000a6'::uuid, 'lead',   true),
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-0000000000f2'::uuid,
   'a0000000-0000-0000-0000-0000000000a8'::uuid, 'member', true)
) as tm(o, t, p, ro, pr)
on conflict (team_id, profile_id) do nothing;

-- ------------------------- support_access_grants -----------------------------
-- Active grant (support-active can read Org A) + time-expired grant
-- (support-expired cannot — expires_at < now(); created_at < expires_at to
-- satisfy the expiry check constraint).
insert into public.support_access_grants
  (organization_id, grantee_id, scope, granted_by, expires_at, status, created_at)
values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000aa', 'read',
   'a0000000-0000-0000-0000-0000000000a1', now() + interval '30 days', 'active', now()),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000ab', 'read',
   'a0000000-0000-0000-0000-0000000000a1', now() - interval '1 day',   'active', now() - interval '60 days');

-- =============================================================================
-- Phase 3B-A seed — scoring policies (DEV/STAGING ONLY)
-- Refs: 18 §8 / §5.5 decision 1. Adds the policy.manage permission + role mapping
-- (owner/admin/hr only) and deterministic scoring policy/version fixtures.
-- NOTE: this raises the global permission catalog to 20 rows (was 19).
-- =============================================================================

-- policy.manage permission (scoring domain) — catalog addition.
insert into public.permissions (key, label, domain, is_sensitive) values
  ('policy.manage', 'Manage scoring policy', 'scoring', false)
on conflict (key) do nothing;

-- Grant policy.manage to owner/admin/hr ONLY (NOT manager/finance/employee/auditor).
insert into public.role_permissions (role_key, permission_key)
select r, p from (values
  ('owner', 'policy.manage'),
  ('admin', 'policy.manage'),
  ('hr',    'policy.manage')
) as rp(r, p)
on conflict (role_key, permission_key) do nothing;

-- scoring_policies: Org A (acme) + Org B (globex, for cross-tenant tests).
insert into public.scoring_policies (id, organization_id, name, status, created_by) values
  ('a0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000001',
   'Default Scoring', 'active', 'a0000000-0000-0000-0000-0000000000a3'),
  ('b0000000-0000-0000-0000-0000000000d1', 'b0000000-0000-0000-0000-000000000002',
   'Default Scoring', 'active', 'b0000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

-- scoring_policy_versions: Org A published (v1) + Org A draft (v2) + Org B published (v1).
-- created_by/published_by are policy.manage holders (HR A / Owner B).
insert into public.scoring_policy_versions
  (id, organization_id, scoring_policy_id, version_no, status,
   multipliers, revision_penalty_rule, timeliness_thresholds, published_at, published_by, created_by)
values
  ('a0000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000d1', 1, 'published',
   -- doc 04 §50-53 multipliers + §57 revision penalty (Phase 5 scoring). timeliness_thresholds
   -- stay {} (derivation is reviewer/app-side; the engine uses the review's timeliness — E).
   '{"complexity":{"low":1.0,"medium":1.25,"high":1.5,"critical":2.0},"impact":{"low":1.0,"medium":1.2,"high":1.5,"strategic":2.0},"quality":{"acceptable":0.75,"good":1.0,"excellent":1.25,"poor":0},"timeliness":{"early":1.1,"on_time":1.0,"late_minor":0.85,"late_major":0.5}}'::jsonb,
   '{"rate_per_revision":0.05,"cap":0.25}'::jsonb, '{}'::jsonb,
   now(), 'a0000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-0000000000a3'),
  ('a0000000-0000-0000-0000-0000000000d3', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000d1', 2, 'draft',
   '{"complexity":{},"impact":{},"quality":{},"timeliness":{}}'::jsonb, '{}'::jsonb, '{}'::jsonb,
   null, null, 'a0000000-0000-0000-0000-0000000000a3'),
  ('b0000000-0000-0000-0000-0000000000d2', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-0000000000d1', 1, 'published',
   '{"complexity":{"low":1.0,"medium":1.25,"high":1.5,"critical":2.0},"impact":{"low":1.0,"medium":1.2,"high":1.5,"strategic":2.0},"quality":{"acceptable":0.75,"good":1.0,"excellent":1.25,"poor":0},"timeliness":{"early":1.1,"on_time":1.0,"late_minor":0.85,"late_major":0.5}}'::jsonb,
   '{"rate_per_revision":0.05,"cap":0.25}'::jsonb, '{}'::jsonb,
   now(), 'b0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

-- =============================================================================
-- Phase 3B-B seed — point_ledger fixtures (DEV/STAGING ONLY)
-- Refs: 18 §8. Deterministic rows to exercise RLS visibility + append-only.
-- created_by = HR A (org A) / Owner B (org B). Writes here run as the bypassrls
-- migration role (server-only model); no client mint path exists.
--   e1 = manual_adjustment, emp-alpha (team alpha) — employee-owned / manager-visible
--   e2 = reversal of e1, emp-alpha
--   e3 = manual_adjustment, emp-beta (team beta) — manager-alpha NOT visible
--   b_e1 = manual_adjustment, emp-b (org B) — cross-tenant
-- =============================================================================
insert into public.point_ledger
  (id, organization_id, employee_id, event_type, points_delta, reason,
   scoring_policy_version_id, reverses_entry_id, created_by)
values
  ('a0000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000a7', 'manual_adjustment', 10, 'seed: alpha manual adjustment',
   'a0000000-0000-0000-0000-0000000000d2', null, 'a0000000-0000-0000-0000-0000000000a3'),
  ('a0000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000a7', 'reversal', -10, 'seed: reverse e1',
   null, 'a0000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000a3'),
  ('a0000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000a8', 'manual_adjustment', 5, 'seed: beta manual adjustment',
   null, null, 'a0000000-0000-0000-0000-0000000000a3'),
  ('b0000000-0000-0000-0000-0000000000e1', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-0000000000b2', 'manual_adjustment', 7, 'seed: org B manual adjustment',
   null, null, 'b0000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

-- =============================================================================
-- Phase 3 seed — compensation_records fixtures (DEV/STAGING ONLY)
-- Refs: 14/15/ADR-018. One ACTIVE comp per employee. created_by = HR A / Owner B.
-- Writes run as the bypassrls migration role (RLS with_check not evaluated here);
-- the MASKED audit trigger fires (is_sensitive rows in audit_logs; no raw salary).
--   c1   = emp-alpha (org A), cap_basis present
--   c2   = emp-beta  (org A), cap_basis NULL (exercises masked-null + AD6 note)
--   b_c1 = emp-b     (org B), cross-tenant
-- =============================================================================
insert into public.compensation_records
  (id, organization_id, employee_id, gross_salary_minor, currency, cap_basis_minor,
   effective_from, status, created_by)
values
  ('a0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000a7', 5000000, 'TRY', 5000000, date '2026-01-01', 'active',
   'a0000000-0000-0000-0000-0000000000a3'),
  ('a0000000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000a8', 4000000, 'TRY', null, date '2026-01-01', 'active',
   'a0000000-0000-0000-0000-0000000000a3'),
  ('b0000000-0000-0000-0000-0000000000c1', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-0000000000b2', 6000000, 'TRY', 6000000, date '2026-01-01', 'active',
   'b0000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

-- =============================================================================
-- Phase 3 seed — bonus_periods + bonus_pools fixtures (DEV/STAGING ONLY)
-- Refs: 14/15/16, AD10. One OPEN monthly period + one DRAFT pool per org.
-- created_by: period = HR A / Owner B (period.manage); pool = Finance A / Owner B.
-- Writes run as the bypassrls migration role (RLS with_check not evaluated here);
-- audit triggers fire (bonus_periods.insert / bonus_pools.insert).
--   fa (org A) OPEN period + fb (org A) DRAFT pool 100k TL
--   fa (org B) OPEN period + fb (org B) DRAFT pool  50k TL (cross-tenant)
-- =============================================================================
insert into public.bonus_periods
  (id, organization_id, period_type, starts_on, ends_on, status, created_by)
values
  ('a0000000-0000-0000-0000-0000000000fa', 'a0000000-0000-0000-0000-000000000001',
   'monthly', date '2026-06-01', date '2026-06-30', 'open',
   'a0000000-0000-0000-0000-0000000000a3'),
  ('b0000000-0000-0000-0000-0000000000fa', 'b0000000-0000-0000-0000-000000000002',
   'monthly', date '2026-06-01', date '2026-06-30', 'open',
   'b0000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

insert into public.bonus_pools
  (id, organization_id, bonus_period_id, amount_minor, currency, status, created_by)
values
  ('a0000000-0000-0000-0000-0000000000fb', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000fa', 10000000, 'TRY', 'draft',
   'a0000000-0000-0000-0000-0000000000a4'),
  ('b0000000-0000-0000-0000-0000000000fb', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-0000000000fa', 5000000, 'TRY', 'draft',
   'b0000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

-- =============================================================================
-- Phase 3 seed — bonus_pool_components + bonus_pool_eligibility (DEV/STAGING ONLY)
-- Refs: 14/15/16, D1/D10/AD9. MVP component = individual 1.0. Eligibility rows carry
-- 15-day evidence + proration + derived primary_team (team_memberships.is_primary).
-- created_by: component = Finance A / Owner B; eligibility = HR A / Owner B.
--   ca (org A/B) individual=1.0 on pool fb
--   da/db (org A) eligibility for emp-alpha(a7,team f1) / emp-beta(a8,team f2)
--   da (org B) eligibility for emp-b(b2) — no team (cross-tenant)
-- =============================================================================
insert into public.bonus_pool_components
  (id, organization_id, bonus_pool_id, component, weight, created_by)
values
  ('a0000000-0000-0000-0000-0000000000ca', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000fb', 'individual', 1.0, 'a0000000-0000-0000-0000-0000000000a4'),
  ('b0000000-0000-0000-0000-0000000000ca', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-0000000000fb', 'individual', 1.0, 'b0000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

insert into public.bonus_pool_eligibility
  (id, organization_id, bonus_pool_id, employee_id, eligible, days_active, eligibility_factor,
   proration_factor, primary_team_id, created_by)
values
  ('a0000000-0000-0000-0000-0000000000da', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000fb', 'a0000000-0000-0000-0000-0000000000a7', true, 20, 1,
   1.0, 'a0000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000a3'),
  ('a0000000-0000-0000-0000-0000000000db', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000fb', 'a0000000-0000-0000-0000-0000000000a8', true, 18, 1,
   1.0, 'a0000000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-0000000000a3'),
  ('b0000000-0000-0000-0000-0000000000da', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-0000000000fb', 'b0000000-0000-0000-0000-0000000000b2', true, 20, 1,
   1.0, null, 'b0000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

-- =============================================================================
-- Phase 3 seed — bonus_calculation_runs + bonus_allocations + snapshots (DEV/STAGING)
-- Refs: 14/15/16 (§4 run machine, §5 allocation machine), D1/D6/AD7/AD9/AD10.
-- A SEPARATE locked period+pool (30/31) — distinct from the OPEN fa/DRAFT fb fixtures
-- other suites rely on — carries one COMPLETED run (32) with two allocations (33/34)
-- and a thin snapshot (35). These are STORED fixtures (no calc engine): the amounts
-- are hand-set to satisfy Σ(final) + undistributed_remainder = pool (SI-13/INV-4).
-- Sequence respects the state machines: pool draft->locked, period open->locked (AD10),
-- allocations inserted while run is running, then run running->completed (freezes them).
--   Org A: period 30 (locked) + pool 31 (locked, 100k TL, t_org=1) + run 32 (completed)
--          + alloc 33 (emp-alpha a7/team f1, 60k) + alloc 34 (emp-beta a8/team f2, 40k)
--          + snapshot 35 (remainder 0). Σfinal 100k = pool.
--   Org B: period 30 + pool 31 (50k) + run 32 + alloc 33 (emp-b b2, 50k) + snapshot 35.
-- =============================================================================

-- Locked period + locked pool (open->locked path so INSERT/state-machine triggers pass).
insert into public.bonus_periods
  (id, organization_id, period_type, starts_on, ends_on, status, created_by)
values
  ('a0000000-0000-0000-0000-000000000030', 'a0000000-0000-0000-0000-000000000001',
   'monthly', date '2026-05-01', date '2026-05-31', 'open', 'a0000000-0000-0000-0000-0000000000a3'),
  ('b0000000-0000-0000-0000-000000000030', 'b0000000-0000-0000-0000-000000000002',
   'monthly', date '2026-05-01', date '2026-05-31', 'open', 'b0000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

insert into public.bonus_pools
  (id, organization_id, bonus_period_id, amount_minor, currency, status, created_by)
values
  ('a0000000-0000-0000-0000-000000000031', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000030', 10000000, 'TRY', 'draft', 'a0000000-0000-0000-0000-0000000000a4'),
  ('b0000000-0000-0000-0000-000000000031', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000030', 5000000, 'TRY', 'draft', 'b0000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

-- Lock the pools (t_org + lock metadata), then lock the periods (AD10 satisfied).
update public.bonus_pools set status = 'locked', t_org = 1, locked_at = now(),
       locked_by = 'a0000000-0000-0000-0000-0000000000a4'
  where id = 'a0000000-0000-0000-0000-000000000031' and status = 'draft';
update public.bonus_pools set status = 'locked', t_org = 1, locked_at = now(),
       locked_by = 'b0000000-0000-0000-0000-0000000000b1'
  where id = 'b0000000-0000-0000-0000-000000000031' and status = 'draft';
update public.bonus_periods set status = 'locked', locked_at = now(),
       locked_by = 'a0000000-0000-0000-0000-0000000000a3'
  where id = 'a0000000-0000-0000-0000-000000000030' and status = 'open';
update public.bonus_periods set status = 'locked', locked_at = now(),
       locked_by = 'b0000000-0000-0000-0000-0000000000b1'
  where id = 'b0000000-0000-0000-0000-000000000030' and status = 'open';

-- Calculation runs (start 'running').
insert into public.bonus_calculation_runs
  (id, organization_id, bonus_period_id, bonus_pool_id, policy_version_id, status,
   idempotency_key, t_org, top_up_applied, triggered_by)
values
  ('a0000000-0000-0000-0000-000000000032', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000030', 'a0000000-0000-0000-0000-000000000031',
   'a0000000-0000-0000-0000-0000000000d2', 'running', 'seed-run-a-2026-05', 1, false,
   'a0000000-0000-0000-0000-0000000000a3'),
  ('b0000000-0000-0000-0000-000000000032', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000030', 'b0000000-0000-0000-0000-000000000031',
   'b0000000-0000-0000-0000-0000000000d2', 'running', 'seed-run-b-2026-05', 1, false,
   'b0000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

-- Allocations (while run is running). Σ(final) matches pool per org.
insert into public.bonus_allocations
  (id, organization_id, calculation_run_id, bonus_period_id, employee_id, primary_team_id,
   adjusted_score, raw_share_minor, final_amount_minor, cap_applied, status)
values
  ('a0000000-0000-0000-0000-000000000033', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000032', 'a0000000-0000-0000-0000-000000000030',
   'a0000000-0000-0000-0000-0000000000a7', 'a0000000-0000-0000-0000-0000000000f1',
   1500, 6000000, 6000000, 'no', 'calculated'),
  ('a0000000-0000-0000-0000-000000000034', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000032', 'a0000000-0000-0000-0000-000000000030',
   'a0000000-0000-0000-0000-0000000000a8', 'a0000000-0000-0000-0000-0000000000f2',
   1000, 4000000, 4000000, 'no', 'calculated'),
  ('b0000000-0000-0000-0000-000000000033', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000032', 'b0000000-0000-0000-0000-000000000030',
   'b0000000-0000-0000-0000-0000000000b2', null,
   1000, 5000000, 5000000, 'no', 'calculated')
on conflict (id) do nothing;

-- Thin freeze markers (one per run).
insert into public.bonus_allocation_snapshots
  (id, organization_id, calculation_run_id, bonus_period_id, bonus_pool_id, policy_version_id,
   t_org, top_up_applied, undistributed_remainder_minor, calculation_metadata)
values
  ('a0000000-0000-0000-0000-000000000035', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000032', 'a0000000-0000-0000-0000-000000000030',
   'a0000000-0000-0000-0000-000000000031', 'a0000000-0000-0000-0000-0000000000d2',
   1, false, 0, '{"seed":"org-a"}'::jsonb),
  ('b0000000-0000-0000-0000-000000000035', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000032', 'b0000000-0000-0000-0000-000000000030',
   'b0000000-0000-0000-0000-000000000031', 'b0000000-0000-0000-0000-0000000000d2',
   1, false, 0, '{"seed":"org-b"}'::jsonb)
on conflict (id) do nothing;

-- Complete the runs (running->completed) — this FREEZES the allocations above.
update public.bonus_calculation_runs set status = 'completed', completed_at = now()
  where id = 'a0000000-0000-0000-0000-000000000032' and status = 'running';
update public.bonus_calculation_runs set status = 'completed', completed_at = now()
  where id = 'b0000000-0000-0000-0000-000000000032' and status = 'running';

-- =============================================================================
-- Phase 3 seed — disputes/dispute_events fixtures (DEV/STAGING)
-- Refs: 07/14/15/16, D9. Deterministic dispute fixtures. dispute_events are AUTO-written
-- by the log_dispute_event() trigger, so we set request.jwt.claims (auth.uid()) before
-- each write to stamp the acting actor. Created via the bypassrls migration role (RLS
-- with_check not evaluated), but auth.uid() still resolves from the JWT claim GUC — the
-- auto-event actor is the claim's sub. HR-assign authz is via has_role('hr') (no new
-- permission — keeps the seeded permission catalog unchanged).
--   Org A dispute 70: complainant emp-alpha a7; disputed decision owner mgr-alpha a5;
--                     opened (event actor a7) then HR a3 assigns reviewer mgr-beta a6
--                     (event actor a3) -> under_review. (a6 <> owner a5 <> complainant a7.)
--   Org B dispute 70: complainant emp-b b2; owner owner-b b1; open (event actor b2).
-- =============================================================================

-- Org A dispute (opened by complainant a7). Session-level set_config (is_local=false)
-- so the JWT claim survives across autocommit statement boundaries during db reset.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', false);
insert into public.disputes
  (id, organization_id, complainant_id, dispute_type, target_type, target_id, status,
   decision_owner_id, opened_at, due_at)
values
  ('a0000000-0000-0000-0000-000000000070', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000a7', 'unfair_rejection', 'task',
   'a0000000-0000-0000-0000-000000000071', 'open',
   'a0000000-0000-0000-0000-0000000000a5', now(), now() + interval '5 days')
on conflict (id) do nothing;
-- HR a3 assigns reviewer mgr-beta a6 -> under_review (auto-event 'assigned', actor a3).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', false);
update public.disputes
  set status = 'under_review', assigned_reviewer_id = 'a0000000-0000-0000-0000-0000000000a6'
  where id = 'a0000000-0000-0000-0000-000000000070' and status = 'open';

-- Org B dispute (opened by complainant b2).
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-0000000000b2"}', false);
insert into public.disputes
  (id, organization_id, complainant_id, dispute_type, target_type, target_id, status,
   decision_owner_id, opened_at, due_at)
values
  ('b0000000-0000-0000-0000-000000000070', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-0000000000b2', 'bonus_calculation_dispute', 'task',
   'b0000000-0000-0000-0000-000000000071', 'open',
   'b0000000-0000-0000-0000-0000000000b1', now(), now() + interval '5 days')
on conflict (id) do nothing;

-- Reset the claim so it does not leak beyond the seed's dispute block.
select set_config('request.jwt.claims', '', false);

-- =============================================================================
-- Phase 3 seed — anti_gaming_flags fixtures (DEV/STAGING ONLY)
-- Refs: 08/14/15/16 §7, D5. Deterministic flag fixtures. INSERT is server-only (the
-- rule engine); here we write via the bypassrls migration role. NO auto-event trigger
-- and no financial side effect — a confirmed flag is inert (D5). log_audit stamps the
-- flag creation / review (actor null under the migration role is fine).
--   Org A flag 90: rule duplicate_task, subject emp-alpha a7 (team f1, mgr a5), OPEN.
--   Org A flag 91: rule period_end_spike, subject emp-beta a8 (team f2, mgr a6),
--                  walked open->reviewing->confirmed (reviewed_by a6, note). (a6 <> a8.)
--   Org B flag 90: rule self_approval_attempt, subject emp-b b2, OPEN (cross-tenant).
-- =============================================================================
insert into public.anti_gaming_flags
  (id, organization_id, rule, subject_employee_id, status, evidence)
values
  ('a0000000-0000-0000-0000-000000000090', 'a0000000-0000-0000-0000-000000000001',
   'duplicate_task', 'a0000000-0000-0000-0000-0000000000a7', 'open', '{"seed":"dup"}'::jsonb),
  ('a0000000-0000-0000-0000-000000000091', 'a0000000-0000-0000-0000-000000000001',
   'period_end_spike', 'a0000000-0000-0000-0000-0000000000a8', 'open', '{"seed":"spike"}'::jsonb),
  ('b0000000-0000-0000-0000-000000000090', 'b0000000-0000-0000-0000-000000000002',
   'self_approval_attempt', 'b0000000-0000-0000-0000-0000000000b2', 'open', '{"seed":"self"}'::jsonb)
on conflict (id) do nothing;

-- Walk flag 91 to confirmed (open -> reviewing -> confirmed) by mgr-beta a6.
update public.anti_gaming_flags set status = 'reviewing'
  where id = 'a0000000-0000-0000-0000-000000000091' and status = 'open';
update public.anti_gaming_flags
  set status = 'confirmed', reviewed_by = 'a0000000-0000-0000-0000-0000000000a6',
      review_note = 'seed: confirmed after review'
  where id = 'a0000000-0000-0000-0000-000000000091' and status = 'reviewing';

-- =============================================================================
-- Phase 3 seed — bonus_ledger balanced accrual fixtures (DEV/STAGING ONLY)
-- Refs: 06 §2, 14/16 (BL-1..4), ADR-017. A single balanced accrual TRANSACTION per org
-- (one pool debit total + per-employee accrual credits), referencing the completed run
-- snapshot. Each transaction is a SINGLE multi-row INSERT so the DEFERRABLE balance
-- trigger sees the complete, balanced group (Σdebit=Σcredit) at commit. created_by =
-- Finance A / Owner B. These are STORED fixtures (no posting engine).
--   Org A: txn 50 on snapshot 35 (pool 31, 100k): debit pool 100k = credit a7 60k + a8 40k
--   Org B: txn 50 on snapshot 35 (pool 31, 50k):  debit pool 50k  = credit b2 50k
-- =============================================================================
insert into public.bonus_ledger
  (id, organization_id, bonus_pool_id, employee_id, calculation_run_id, snapshot_id, transaction_id,
   entry_type, account, event_type, amount_minor, currency, reason, created_by)
values
  ('a0000000-0000-0000-0000-000000000051', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000031', null, 'a0000000-0000-0000-0000-000000000032',
   'a0000000-0000-0000-0000-000000000035', 'a0000000-0000-0000-0000-000000000050',
   'debit', 'pool', 'bonus_accrual', 10000000, 'TRY', 'seed: accrual pool debit', 'a0000000-0000-0000-0000-0000000000a4'),
  ('a0000000-0000-0000-0000-000000000052', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000031', 'a0000000-0000-0000-0000-0000000000a7', 'a0000000-0000-0000-0000-000000000032',
   'a0000000-0000-0000-0000-000000000035', 'a0000000-0000-0000-0000-000000000050',
   'credit', 'accrual', 'bonus_accrual', 6000000, 'TRY', 'seed: accrual emp-alpha', 'a0000000-0000-0000-0000-0000000000a4'),
  ('a0000000-0000-0000-0000-000000000053', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000031', 'a0000000-0000-0000-0000-0000000000a8', 'a0000000-0000-0000-0000-000000000032',
   'a0000000-0000-0000-0000-000000000035', 'a0000000-0000-0000-0000-000000000050',
   'credit', 'accrual', 'bonus_accrual', 4000000, 'TRY', 'seed: accrual emp-beta', 'a0000000-0000-0000-0000-0000000000a4')
on conflict (id) do nothing;

insert into public.bonus_ledger
  (id, organization_id, bonus_pool_id, employee_id, calculation_run_id, snapshot_id, transaction_id,
   entry_type, account, event_type, amount_minor, currency, reason, created_by)
values
  ('b0000000-0000-0000-0000-000000000051', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000031', null, 'b0000000-0000-0000-0000-000000000032',
   'b0000000-0000-0000-0000-000000000035', 'b0000000-0000-0000-0000-000000000050',
   'debit', 'pool', 'bonus_accrual', 5000000, 'TRY', 'seed: accrual pool debit', 'b0000000-0000-0000-0000-0000000000b1'),
  ('b0000000-0000-0000-0000-000000000052', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000031', 'b0000000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-000000000032',
   'b0000000-0000-0000-0000-000000000035', 'b0000000-0000-0000-0000-000000000050',
   'credit', 'accrual', 'bonus_accrual', 5000000, 'TRY', 'seed: accrual emp-b', 'b0000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

-- =============================================================================
-- Phase 3 seed — notifications fixtures (DEV/STAGING ONLY)
-- Refs: 14 §424-429, 15 §139-142, D-none. Per-recipient delivery sink. INSERT is
-- server-only (service_role); here we write via the bypassrls migration role. NO
-- audit trigger and NO prevent_delete (retention/TTL is a V1 item). recipient_id
-- stores the profile_id (== auth.uid()). The 'read' fixture sets read_at explicitly
-- to satisfy the read-consistency CHECK.
--   Org A n80: recipient emp-alpha a7, UNREAD (mark-read + recipient-only RLS tests).
--   Org A n81: recipient emp-alpha a7, READ   (read->unread reject + read-state tests).
--   Org B n80: recipient emp-b b2,     UNREAD (cross-tenant negative).
-- =============================================================================
insert into public.notifications
  (id, organization_id, recipient_id, type, payload, link, status, read_at)
values
  ('a0000000-0000-0000-0000-000000000080', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000a7', 'task.approved', '{"task":"seed-approved"}'::jsonb,
   '/tasks/seed-approved', 'unread', null),
  ('a0000000-0000-0000-0000-000000000081', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000a7', 'dispute.assigned', '{"dispute":"seed-assigned"}'::jsonb,
   '/disputes/seed-assigned', 'read', now()),
  ('b0000000-0000-0000-0000-000000000080', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-0000000000b2', 'task.approved', '{"task":"seed-org-b"}'::jsonb,
   '/tasks/seed-org-b', 'unread', null)
on conflict (id) do nothing;

-- =============================================================================
-- Phase 3 seed — exports + AD6-gate fixtures (DEV/STAGING ONLY)
-- Refs: 14 §444-451, 15 §149-152, 16 §8, AD6/SI-3/SI-15. Finance creates export
-- records (payout.export); here we write via the bypassrls migration role. The
-- validate_export() trigger runs on these inserts (snapshot same-org + period match +
-- AD6). audit fires (exports.insert). Two dedicated AD6-gate fixtures (org A) carry a
-- pending_missing_cap_basis allocation so a negative export insert is blocked — one via
-- allocation status, one via cap_applied only (isolating both OR branches of the gate).
--   Clean export 48 (org A, snapshot 35 — clean run 32) + b48 (org B, snapshot 35).
--   AD6 fixture 1: period 60/pool 61/run 62 + alloc 63 (status=pending) + snapshot 64.
--   AD6 fixture 2: period 60/pool 61/run 65 + alloc 66 (cap_applied=pending, status
--                  calculated) + snapshot 67.  (both runs share the locked period+pool)
-- =============================================================================

-- Locked period + locked pool for the AD6-gate runs (open->locked so triggers pass).
insert into public.bonus_periods
  (id, organization_id, period_type, starts_on, ends_on, status, created_by)
values
  ('a0000000-0000-0000-0000-000000000060', 'a0000000-0000-0000-0000-000000000001',
   'monthly', date '2026-03-01', date '2026-03-31', 'open', 'a0000000-0000-0000-0000-0000000000a3')
on conflict (id) do nothing;

insert into public.bonus_pools
  (id, organization_id, bonus_period_id, amount_minor, currency, status, created_by)
values
  ('a0000000-0000-0000-0000-000000000061', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000060', 10000000, 'TRY', 'draft', 'a0000000-0000-0000-0000-0000000000a4')
on conflict (id) do nothing;

update public.bonus_pools set status = 'locked', t_org = 1, locked_at = now(),
       locked_by = 'a0000000-0000-0000-0000-0000000000a4'
  where id = 'a0000000-0000-0000-0000-000000000061' and status = 'draft';
update public.bonus_periods set status = 'locked', locked_at = now(),
       locked_by = 'a0000000-0000-0000-0000-0000000000a3'
  where id = 'a0000000-0000-0000-0000-000000000060' and status = 'open';

-- Two runs (start 'running' so allocations may be written before freeze).
insert into public.bonus_calculation_runs
  (id, organization_id, bonus_period_id, bonus_pool_id, policy_version_id, status,
   idempotency_key, t_org, top_up_applied, triggered_by)
values
  ('a0000000-0000-0000-0000-000000000062', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000060', 'a0000000-0000-0000-0000-000000000061',
   'a0000000-0000-0000-0000-0000000000d2', 'running', 'seed-export-ad6-a1', 1, false,
   'a0000000-0000-0000-0000-0000000000a3'),
  ('a0000000-0000-0000-0000-000000000065', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000060', 'a0000000-0000-0000-0000-000000000061',
   'a0000000-0000-0000-0000-0000000000d2', 'running', 'seed-export-ad6-a2', 1, false,
   'a0000000-0000-0000-0000-0000000000a3')
on conflict (id) do nothing;

-- Pending-cap allocations (primary_team_id null to skip the AD9 is_primary validator).
--   alloc 43: status=pending_missing_cap_basis (mirror ⇒ cap_applied=pending) — status branch.
--   alloc 46: status=calculated, cap_applied=pending_missing_cap_basis — cap_applied-only branch.
insert into public.bonus_allocations
  (id, organization_id, calculation_run_id, bonus_period_id, employee_id, primary_team_id,
   adjusted_score, raw_share_minor, final_amount_minor, cap_applied, status)
values
  ('a0000000-0000-0000-0000-000000000063', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000062', 'a0000000-0000-0000-0000-000000000060',
   'a0000000-0000-0000-0000-0000000000a7', null,
   0, 0, 0, 'pending_missing_cap_basis', 'pending_missing_cap_basis'),
  ('a0000000-0000-0000-0000-000000000066', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000065', 'a0000000-0000-0000-0000-000000000060',
   'a0000000-0000-0000-0000-0000000000a8', null,
   0, 0, 0, 'pending_missing_cap_basis', 'calculated')
on conflict (id) do nothing;

-- Snapshots (one per run) + complete the runs (freezes the allocations).
insert into public.bonus_allocation_snapshots
  (id, organization_id, calculation_run_id, bonus_period_id, bonus_pool_id, policy_version_id,
   t_org, top_up_applied, undistributed_remainder_minor, calculation_metadata)
values
  ('a0000000-0000-0000-0000-000000000064', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000062', 'a0000000-0000-0000-0000-000000000060',
   'a0000000-0000-0000-0000-000000000061', 'a0000000-0000-0000-0000-0000000000d2',
   1, false, 10000000, '{"seed":"ad6-status"}'::jsonb),
  ('a0000000-0000-0000-0000-000000000067', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000065', 'a0000000-0000-0000-0000-000000000060',
   'a0000000-0000-0000-0000-000000000061', 'a0000000-0000-0000-0000-0000000000d2',
   1, false, 10000000, '{"seed":"ad6-cap"}'::jsonb)
on conflict (id) do nothing;

update public.bonus_calculation_runs set status = 'completed', completed_at = now()
  where id = 'a0000000-0000-0000-0000-000000000062' and status = 'running';
update public.bonus_calculation_runs set status = 'completed', completed_at = now()
  where id = 'a0000000-0000-0000-0000-000000000065' and status = 'running';

-- Clean export records (snapshot 35 is the completed clean run 32; period matches).
--   org A export 48 (exported_by Finance a4); org B export b48 (exported_by owner b1).
insert into public.exports
  (id, organization_id, bonus_period_id, snapshot_id, exported_by, format, status)
values
  ('a0000000-0000-0000-0000-000000000048', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000030', 'a0000000-0000-0000-0000-000000000035',
   'a0000000-0000-0000-0000-0000000000a4', 'csv', 'requested'),
  ('b0000000-0000-0000-0000-000000000048', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000030', 'b0000000-0000-0000-0000-000000000035',
   'b0000000-0000-0000-0000-0000000000b1', 'csv', 'requested')
on conflict (id) do nothing;

-- =============================================================================
-- Phase 4 seed — tasks / task_events / task_reviews fixtures (DEV/STAGING ONLY)
-- Refs: 04 (enums), 14/15/16 (task family), D3/AD4/AD5. Tasks are created 'assigned'
-- then WALKED to their target state (the status machine forbids inserting a mid-state
-- task). Walking runs via the bypassrls migration role (trusted context), so
-- review-driven states are not needed here. task_events are auto-written by the
-- log_task_event() trigger (actor null under the migration role is fine). NO reviews
-- are seeded (reviews require auth.uid() = reviewer; they are exercised in pgTAP §B).
--   100 team f1, assignee a7, creator/reviewer a5 -> submitted   (review/AD4/RLS)
--   101 team f2, assignee a8, creator/reviewer a6 -> in_progress (other-team RLS)
--   102 team f1, assignee a7, creator/reviewer a5 -> submitted   (D3 + needs_revision)
--   103 team f1, assignee a5 (mgr), reviewer null -> submitted   (self-review block)
-- =============================================================================
insert into public.tasks
  (id, organization_id, team_id, title, status, created_by, assigned_to, reviewer_id,
   complexity, impact, base_points, scoring_policy_version_id)
values
  ('a0000000-0000-0000-0000-000000000100', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000f1', 'Seed task alpha', 'assigned',
   'a0000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-0000000000a7',
   'a0000000-0000-0000-0000-0000000000a5', 'medium', 'high', 100, 'a0000000-0000-0000-0000-0000000000d2'),
  ('a0000000-0000-0000-0000-000000000101', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000f2', 'Seed task beta', 'assigned',
   'a0000000-0000-0000-0000-0000000000a6', 'a0000000-0000-0000-0000-0000000000a8',
   'a0000000-0000-0000-0000-0000000000a6', 'high', 'medium', 80, 'a0000000-0000-0000-0000-0000000000d2'),
  ('a0000000-0000-0000-0000-000000000102', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000f1', 'Seed task gamma', 'assigned',
   'a0000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-0000000000a7',
   'a0000000-0000-0000-0000-0000000000a5', 'low', 'high', 50, 'a0000000-0000-0000-0000-0000000000d2'),
  ('a0000000-0000-0000-0000-000000000103', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000f1', 'Seed task delta (mgr-assigned)', 'assigned',
   'a0000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-0000000000a5',
   null, 'medium', 'strategic', 120, 'a0000000-0000-0000-0000-0000000000d2')
on conflict (id) do nothing;

-- Walk assigned -> in_progress (all four), then in_progress -> submitted (100/102/103).
update public.tasks set status = 'in_progress'
  where id in ('a0000000-0000-0000-0000-000000000100','a0000000-0000-0000-0000-000000000101',
               'a0000000-0000-0000-0000-000000000102','a0000000-0000-0000-0000-000000000103')
    and status = 'assigned';
update public.tasks set status = 'submitted'
  where id in ('a0000000-0000-0000-0000-000000000100','a0000000-0000-0000-0000-000000000102',
               'a0000000-0000-0000-0000-000000000103')
    and status = 'in_progress';
