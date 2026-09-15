-- =============================================================================
-- Migration 0051 — Finance dispute-recalc money view (Phase P4 / dispute financial impact)
-- Refs: implementation_product_9_modules §10.4 (Financial Intelligence — İtiraz Finansal Etkisi),
--       §24 (metric author), §26; CLAUDE.md SI-12 (Finance NEVER sees raw points/comp — aggregate money
--       ONLY). Builds on 0026 (7-C mechanical recalc) + 0029 (7-E full re-run orchestration) which write
--       the dispute money footprint into bonus_ledger, and 0050 (the SI-12 definer-rights view template).
--
-- Adds ONE definer-rights VIEW backing the deferred "İtiraz Finansal Etkisi" card as the period-level
-- NET money change caused by dispute recalculations. NO new table / column / permission / trigger.
--
-- WRITE PATH (0029): a dispute recalculation (a) mirrors the original accrual on snapshot S1 as balanced
-- `reversal` rows tagged metadata.dispute_recalc=true (reverses_snapshot=S1) — amount == S1's accrual —,
-- (b) supersedes the original run, then (c) re-runs run_bonus_calculation() with the deterministic
-- idempotency_key 'disp-recalc-snap-' || <S1> → a new run + snapshot S2 whose fresh bonus_accrual is
-- posted on re-approval. So the two dispute-attributable money legs in bonus_ledger are:
--   * the RE-RUN accrual  = bonus_accrual credits on snapshots whose run.idempotency_key LIKE
--                           'disp-recalc-snap-%'   (the money re-added by the dispute recalc), and
--   * the REVERSED accrual = reversal debits tagged metadata.dispute_recalc='true' (the money unwound).
--
-- NET SEMANTICS (proven, NOT the gross reversal — §23):
--   dispute_recalc_net_minor(period) = Σ(re-run accrual credit) − Σ(dispute_recalc reversal debit).
-- Because each reversal amount equals the reversed snapshot's accrual, this equals S_final − S_original
-- and is correct across ARBITRARY dispute cycles (n cycles: reversed={S1..Sn}, re-run={S2..S(n+1)} →
-- Σre-run − Σreversed = S(n+1) − S1). A period never touched by a dispute recalc has neither leg → NET 0
-- (honest: no dispute financial impact). Same net-accrual account/entry_type filters as 0027/0050
-- (account='accrual'; credit for accrual, debit for reversal) so the money reconciles with the ledger.
-- LIMITS (honesty): PERIOD-LEVEL, not per-dispute (bonus_ledger money rows carry no dispute_id — only the
-- dispute_recalc tag + reverses_snapshot); per-dispute attribution stays an unblock-spec.
--
-- WHY definer-rights (security_invoker DELIBERATELY OMITTED → runs as OWNER, bypassing the underlying RLS):
-- bonus_ledger SELECT RLS (0014:211) = Finance/Auditor only; bonus_allocation_snapshots + runs are
-- likewise RLS-scoped away from a bare Finance read of the aggregate. A security_invoker view could
-- under-expose. The view instead self-enforces the CALLER's access with an explicit WHERE gate:
--   organization_id = public.current_org()  (tenant isolation — never another org)
--   AND (public.has_role('hr') OR public.has_role('finance') OR public.has_role('auditor'))
-- has_role()/current_org() are SECURITY DEFINER helpers reading auth.uid() (the CALLER's JWT sub), so the
-- gate evaluates the CALLER even though the body runs as owner. Every reference is fully-qualified public.*
-- (no search_path dependence). A non-authorized or cross-tenant caller matches NO rows (honest empty, never
-- a fake value). SI-12: the view projects ONLY organization_id + bonus_period_id + one aggregate
-- minor-currency column — NEVER a per-employee row / points / comp / dispute detail. Local dev/staging
-- only — never production (ADR-014).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_finance_dispute_recalc_money — per period: NET money change caused by dispute recalculations.
-- One row per bonus_period (FROM bonus_periods) so an AUTHORIZED empty read == RLS-deny (matches the 0050
-- money-metric "empty → honest unavailable" invariant); a no-dispute period reports a true NET 0.
-- -----------------------------------------------------------------------------
create view public.v_finance_dispute_recalc_money as
select
  bp.organization_id,
  bp.id as bonus_period_id,
  coalesce(led.dispute_recalc_net_minor, 0)::bigint as dispute_recalc_net_minor
from public.bonus_periods bp
left join lateral (
  select
    coalesce(sum(bl.amount_minor) filter (
      where bl.event_type = 'bonus_accrual' and bl.account = 'accrual' and bl.entry_type = 'credit'
        and r.idempotency_key like 'disp-recalc-snap-%'), 0)
    - coalesce(sum(bl.amount_minor) filter (
      where bl.event_type = 'reversal' and bl.account = 'accrual' and bl.entry_type = 'debit'
        and (bl.metadata ->> 'dispute_recalc') = 'true'), 0)
      as dispute_recalc_net_minor
  from public.bonus_ledger bl
  join public.bonus_allocation_snapshots s
    on s.id = bl.snapshot_id and s.organization_id = bl.organization_id
  join public.bonus_calculation_runs r
    on r.id = s.calculation_run_id and r.organization_id = s.organization_id
  where s.bonus_period_id = bp.id
    and bl.organization_id = bp.organization_id
) led on true
where bp.organization_id = public.current_org()
  and (public.has_role('hr') or public.has_role('finance') or public.has_role('auditor'));

comment on view public.v_finance_dispute_recalc_money is
  'SI-12 dispute financial impact (definer-rights; self-gated org=current_org() + hr/finance/auditor): per '
  'period NET dispute-recalc money = Σ(re-run bonus_accrual credit, run.idempotency_key like '
  '''disp-recalc-snap-%'') − Σ(dispute_recalc-tagged reversal debit). Equals S_final − S_original across '
  'arbitrary dispute cycles (NOT the gross reversal). Aggregate money ONLY — NO per-employee row / points / '
  'comp / dispute detail. PERIOD-LEVEL, not per-dispute (money rows carry no dispute_id).';

-- -----------------------------------------------------------------------------
-- Grants: revoke from anon/public; SELECT to authenticated (row visibility gated by the view's own WHERE
-- org+role predicate — effectively HR/Finance/Auditor for their own org) + service_role.
-- -----------------------------------------------------------------------------
revoke all on public.v_finance_dispute_recalc_money from public, anon;
grant select on public.v_finance_dispute_recalc_money to authenticated, service_role;
