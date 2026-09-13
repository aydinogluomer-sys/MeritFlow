-- =============================================================================
-- Migration 0049 — Opportunity Intelligence, slice 2-B: AUDITED opportunity-flag resolution.
-- Refs: implementation_product_9_modules §2.7 (opportunity flag resolution MUST be audited), §2.8
--       (insight status lifecycle), §4.8/§4.9 (manager reviews/resolves their team's flags), §26
--       (Opportunity gate: advisory, no protected-attribute pay decision); CLAUDE.md (every critical
--       mutation is audited). Local dev/staging only (ADR-014).
--
-- Scope (2-B): make RESOLVING an opportunity_flag insight (a §2.8 status transition on
-- intelligence_insights) a first-class, AUDITED, human-review action. 0042 introduced
-- intelligence_insights with SERVER-ONLY writes and NO audit on mutation ("opening an analytics record
-- is not an audited business mutation" — true for INSERT/detection). But §2.7 requires the RESOLUTION
-- (reviewed → accepted|dismissed) to be audited, and §4.8/§4.9 make the responsible MANAGER (or an
-- intelligence.manage holder) the resolver. This migration therefore:
--   (1) audits every intelligence_insights UPDATE (resolutions) via log_audit — INSERT stays unaudited;
--   (2) permits an authenticated UPDATE ONLY for insight_type='opportunity_flag' AND only by an
--       intelligence.manage holder (owner/admin) OR the manager of the subject employee's PRIMARY team
--       (manages_team(team_of(subject_id)) — no cross-team resolution). All other insight types + all
--       other writers remain server-only. The resolver acts through the RLS user client so auth.uid()
--       is the audited actor. Resolution NEVER changes pay/policy/ledger (advisory, §26).
-- Reuses log_audit / current_org / has_permission / manages_team / team_of — adds NO new SECURITY
-- DEFINER function, NO new table, NO new column (so database.generated.ts does NOT drift).
-- =============================================================================

-- (1) Audit resolutions: every UPDATE (status transition incl. accepted/dismissed) is written to
--     audit_logs (§2.7). INSERT still fires no audit (analytics detection is not an audited mutation).
create trigger trg_audit_intelligence_insights_update
  after update on public.intelligence_insights
  for each row execute function public.log_audit();

-- (2) Authenticated UPDATE for opportunity-flag resolution only, gated by intelligence.manage OR the
--     subject employee's PRIMARY-team manager (no cross-team resolution). Server-role writes (the
--     engine's INSERT + any future server transition) are unaffected. The §2.8 transition legality is
--     additionally enforced in TS (IntelligenceRepository.transition / assertTransition).
-- COLUMN-restricted UPDATE: a resolver may only touch the resolution columns (status/resolved_at/
-- resolution_code) — NEVER the AUTHORITATIVE deterministic_payload / evidence_refs / subject_id /
-- insight_type / severity (0042 labels those reproducible/authoritative). Column-level privilege +
-- the row policy below are the security boundary (not the TS layer).
grant update (status, resolved_at, resolution_code) on public.intelligence_insights to authenticated;

create policy intelligence_insights_update on public.intelligence_insights
  for update to authenticated
  using (
    organization_id = public.current_org()
    and insight_type = 'opportunity_flag'
    and (
      public.has_permission('intelligence.manage')
      or (subject_type = 'employee' and public.manages_team(public.team_of(subject_id)))
    )
  )
  with check (
    organization_id = public.current_org()
    and insight_type = 'opportunity_flag'
    and (
      public.has_permission('intelligence.manage')
      or (subject_type = 'employee' and public.manages_team(public.team_of(subject_id)))
    )
  );
-- No INSERT/DELETE policy for authenticated → detection + deletion stay server-only.
