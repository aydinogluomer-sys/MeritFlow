-- =============================================================================
-- Migration 0035 — Base reference data: roles, permissions, role_permissions
-- This data is required for the system to function and must be present in every
-- environment (local, staging, production). It was previously only in the dev
-- seed file, which `supabase db push` does not run.
-- All inserts are idempotent (ON CONFLICT DO NOTHING) — safe to run multiple times.
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
  ('support.grant',      'Grant support access',  'governance',    false),
  ('policy.manage',      'Manage scoring policy', 'scoring',       false)
on conflict (key) do nothing;

-- ---------------------------- role_permissions -------------------------------
insert into public.role_permissions (role_key, permission_key)
select r, p from (values
  ('owner',   'org.settings.write'), ('owner',   'user.invite'),     ('owner',   'team.manage'),
  ('owner',   'period.manage'),      ('owner',   'support.grant'),   ('owner',   'audit.read'),
  ('admin',   'user.invite'),        ('admin',   'team.manage'),     ('admin',   'audit.read'),
  ('hr',      'period.manage'),      ('hr',      'calculation.approve'), ('hr',  'dispute.resolve'),
  ('hr',      'audit.read'),         ('hr',      'comp.read'),
  ('finance', 'pool.create'),        ('finance', 'payout.export'),   ('finance', 'payout.mark_paid'),
  ('finance', 'clawback.review'),    ('finance', 'comp.read'),
  ('manager', 'task.create'),        ('manager', 'task.assign'),     ('manager', 'task.review'),
  ('manager', 'dispute.resolve'),
  ('employee','task.submit'),        ('employee','dispute.open'),
  ('auditor', 'audit.read'),
  ('owner',   'policy.manage'),      ('admin',   'policy.manage'),  ('hr',      'policy.manage')
) as rp(r, p)
on conflict (role_key, permission_key) do nothing;
