-- =============================================================================
-- N-1 upgrade fixture — representative data created under the N-1 schema, loaded by
-- scripts/n1-upgrade-drill.sh to prove it SURVIVES applying the latest migration (N).
-- DEV/STAGING ONLY — never production (ADR-014 / CLAUDE.md).
--
-- Loaded AFTER `supabase db reset` (migrations 0001..N-1 + the standard seed), so the
-- RBAC catalog / auth roles already exist. This fixture adds a DISJOINT set of tenants
-- in the `d1…` (Org A') and `d2…` (Org B') UUID namespaces so it never collides with the
-- seed's a…/b…/c… entities. It writes ONLY public.* + minimal auth.users rows.
--
-- DEVIATION (necessary): the prompt said "don't touch auth.users", but public.profiles
-- FK-references auth.users(id) (migration 0002) and the drill applies no seed of its own
-- for these tenants — so the fixture MUST mint its own auth.users rows first, exactly as
-- seed_test_tenants.sql does. It does NOT touch migration 0041's rate_limit_counters
-- (that table does not exist yet when this loads).
--
-- Covers the required N-1 data shapes + edge/null cases:
--   * a historical bonus_period walked to 'closed' (Org A')
--   * point_ledger row (task_approved)
--   * balanced bonus_ledger accrual (debit pool + credit accrual) (Org A')
--   * a payout export record (Org A')
--   * a 'closed' dispute + its auto-written event trail (Org A')
--   * invitations ('accepted' + 'expired') (Org A')
--   * two tenants (Org A' + Org B')
--   * edge/null: NULL cap_basis (comp), payout/amount = 0 + t_org = 0 (Org B' pool)
-- Idempotent (on-conflict guards) so a re-run is safe.
-- =============================================================================

begin;

-- ------------------------------ roles (catalog) ------------------------------
-- Already present after the standard seed; included so the fixture is self-sufficient.
insert into public.roles (key, label) values
  ('owner','Organization Owner'), ('admin','Admin'), ('hr','HR Manager'),
  ('finance','Finance Manager'), ('manager','Team Manager'), ('employee','Employee'),
  ('auditor','Auditor')
on conflict (key) do nothing;

-- ------------------------------ auth.users -----------------------------------
-- Minimal auth users so profiles.id FK (-> auth.users) is satisfiable (see DEVIATION note).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       u.email, extensions.crypt('password123', extensions.gen_salt('bf')),
       now(), now(), now(), '', '', '', ''
from (values
  ('d1000000-0000-0000-0000-0000000000a1'::uuid, 'owner-a@n1.test'),
  ('d1000000-0000-0000-0000-0000000000a2'::uuid, 'hr-a@n1.test'),
  ('d1000000-0000-0000-0000-0000000000a3'::uuid, 'finance-a@n1.test'),
  ('d1000000-0000-0000-0000-0000000000a4'::uuid, 'emp-a@n1.test'),
  ('d2000000-0000-0000-0000-0000000000b1'::uuid, 'owner-b@n1.test'),
  ('d2000000-0000-0000-0000-0000000000b2'::uuid, 'emp-b@n1.test')
) as u(id, email)
on conflict (id) do nothing;

-- ------------------------------- profiles ------------------------------------
insert into public.profiles (id, display_name, alias)
select p.id, p.name, p.alias from (values
  ('d1000000-0000-0000-0000-0000000000a1'::uuid, 'N1 Owner A',   'n1-owner-a'),
  ('d1000000-0000-0000-0000-0000000000a2'::uuid, 'N1 HR A',      'n1-hr-a'),
  ('d1000000-0000-0000-0000-0000000000a3'::uuid, 'N1 Finance A', 'n1-fin-a'),
  ('d1000000-0000-0000-0000-0000000000a4'::uuid, 'N1 Employee A','n1-emp-a'),
  ('d2000000-0000-0000-0000-0000000000b1'::uuid, 'N1 Owner B',   'n1-owner-b'),
  ('d2000000-0000-0000-0000-0000000000b2'::uuid, 'N1 Employee B','n1-emp-b')
) as p(id, name, alias)
on conflict (id) do nothing;

-- ----------------------------- organizations ---------------------------------
insert into public.organizations (id, name, slug) values
  ('d1000000-0000-0000-0000-000000000001', 'N1 Org A', 'n1-org-a'),
  ('d2000000-0000-0000-0000-000000000002', 'N1 Org B', 'n1-org-b')
on conflict (slug) do nothing;

insert into public.organization_settings (organization_id) values
  ('d1000000-0000-0000-0000-000000000001'),
  ('d2000000-0000-0000-0000-000000000002')
on conflict (organization_id) do nothing;

-- ------------------------------ memberships ----------------------------------
insert into public.memberships (organization_id, profile_id, primary_role)
select o, p, r from (values
  ('d1000000-0000-0000-0000-000000000001'::uuid, 'd1000000-0000-0000-0000-0000000000a1'::uuid, 'owner'),
  ('d1000000-0000-0000-0000-000000000001'::uuid, 'd1000000-0000-0000-0000-0000000000a2'::uuid, 'hr'),
  ('d1000000-0000-0000-0000-000000000001'::uuid, 'd1000000-0000-0000-0000-0000000000a3'::uuid, 'finance'),
  ('d1000000-0000-0000-0000-000000000001'::uuid, 'd1000000-0000-0000-0000-0000000000a4'::uuid, 'employee'),
  ('d2000000-0000-0000-0000-000000000002'::uuid, 'd2000000-0000-0000-0000-0000000000b1'::uuid, 'owner'),
  ('d2000000-0000-0000-0000-000000000002'::uuid, 'd2000000-0000-0000-0000-0000000000b2'::uuid, 'employee')
) as m(o, p, r)
on conflict (organization_id, profile_id) do nothing;

-- ------------------- compensation_records (edge: NULL cap_basis) -------------
insert into public.compensation_records
  (id, organization_id, employee_id, gross_salary_minor, currency, cap_basis_minor,
   effective_from, status, created_by)
values
  ('d1000000-0000-0000-0000-0000000000c1', 'd1000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-0000000000a4', 4200000, 'TRY', null, date '2026-01-01', 'active',
   'd1000000-0000-0000-0000-0000000000a2')
on conflict (id) do nothing;

-- ------------------------ point_ledger (task_approved) -----------------------
insert into public.point_ledger
  (id, organization_id, employee_id, event_type, points_delta, reason,
   scoring_policy_version_id, reverses_entry_id, created_by)
values
  ('d1000000-0000-0000-0000-0000000000e1', 'd1000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-0000000000a4', 'task_approved', 120, 'n1 fixture: approved task points',
   null, null, 'd1000000-0000-0000-0000-0000000000a2')
on conflict (id) do nothing;

-- =============================================================================
-- Org A' bonus chain: period 'open'->closed, pool locked (t_org=1, 100000 minor),
-- completed run + one allocation (final 60000) + snapshot (undistributed 40000;
-- Σfinal + undistributed = pool), a balanced accrual, and a payout export record.
-- Sequence respects the state machines (draft->locked, running->completed).
-- =============================================================================
insert into public.bonus_periods
  (id, organization_id, period_type, starts_on, ends_on, status, created_by)
values
  ('d1000000-0000-0000-0000-000000000010', 'd1000000-0000-0000-0000-000000000001',
   'monthly', date '2026-04-01', date '2026-04-30', 'open', 'd1000000-0000-0000-0000-0000000000a2')
on conflict (id) do nothing;

insert into public.bonus_pools
  (id, organization_id, bonus_period_id, amount_minor, currency, status, created_by)
values
  ('d1000000-0000-0000-0000-000000000011', 'd1000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000010', 100000, 'TRY', 'draft', 'd1000000-0000-0000-0000-0000000000a3')
on conflict (id) do nothing;

-- Lock the pool (t_org + metadata), then the period (AD10 satisfied).
update public.bonus_pools set status = 'locked', t_org = 1, locked_at = now(),
       locked_by = 'd1000000-0000-0000-0000-0000000000a3'
  where id = 'd1000000-0000-0000-0000-000000000011' and status = 'draft';
update public.bonus_periods set status = 'locked', locked_at = now(),
       locked_by = 'd1000000-0000-0000-0000-0000000000a2'
  where id = 'd1000000-0000-0000-0000-000000000010' and status = 'open';

insert into public.bonus_calculation_runs
  (id, organization_id, bonus_period_id, bonus_pool_id, policy_version_id, status,
   idempotency_key, t_org, top_up_applied, triggered_by)
values
  ('d1000000-0000-0000-0000-000000000012', 'd1000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000010', 'd1000000-0000-0000-0000-000000000011',
   null, 'running', 'n1-fixture-run-a', 1, false, 'd1000000-0000-0000-0000-0000000000a2')
on conflict (id) do nothing;

insert into public.bonus_allocations
  (id, organization_id, calculation_run_id, bonus_period_id, employee_id, primary_team_id,
   adjusted_score, raw_share_minor, final_amount_minor, cap_applied, status)
values
  ('d1000000-0000-0000-0000-000000000013', 'd1000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000012', 'd1000000-0000-0000-0000-000000000010',
   'd1000000-0000-0000-0000-0000000000a4', null, 1200, 60000, 60000, 'no', 'calculated')
on conflict (id) do nothing;

insert into public.bonus_allocation_snapshots
  (id, organization_id, calculation_run_id, bonus_period_id, bonus_pool_id, policy_version_id,
   t_org, top_up_applied, undistributed_remainder_minor, calculation_metadata)
values
  ('d1000000-0000-0000-0000-000000000014', 'd1000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000012', 'd1000000-0000-0000-0000-000000000010',
   'd1000000-0000-0000-0000-000000000011', null,
   1, false, 40000, '{"fixture":"n1-org-a","pool_ref_minor":100000}'::jsonb)
on conflict (id) do nothing;

-- Complete the run (freezes the allocation above).
update public.bonus_calculation_runs set status = 'completed', completed_at = now()
  where id = 'd1000000-0000-0000-0000-000000000012' and status = 'running';

-- Balanced accrual TRANSACTION (single multi-row INSERT so the deferred balance trigger
-- sees Σdebit = Σcredit at commit): debit pool 60000 = credit emp-a accrual 60000.
insert into public.bonus_ledger
  (id, organization_id, bonus_pool_id, employee_id, calculation_run_id, snapshot_id, transaction_id,
   entry_type, account, event_type, amount_minor, currency, reason, created_by)
values
  ('d1000000-0000-0000-0000-000000000015', 'd1000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000011', null, 'd1000000-0000-0000-0000-000000000012',
   'd1000000-0000-0000-0000-000000000014', 'd1000000-0000-0000-0000-000000000016',
   'debit', 'pool', 'bonus_accrual', 60000, 'TRY', 'n1 fixture: accrual pool debit',
   'd1000000-0000-0000-0000-0000000000a3'),
  ('d1000000-0000-0000-0000-000000000017', 'd1000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000011', 'd1000000-0000-0000-0000-0000000000a4',
   'd1000000-0000-0000-0000-000000000012', 'd1000000-0000-0000-0000-000000000014',
   'd1000000-0000-0000-0000-000000000016',
   'credit', 'accrual', 'bonus_accrual', 60000, 'TRY', 'n1 fixture: accrual emp-a credit',
   'd1000000-0000-0000-0000-0000000000a3')
on conflict (id) do nothing;

-- Walk the period through the payout lifecycle to a historical 'closed' state.
update public.bonus_periods set status = 'calculated'
  where id = 'd1000000-0000-0000-0000-000000000010' and status = 'locked';
update public.bonus_periods set status = 'approved'
  where id = 'd1000000-0000-0000-0000-000000000010' and status = 'calculated';
update public.bonus_periods set status = 'exported'
  where id = 'd1000000-0000-0000-0000-000000000010' and status = 'approved';
update public.bonus_periods set status = 'closed'
  where id = 'd1000000-0000-0000-0000-000000000010' and status = 'exported';

-- Payout export record (validate_export: snapshot same-org + period match + AD6 all pass).
insert into public.exports
  (id, organization_id, bonus_period_id, snapshot_id, exported_by, format, status)
values
  ('d1000000-0000-0000-0000-000000000018', 'd1000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000010', 'd1000000-0000-0000-0000-000000000014',
   'd1000000-0000-0000-0000-0000000000a3', 'csv', 'requested')
on conflict (id) do nothing;

-- =============================================================================
-- Org A' dispute walked open -> under_review -> resolved -> closed. dispute_events are
-- AUTO-written by the log_dispute_event() trigger (actor_id = auth.uid()), so set the
-- JWT claim before each write to stamp the acting member (mirrors the standard seed).
--   complainant emp-a (a4); decision_owner owner (a1); reviewer hr (a2)
--   (a2 <> a1 <> a4 satisfies the D9 reviewer/owner/complainant CHECKs).
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-0000000000a4"}', false);
insert into public.disputes
  (id, organization_id, complainant_id, dispute_type, target_type, target_id, status,
   decision_owner_id, opened_at, due_at)
values
  ('d1000000-0000-0000-0000-000000000020', 'd1000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-0000000000a4', 'unfair_rejection', 'task',
   'd1000000-0000-0000-0000-0000000000f0', 'open',
   'd1000000-0000-0000-0000-0000000000a1', now() - interval '10 days', now() - interval '5 days')
on conflict (id) do nothing;

select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-0000000000a2"}', false);
update public.disputes
  set status = 'under_review', assigned_reviewer_id = 'd1000000-0000-0000-0000-0000000000a2'
  where id = 'd1000000-0000-0000-0000-000000000020' and status = 'open';
update public.disputes
  set status = 'resolved', resolution = 'rejected',
      decision_note = 'n1 fixture: reviewed and rejected', resolved_at = now() - interval '2 days'
  where id = 'd1000000-0000-0000-0000-000000000020' and status = 'under_review';
update public.disputes
  set status = 'closed'
  where id = 'd1000000-0000-0000-0000-000000000020' and status = 'resolved';
select set_config('request.jwt.claims', '', false);

-- ------------------------- invitations (accepted + expired) ------------------
insert into public.invitations
  (id, organization_id, invited_by, email, role, status, expires_at)
values
  ('d1000000-0000-0000-0000-000000000030', 'd1000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-0000000000a2', 'joined@n1.test', 'employee', 'accepted',
   now() + interval '7 days'),
  ('d1000000-0000-0000-0000-000000000031', 'd1000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-0000000000a2', 'lapsed@n1.test', 'manager', 'expired',
   now() - interval '1 day')
on conflict (id) do nothing;

-- =============================================================================
-- Org B' edge case: t_org = 0 + pool amount 0 (payout = 0). Locked pool + completed run
-- + one zero allocation + snapshot (undistributed 0). Σfinal(0) + undistributed(0) =
-- pool(0). No bonus_ledger (amount_minor must be > 0, so a 0 payout posts no entry).
-- =============================================================================
insert into public.bonus_periods
  (id, organization_id, period_type, starts_on, ends_on, status, created_by)
values
  ('d2000000-0000-0000-0000-000000000010', 'd2000000-0000-0000-0000-000000000002',
   'monthly', date '2026-04-01', date '2026-04-30', 'open', 'd2000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

insert into public.bonus_pools
  (id, organization_id, bonus_period_id, amount_minor, currency, status, created_by)
values
  ('d2000000-0000-0000-0000-000000000011', 'd2000000-0000-0000-0000-000000000002',
   'd2000000-0000-0000-0000-000000000010', 0, 'TRY', 'draft', 'd2000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

update public.bonus_pools set status = 'locked', t_org = 0, locked_at = now(),
       locked_by = 'd2000000-0000-0000-0000-0000000000b1'
  where id = 'd2000000-0000-0000-0000-000000000011' and status = 'draft';
update public.bonus_periods set status = 'locked', locked_at = now(),
       locked_by = 'd2000000-0000-0000-0000-0000000000b1'
  where id = 'd2000000-0000-0000-0000-000000000010' and status = 'open';

insert into public.bonus_calculation_runs
  (id, organization_id, bonus_period_id, bonus_pool_id, policy_version_id, status,
   idempotency_key, t_org, top_up_applied, triggered_by)
values
  ('d2000000-0000-0000-0000-000000000012', 'd2000000-0000-0000-0000-000000000002',
   'd2000000-0000-0000-0000-000000000010', 'd2000000-0000-0000-0000-000000000011',
   null, 'running', 'n1-fixture-run-b', 0, false, 'd2000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

insert into public.bonus_allocations
  (id, organization_id, calculation_run_id, bonus_period_id, employee_id, primary_team_id,
   adjusted_score, raw_share_minor, final_amount_minor, cap_applied, status)
values
  ('d2000000-0000-0000-0000-000000000013', 'd2000000-0000-0000-0000-000000000002',
   'd2000000-0000-0000-0000-000000000012', 'd2000000-0000-0000-0000-000000000010',
   'd2000000-0000-0000-0000-0000000000b2', null, 0, 0, 0, 'no', 'calculated')
on conflict (id) do nothing;

insert into public.bonus_allocation_snapshots
  (id, organization_id, calculation_run_id, bonus_period_id, bonus_pool_id, policy_version_id,
   t_org, top_up_applied, undistributed_remainder_minor, calculation_metadata)
values
  ('d2000000-0000-0000-0000-000000000014', 'd2000000-0000-0000-0000-000000000002',
   'd2000000-0000-0000-0000-000000000012', 'd2000000-0000-0000-0000-000000000010',
   'd2000000-0000-0000-0000-000000000011', null,
   0, false, 0, '{"fixture":"n1-org-b","pool_ref_minor":0}'::jsonb)
on conflict (id) do nothing;

update public.bonus_calculation_runs set status = 'completed', completed_at = now()
  where id = 'd2000000-0000-0000-0000-000000000012' and status = 'running';

commit;
