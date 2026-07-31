-- =============================================================================
-- Migration 0018 — exports foundation  (Phase 3)
-- Refs: 14_DATA_DICTIONARY (exports §444-451), 15_RLS_POLICY_MATRIX (exports
--       §149-153), 16 (§8 export machine, SI-3/SI-15), Decision Lock AD6/INV-7,
--       ADR-006 (snapshot immutability / no export without snapshot), ADR-017
--       (money ledger — NOT wired here), ADR-018 (Finance view-only, SI-12),
--       ADR-020. Phase 3 slice ONLY.
--
-- Scope: the payout-export RECORD / container + its INSERT-time guarantees — NOT the
-- export-generation engine. Finance creates an export record; producing the actual
-- file (CSV/XLSX bytes, checksum/row_count, storage write) and the status progression
-- (requested→generated→downloaded) are FUTURE engine work.
--
-- Locked decisions (this slice):
--   A append-only container posture. authenticated has NO UPDATE and NO DELETE grant;
--     a prevent_delete trigger enforces retention ("kalıcı, silinmez" — §451). The
--     `status` enum exists but its progression is deferred to the export engine. NO
--     prevent_mutation trigger — the future service_role engine may fill generated/
--     downloaded metadata (file_path/row_count/checksum) without a schema change.
--   B period=`approved` gate is DEFERRED to the export engine (doc 16 §8 names it, but
--     the exports table's own check list — §449 — is snapshot_id NOT NULL + AD6 only).
--   C `format` is non-empty only (no csv/xlsx enum — forward-compatible).
--   D artifact-presence consistency is deferred: file_path/row_count/checksum stay
--     nullable at `requested` (the engine fills them on generation).
--   E exports.bonus_period_id MUST equal the snapshot's bonus_period_id (cheap
--     divergence guard — enforced in validate_export()).
--   Finance INSERT via the EXISTING `payout.export` permission (NOT server-only —
--     §150). No new permission/role → seeded catalog (test 0001 = 20) unchanged.
--     Actor integrity: the INSERT WITH CHECK also pins `exported_by = auth.uid()` so
--     Finance cannot record another user as the exporter (no actor spoofing).
--   snapshot_id is NOT NULL (SI-3/INV-7 — strongest form).
--   AD6/SI-15: export blocked when the snapshot's calculation_run has ANY allocation
--     with status='pending_missing_cap_basis' OR cap_applied='pending_missing_cap_basis'.
--     Checked against bonus_allocations by snapshot.calculation_run_id (NOT just the
--     snapshot row) via a SECURITY DEFINER trigger — Finance cannot read allocations
--     directly (SI-12), so the guard runs as owner.
--   audit on INSERT is required (§450).
--
-- DELIBERATELY ABSENT (gated / later): payout export GENERATION (CSV/XLSX, checksum/
-- row_count computation, storage), status progression engine, period=`approved` gate,
-- bonus_ledger `payout_exported`/`payout_marked_paid` wiring, mark-paid, Finance
-- aggregate `v_finance_*` views, clawback / post-export dispute effects, notifications,
-- app/API/UI. No new permission. No edits to 0001..0017 / existing tests. Local
-- dev/staging only — never production (ADR-014).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- validate_export(): BEFORE INSERT gate. Re-asserts the snapshot exists in the same
-- org, enforces exports.bonus_period_id = snapshot.bonus_period_id (E), and blocks the
-- export when any allocation for the snapshot's calculation_run is pending cap basis
-- (AD6/SI-15). SECURITY DEFINER so it can read bonus_allocation_snapshots /
-- bonus_allocations regardless of the caller's RLS (Finance is view-excluded — SI-12).
-- plpgsql (not sql) so its body's table refs resolve at call time (defined before the
-- table, matching the codebase's trigger-before-table ordering).
-- -----------------------------------------------------------------------------
create or replace function public.validate_export()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snap_period uuid;
  v_run_id      uuid;
begin
  -- Let the NOT NULL column constraint own the null case (canonical 23502).
  if new.snapshot_id is null then
    return new;
  end if;

  -- Snapshot must exist in the SAME org (belt; the composite FK also enforces this,
  -- but the BEFORE trigger runs first — gives a deterministic error).
  select s.bonus_period_id, s.calculation_run_id
    into v_snap_period, v_run_id
  from public.bonus_allocation_snapshots s
  where s.id = new.snapshot_id and s.organization_id = new.organization_id;

  if not found then
    raise exception 'export snapshot % not found in org % (SI-3/SI-7)', new.snapshot_id, new.organization_id
      using errcode = '23503';
  end if;

  -- (E) The export's period must be the snapshot's period.
  if new.bonus_period_id is distinct from v_snap_period then
    raise exception 'export bonus_period_id % does not match snapshot period %', new.bonus_period_id, v_snap_period
      using errcode = '23514';
  end if;

  -- (AD6/SI-15) No export while any allocation for the snapshot's calculation_run is
  -- pending cap basis — checked against bonus_allocations by run, not just the snapshot.
  if exists (
    select 1 from public.bonus_allocations a
    where a.calculation_run_id = v_run_id
      and (a.status = 'pending_missing_cap_basis' or a.cap_applied = 'pending_missing_cap_basis')
  ) then
    raise exception 'export blocked: calculation run % has pending_missing_cap_basis allocation(s) (AD6/SI-15)', v_run_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_export() is
  'Export INSERT gate: snapshot same-org + exports.bonus_period_id = snapshot period (E) + AD6/SI-15 '
  '(block when the snapshot''s calculation_run has any pending_missing_cap_basis allocation). SECURITY DEFINER.';

-- -----------------------------------------------------------------------------
-- exports (payout export record — financial iz). Append-only; retention permanent.
-- Finance-created (payout.export); generation engine is out of scope this slice.
-- -----------------------------------------------------------------------------
create table public.exports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bonus_period_id uuid not null,
  snapshot_id     uuid not null,                          -- SI-3/INV-7: no export without a snapshot
  exported_by     uuid not null,
  format          text not null,                          -- non-empty; no value-enum (C)
  status          text not null default 'requested',
  file_path       text,                                   -- engine-populated (D)
  row_count       integer,                                -- engine-populated (D)
  checksum        text,                                   -- engine-populated (D)
  created_at      timestamptz not null default now(),
  constraint exports_status_chk check (status in ('requested', 'generated', 'downloaded', 'failed')),
  constraint exports_format_nonempty_chk check (length(btrim(format)) > 0),
  constraint exports_row_count_nonneg_chk check (row_count is null or row_count >= 0),
  constraint exports_checksum_nonempty_chk check (checksum is null or length(btrim(checksum)) > 0),
  constraint exports_file_path_nonempty_chk check (file_path is null or length(btrim(file_path)) > 0),
  -- Same-org composite FKs (SI-7).
  constraint exports_period_org_fk
    foreign key (organization_id, bonus_period_id)
    references public.bonus_periods (organization_id, id),
  constraint exports_snapshot_org_fk
    foreign key (organization_id, snapshot_id)
    references public.bonus_allocation_snapshots (organization_id, id),
  constraint exports_exported_by_org_fk
    foreign key (organization_id, exported_by)
    references public.memberships (organization_id, profile_id)
);

comment on table public.exports is
  'Payout export record (data dict §444-451; SI-3/AD6). snapshot_id NOT NULL (no export without a snapshot); '
  'exports.bonus_period_id must match the snapshot period; AD6/SI-15 blocks export while the snapshot''s run has '
  'a pending_missing_cap_basis allocation. Finance creates via payout.export; append-only (no client UPDATE/'
  'DELETE; prevent_delete retention); status progression + file generation are engine work (out of scope). '
  'RLS read Finance + Auditor only (HR/Manager/Employee/Support excluded). Audited on INSERT. '
  'Sensitivity: financial-critical.';

create index idx_exports_org_created on public.exports (organization_id, created_at);
create index idx_exports_period on public.exports (bonus_period_id);

create trigger trg_exports_validate
  before insert on public.exports
  for each row execute function public.validate_export();

create trigger trg_exports_prevent_delete
  before delete on public.exports
  for each row execute function public.prevent_delete();

create trigger trg_audit_exports
  after insert on public.exports
  for each row execute function public.log_audit();

-- NOTE: NO set_updated_at (no updated_at — append-only immutable record) and NO
-- prevent_mutation (decision A — future service_role engine fills generated/downloaded
-- metadata; authenticated append-only is enforced by the absent UPDATE grant below).

-- =============================================================================
-- RLS (ENABLE + FORCE) + least-privilege grants + policies
-- SELECT: Finance (payout.export) + Auditor. INSERT: Finance (payout.export) — the
-- validate_export() trigger enforces snapshot/period/AD6. No client UPDATE/DELETE.
-- =============================================================================
alter table public.exports enable row level security;
alter table public.exports force row level security;
revoke all on public.exports from anon, authenticated;
grant select, insert on public.exports to authenticated;                          -- NO update, NO delete
grant all on public.exports to service_role;

create policy exports_select on public.exports
  for select to authenticated
  using (
    organization_id = public.current_org()
    and (public.has_permission('payout.export') or public.has_role('auditor'))
  );

create policy exports_insert on public.exports
  for insert to authenticated
  with check (
    organization_id = public.current_org()
    and public.has_permission('payout.export')
    -- actor integrity: Finance may only record itself as the exporter (no spoofing).
    and exported_by = auth.uid()
  );
-- No UPDATE policy/privilege (append-only). No DELETE policy/privilege (prevent_delete + retention).
