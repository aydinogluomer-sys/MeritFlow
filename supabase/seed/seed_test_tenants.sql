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
   '{"complexity":{},"impact":{},"quality":{},"timeliness":{}}'::jsonb, '{}'::jsonb, '{}'::jsonb,
   now(), 'a0000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-0000000000a3'),
  ('a0000000-0000-0000-0000-0000000000d3', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000d1', 2, 'draft',
   '{"complexity":{},"impact":{},"quality":{},"timeliness":{}}'::jsonb, '{}'::jsonb, '{}'::jsonb,
   null, null, 'a0000000-0000-0000-0000-0000000000a3'),
  ('b0000000-0000-0000-0000-0000000000d2', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-0000000000d1', 1, 'published',
   '{"complexity":{},"impact":{},"quality":{},"timeliness":{}}'::jsonb, '{}'::jsonb, '{}'::jsonb,
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
