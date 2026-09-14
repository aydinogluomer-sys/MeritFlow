-- =============================================================================
-- Migration 0050 — Finance money-delta views (Phase P4 / Module 8-B3)
-- Refs: implementation_product_9_modules §10.4 (Financial Intelligence tier iii), §24 (metric author),
--       §26; CLAUDE.md SI-12 (Finance NEVER sees raw points/comp — aggregate money ONLY).
--
-- Adds THREE definer-rights VIEWS backing the 8-B2 deferred money-delta cards (cap money impact,
-- per-team payout, cost-per-employee). NO new table / column / permission / trigger.
--
-- WHY definer-rights (security_invoker DELIBERATELY OMITTED, so the view runs as its OWNER = the
-- migration superuser and BYPASSES the underlying RLS): the money sources are RLS-scoped so Finance
-- CANNOT read them directly —
--   * bonus_allocations SELECT RLS (0013:386) = employee-own / HR / Auditor / support — Finance EXCLUDED
--     (backs v_finance_cap_impact AND, via the run's frozen allocation snapshot team, v_finance_team_cost);
--   * memberships SELECT RLS (0007:123) = user.invite / HR / owner / admin / auditor — Finance EXCLUDED
--     (backs the v_finance_cost_per_employee active-headcount COUNT).
-- (team_memberships is NOT read: team attribution uses the FROZEN snapshot team, not the live roster.)
-- A security_invoker view would therefore return 0 rows for a Finance caller (under-expose). Each view
-- instead runs as owner and SELF-ENFORCES access with an explicit WHERE gate:
--   organization_id = public.current_org()  (tenant isolation — never another org)
--   AND (public.has_role('hr') OR public.has_role('finance') OR public.has_role('auditor'))
-- has_role()/current_org() are SECURITY DEFINER helpers reading auth.uid() (the CALLER's JWT sub), so the
-- gate evaluates the CALLER's role/org even though the view body executes as owner. Every reference is
-- fully-qualified public.* (no search_path dependence). A non-authorized or cross-tenant caller matches
-- NO rows (honest empty, never a fake value). SI-12: each view projects ONLY organization_id +
-- bonus_period_id (+ team_id where applicable) + a single aggregate minor-currency column (+ an
-- active_headcount COUNT scalar) — NEVER raw_share/final/cap_minor/cap_basis/adjusted_score/points/comp
-- or any per-employee row. Local dev/staging only — never production (ADR-014).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_finance_cap_impact — per (period, primary team) cap money withheld.
-- cap_impact_minor = Σ(raw_share_minor − final_amount_minor) FILTER (cap_applied='yes'), ≥ 0 by INV-4
-- (bonus_allocations_cap_not_exceeded_chk: cap_applied='yes' ⟹ final_amount_minor ≤ cap_minor;
-- raw_share_minor is the pre-cap proportional share, so raw−final is exactly the cap-withheld money).
-- -----------------------------------------------------------------------------
create view public.v_finance_cap_impact as
select
  ba.organization_id,
  ba.bonus_period_id,
  ba.primary_team_id as team_id,
  coalesce(sum(ba.raw_share_minor - ba.final_amount_minor) filter (where ba.cap_applied = 'yes'), 0)::bigint
    as cap_impact_minor
from public.bonus_allocations ba
where ba.organization_id = public.current_org()
  and (public.has_role('hr') or public.has_role('finance') or public.has_role('auditor'))
group by ba.organization_id, ba.bonus_period_id, ba.primary_team_id;

comment on view public.v_finance_cap_impact is
  'SI-12 cap money impact (definer-rights; self-gated org=current_org() + hr/finance/auditor): per '
  '(period, primary team AD9) Σ(raw_share_minor − final_amount_minor) for cap_applied=yes. Aggregate '
  'money ONLY — NO raw_share/final/cap_minor/cap_basis/adjusted_score/points/comp/per-employee row.';

-- -----------------------------------------------------------------------------
-- v_finance_team_cost — per (period, SNAPSHOT primary team) net accrual. Team is the FROZEN allocation
-- snapshot team (bonus_allocations.primary_team_id, AD9 is_primary snapshot) — the SAME attribution rule
-- as v_finance_cap_impact, so the two per-(period,team) money cards are consistent and a closed period's
-- attribution is immutable/auditable (a later LIVE team change does NOT drift the breakdown; team_memberships
-- is deliberately NOT read). Each ledger row's team is resolved via the run's allocation on the unique key
-- (calculation_run_id, employee_id) = bonus_allocations_run_emp_uq → strictly 1:1, no fan-out. LEFT join so
-- an accrual with no matching allocation still counts under team_id = NULL (Σ preserved); a NULL snapshot
-- team also groups under NULL (same as cap_impact). Keeps the IDENTICAL net-accrual formula as
-- v_finance_payout / v_finance_period_totals (0027) so Σ team_cost over teams reconciles to payout_total /
-- total_accrued. Done as owner because bonus_allocations RLS excludes Finance.
-- -----------------------------------------------------------------------------
create view public.v_finance_team_cost as
select
  bl.organization_id,
  s.bonus_period_id,
  ba.primary_team_id as team_id,
  (coalesce(sum(bl.amount_minor) filter (where bl.event_type = 'bonus_accrual' and bl.account = 'accrual' and bl.entry_type = 'credit'), 0)
   - coalesce(sum(bl.amount_minor) filter (where bl.event_type = 'reversal' and bl.account = 'accrual' and bl.entry_type = 'debit'), 0))::bigint
    as team_cost_minor
from public.bonus_ledger bl
join public.bonus_allocation_snapshots s
  on s.id = bl.snapshot_id and s.organization_id = bl.organization_id
left join public.bonus_allocations ba
  on ba.calculation_run_id = s.calculation_run_id
  and ba.employee_id = bl.employee_id
  and ba.organization_id = bl.organization_id
where bl.employee_id is not null
  and bl.organization_id = public.current_org()
  and (public.has_role('hr') or public.has_role('finance') or public.has_role('auditor'))
group by bl.organization_id, s.bonus_period_id, ba.primary_team_id;

comment on view public.v_finance_team_cost is
  'SI-12 per-team payout cost (definer-rights; self-gated org+hr/finance/auditor): per (period, SNAPSHOT '
  'primary team = bonus_allocations.primary_team_id, AD9 — SAME attribution as v_finance_cap_impact, frozen '
  'for a closed period) Σ net accrual — IDENTICAL bonus_ledger net-accrual formula as v_finance_payout, so '
  'Σ over teams reconciles to payout_total. LEFT join to the run allocation (unique run+employee); a missing '
  'allocation / NULL team groups under team_id = NULL (Σ preserved). Aggregate money ONLY — NO per-employee '
  'row/points/comp/cap_basis. team_memberships (live roster) is deliberately NOT read.';

-- -----------------------------------------------------------------------------
-- v_finance_cost_per_employee — per period: net accrual ÷ active headcount. Numerator uses the IDENTICAL
-- net-accrual formula as v_finance_period_totals.total_accrued, so cost_per_employee·headcount reconciles
-- to total_accrued. Headcount is a COUNT scalar over memberships (status='active') — done as owner
-- because memberships RLS excludes Finance; NO membership row is projected.
-- -----------------------------------------------------------------------------
create view public.v_finance_cost_per_employee as
select
  bp.organization_id,
  bp.id as bonus_period_id,
  hc.active_headcount,
  -- FLOOR the quotient: total_accrued is numeric (sum(bigint) → numeric), so a bare ::bigint cast would
  -- ROUND (numeric_int8 rounds half-away-from-zero), not truncate. floor()::bigint gives the floored
  -- minor-currency value, matching the repo money convention (0021/0022 bonus engine) and the 0049 golden.
  floor(led.total_accrued / nullif(hc.active_headcount, 0))::bigint as cost_per_employee_minor
from public.bonus_periods bp
left join lateral (
  select
    coalesce(sum(bl.amount_minor) filter (where bl.event_type = 'bonus_accrual' and bl.account = 'accrual' and bl.entry_type = 'credit'), 0)
      - coalesce(sum(bl.amount_minor) filter (where bl.event_type = 'reversal' and bl.account = 'accrual' and bl.entry_type = 'debit'), 0)
        as total_accrued
  from public.bonus_ledger bl
  join public.bonus_allocation_snapshots s2
    on s2.id = bl.snapshot_id and s2.organization_id = bl.organization_id
  where s2.bonus_period_id = bp.id
) led on true
cross join lateral (
  select count(*)::bigint as active_headcount
  from public.memberships m
  where m.organization_id = bp.organization_id and m.status = 'active'
) hc
where bp.organization_id = public.current_org()
  and (public.has_role('hr') or public.has_role('finance') or public.has_role('auditor'));

comment on view public.v_finance_cost_per_employee is
  'SI-12 cost per employee (definer-rights; self-gated org+hr/finance/auditor): per period '
  'floor(net accrual / active headcount) — net accrual is the IDENTICAL formula to '
  'v_finance_period_totals.total_accrued; headcount is a memberships status=active COUNT scalar. '
  'Aggregate money + a headcount scalar ONLY — NO membership row, NO points/comp/cap_basis. '
  'floor(cost_per_employee)·headcount reconciles to total_accrued within < headcount minor units.';

-- -----------------------------------------------------------------------------
-- Grants: revoke from anon/public; SELECT to authenticated (row visibility gated by the view's own
-- WHERE org+role predicate — effectively HR/Finance/Auditor for their own org) + service_role.
-- -----------------------------------------------------------------------------
revoke all on public.v_finance_cap_impact from public, anon;
revoke all on public.v_finance_team_cost from public, anon;
revoke all on public.v_finance_cost_per_employee from public, anon;
grant select on public.v_finance_cap_impact to authenticated, service_role;
grant select on public.v_finance_team_cost to authenticated, service_role;
grant select on public.v_finance_cost_per_employee to authenticated, service_role;
