-- =============================================================================
-- pgTAP — ENGINEERING-07 Track D: migration-integrity / populated-upgrade proxy.
-- Run: supabase test db   (dev/staging local; never production)
--
-- `supabase db reset` applies all 36 migrations THEN the seed. This suite proves, after
-- that full stack, that (1) seed data survived, (2) critical financial columns still exist
-- (a DROP COLUMN regression would break these), and (3) RLS is still enabled on the money/
-- point ledgers (an ALTER ... DISABLE ROW LEVEL SECURITY regression would break these).
--
-- NOTE (ENGINEERING-07 deviation): the authorization prompt used table names that do not
-- match this schema. Corrected to the real names verified in migrations 0009/0013/0014:
--   point_ledger_entries        -> point_ledger
--   bonus_ledger_entries        -> bonus_ledger
--   user_organization_members   -> memberships
--   calculation_runs.calculation_metadata -> bonus_allocation_snapshots.calculation_metadata
-- =============================================================================
begin;
select no_plan();

-- 1. Seed data survived the full migration stack (proxy for a populated upgrade).
select ok((select count(*) from public.organizations) > 0,
  'D-MIG-1: seed organizations survived the full migration stack');
select ok((select count(*) from public.bonus_periods) > 0,
  'D-MIG-2: seed bonus_periods survived the full migration stack');
select ok((select count(*) from public.bonus_pools) > 0,
  'D-MIG-3: seed bonus_pools survived the full migration stack');
select ok((select count(*) from public.memberships) > 0,
  'D-MIG-4: seed memberships survived the full migration stack');

-- 2. Critical financial columns still exist (a DROP COLUMN would regress these).
select has_column('public', 'point_ledger', 'points_delta',
  'D-MIG-5: point_ledger.points_delta exists (point-ledger column not dropped)');
select has_column('public', 'bonus_ledger', 'amount_minor',
  'D-MIG-6: bonus_ledger.amount_minor exists (money column not dropped)');
select has_column('public', 'bonus_allocations', 'final_amount_minor',
  'D-MIG-7: bonus_allocations.final_amount_minor exists (allocation column not dropped)');
select has_column('public', 'bonus_allocation_snapshots', 'calculation_metadata',
  'D-MIG-8: bonus_allocation_snapshots.calculation_metadata exists (SI-13 source not dropped)');

-- 3. RLS still ENABLED on the most critical ledgers after all migrations.
select ok(
  (select relrowsecurity from pg_class
   where relname = 'point_ledger' and relnamespace = 'public'::regnamespace),
  'D-MIG-9: RLS still enabled on point_ledger after the migration stack');
select ok(
  (select relrowsecurity from pg_class
   where relname = 'bonus_ledger' and relnamespace = 'public'::regnamespace),
  'D-MIG-10: RLS still enabled on bonus_ledger after the migration stack');

select * from finish();
rollback;
