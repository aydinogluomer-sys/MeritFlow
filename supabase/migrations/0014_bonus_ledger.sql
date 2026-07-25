-- =============================================================================
-- Migration 0014 — bonus_ledger (double-entry money) + approve→accrual foundation
-- Refs: 06_LEDGER_AUDIT_SPEC §2 (bonus ledger accounts + balanced movements),
--       14_DATA_DICTIONARY (bonus_ledger), 15_RLS_POLICY_MATRIX (bonus_ledger §),
--       16 (BL-1..BL-4, SI-3/SI-6/SI-7/SI-12, INV-7), ADR-005/006/017/018,
--       Decision Lock D2/AD6. Phase 3 slice ONLY.
--
-- Scope: the money-ledger CONTAINER + its integrity guarantees (no posting engine).
-- One append-only, double-entry table; RLS (ENABLE + FORCE) + least-privilege grants
-- + policies (Finance + Auditor raw read; server-only writes); same-org composite FKs
-- (pool/run/snapshot/employee); INSERT audit (BL-4); a per-(org, transaction_id)
-- DEFERRABLE INITIALLY DEFERRED balance trigger that HARD-enforces Σdebit = Σcredit;
-- structural accrual→snapshot link; idempotent accrual; and an event_type write guard
-- that keeps only bonus_accrual + reversal writable in this slice.
--
-- Confirmed design decisions (this slice):
--   (1) RLS raw read = Finance + Auditor ONLY (HR/Manager/Employee AND support-grant
--       excluded — no support path on the money ledger; employee summary is a future
--       v_finance_* view — SI-12). — decision 1.
--   (2) accrual→snapshot is STRUCTURAL only: event_type='bonus_accrual' ⇒ snapshot_id
--       NOT NULL + same-org FK. The "snapshot must be APPROVED" business gate is
--       DEFERRED to Phase 6 (no approval workflow here). — decision 2.
--   (3) The same-org snapshot FK needs bonus_allocation_snapshots unique(id,
--       organization_id); added here as an additive ALTER (0013 only had
--       unique(calculation_run_id)) — 0013 is NOT modified. — decision 3.
--   (4) event_type enum is forward-compatible (accrual/approved/payout/clawback/
--       reversal) but only 'bonus_accrual' + 'reversal' are writable in this slice;
--       payout_*/clawback_*/bonus_approved are rejected by a BEFORE-INSERT guard. — dec 4.
--   (5) Σdebit = Σcredit per (organization_id, transaction_id) is HARD-enforced by a
--       DEFERRABLE INITIALLY DEFERRED constraint trigger — this is a ledger integrity
--       guard, NOT a calculation engine. — decision 5.
--   (6) BL-2 (Σaccrual ≤ pool) and BL-3 (payout ≤ accrual) are NOT hard-enforced here;
--       they stay documented + seed/test-verified. — decision 6.
--
-- DELIBERATELY ABSENT (gated / later): the approve→accrual POSTING engine (reading an
-- approved snapshot and generating balanced pairs from allocations), snapshot approval
-- workflow, payout/export (payout_exported/marked_paid, exports, v_finance_* views),
-- clawback workflow, dispute→reversal wiring, scoring/bonus engines, app/UI/API. No
-- edits to 0001..0013 / existing tests. Local dev/staging only — never production
-- (ADR-014).
-- =============================================================================

-- Additive (permitted ALTER on an earlier table; mirrors the 0009/0012 pattern) —
-- decision 3: needed so bonus_ledger can carry a same-org composite FK to the snapshot.
alter table public.bonus_allocation_snapshots
  add constraint bonus_allocation_snapshots_id_org_uq unique (id, organization_id);

-- -----------------------------------------------------------------------------
-- validate_bonus_ledger_event(): in THIS slice only 'bonus_accrual' and 'reversal'
-- are writable. Approval/payout/clawback events (bonus_approved, payout_exported,
-- payout_marked_paid, clawback_pending, clawback_approved) are forward-compat enum
-- values whose posting belongs to later phases; writing them is rejected here (dec 4).
-- -----------------------------------------------------------------------------
create or replace function public.validate_bonus_ledger_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_type not in ('bonus_accrual', 'reversal') then
    raise exception 'bonus_ledger event_type % is deferred to a later phase (approval/payout/clawback) — only bonus_accrual and reversal are writable in this slice',
      new.event_type using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.validate_bonus_ledger_event() is
  'Blocks approval/payout/clawback event_types in this slice (forward-compat enum; later phase).';

-- -----------------------------------------------------------------------------
-- enforce_bonus_ledger_balance(): double-entry integrity (ADR-017). For the affected
-- (organization_id, transaction_id) group, Σ(amount where debit) must equal Σ(amount
-- where credit). Attached as a DEFERRABLE INITIALLY DEFERRED constraint trigger so the
-- check runs when the balanced pair/batch is complete (at COMMIT, or when constraints
-- are set IMMEDIATE) — not row-by-row. SECURITY DEFINER so it can read the ledger
-- regardless of RLS. This is a ledger integrity guard, NOT a calculation engine.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_bonus_ledger_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debit  bigint;
  v_credit bigint;
begin
  select
    coalesce(sum(amount_minor) filter (where entry_type = 'debit'), 0),
    coalesce(sum(amount_minor) filter (where entry_type = 'credit'), 0)
  into v_debit, v_credit
  from public.bonus_ledger
  where organization_id = new.organization_id
    and transaction_id = new.transaction_id;

  if v_debit <> v_credit then
    raise exception 'bonus_ledger transaction % is unbalanced: debit % <> credit % (Σdebit must equal Σcredit — ADR-017/BL)',
      new.transaction_id, v_debit, v_credit using errcode = '23514';
  end if;
  return null;
end;
$$;

comment on function public.enforce_bonus_ledger_balance() is
  'Double-entry balance guard: Σdebit = Σcredit per (organization_id, transaction_id); deferred to commit (ADR-017).';

-- -----------------------------------------------------------------------------
-- bonus_ledger (double-entry, money — ADR-017). Append-only; financial-critical.
-- Rows are STORED here (no posting engine): the balanced accrual pairs are produced
-- by the (future Phase 6) approve→accrual engine; this slice only provides the
-- container + guarantees. No updated_at (append-only).
-- -----------------------------------------------------------------------------
create table public.bonus_ledger (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  bonus_pool_id      uuid not null,
  employee_id        uuid,                                  -- null for org-level (pool) entries
  calculation_run_id uuid,
  snapshot_id        uuid,                                  -- required for accrual (below)
  transaction_id     uuid not null,                         -- balanced group (Σdebit=Σcredit)
  entry_type         text not null,
  account            text not null,
  event_type         text not null,
  amount_minor       bigint not null,
  currency           text not null default 'TRY',
  reason             text,
  created_by         uuid not null references public.profiles(id),
  created_at         timestamptz not null default now(),
  metadata           jsonb not null default '{}'::jsonb,
  constraint bonus_ledger_entry_type_chk check (entry_type in ('debit', 'credit')),
  constraint bonus_ledger_account_chk    check (account in ('pool', 'accrual', 'payout', 'clawback')),
  constraint bonus_ledger_event_type_chk check (event_type in
    ('bonus_accrual', 'bonus_approved', 'payout_exported', 'payout_marked_paid',
     'clawback_pending', 'clawback_approved', 'reversal')),
  constraint bonus_ledger_amount_pos_chk check (amount_minor > 0),
  constraint bonus_ledger_currency_chk   check (char_length(currency) = 3),
  -- Structural accrual→snapshot link (SI-3/INV-7); the "approved" gate is deferred.
  constraint bonus_ledger_accrual_snapshot_chk
    check (event_type <> 'bonus_accrual' or snapshot_id is not null),
  -- An accrual CREDIT is per-employee (makes idempotency meaningful; pool debit is org-level).
  constraint bonus_ledger_accrual_employee_chk
    check (not (event_type = 'bonus_accrual' and account = 'accrual') or employee_id is not null),
  -- Same-org composite FKs (structural cross-tenant safety, SI-7).
  constraint bonus_ledger_pool_org_fk
    foreign key (bonus_pool_id, organization_id)
    references public.bonus_pools (id, organization_id) on delete cascade,
  constraint bonus_ledger_run_org_fk
    foreign key (calculation_run_id, organization_id)
    references public.bonus_calculation_runs (id, organization_id) on delete cascade,
  constraint bonus_ledger_snapshot_org_fk
    foreign key (snapshot_id, organization_id)
    references public.bonus_allocation_snapshots (id, organization_id) on delete cascade,
  constraint bonus_ledger_employee_org_fk
    foreign key (organization_id, employee_id)
    references public.memberships (organization_id, profile_id)
);

comment on table public.bonus_ledger is
  'Double-entry money ledger (ADR-017): entry_type debit/credit, account pool/accrual/payout/clawback. '
  'Append-only (UPDATE/DELETE forbidden; correction = reversal). Σdebit=Σcredit per (org, transaction_id) '
  'enforced by a deferred balance trigger. Accrual requires a snapshot (structural; approved-gate deferred). '
  'This slice writes only bonus_accrual + reversal. Server-only writes; raw read Finance/Auditor only '
  '(SI-12). Sensitivity: financial-critical, audit-critical.';

-- Idempotent accrual: one accrual per (snapshot, employee, account) — dedupes the
-- per-employee credit rows (pool debit carries a null employee and is guarded via the
-- credit rows aborting a re-post). Partial to accrual events only.
create unique index uq_bonus_ledger_accrual_idem
  on public.bonus_ledger (snapshot_id, employee_id, account)
  where event_type = 'bonus_accrual';

create index idx_bonus_ledger_pool_account on public.bonus_ledger (bonus_pool_id, account);
create index idx_bonus_ledger_employee on public.bonus_ledger (employee_id);
create index idx_bonus_ledger_snapshot on public.bonus_ledger (snapshot_id);
create index idx_bonus_ledger_txn on public.bonus_ledger (organization_id, transaction_id);

-- Event-type write guard (BEFORE INSERT).
create trigger trg_bonus_ledger_validate_event
  before insert on public.bonus_ledger
  for each row execute function public.validate_bonus_ledger_event();

-- Append-only (BL-1): block UPDATE/DELETE entirely (correction = reversal row).
create trigger trg_bonus_ledger_append_only
  before update or delete on public.bonus_ledger
  for each row execute function public.prevent_mutation();

-- Double-entry balance (ADR-017): deferred to commit so a balanced pair/batch passes.
create constraint trigger trg_bonus_ledger_balance
  after insert on public.bonus_ledger
  deferrable initially deferred
  for each row execute function public.enforce_bonus_ledger_balance();

-- Audit (BL-4): every money mutation (here: INSERT) produces an audit row.
create trigger trg_audit_bonus_ledger
  after insert on public.bonus_ledger
  for each row execute function public.log_audit();

-- =============================================================================
-- RLS (ENABLE + FORCE) + least-privilege grants + policies
-- Server-only writes (money posting is trusted/server). Raw read = Finance + Auditor
-- ONLY (HR/Manager/Employee AND support-grant excluded — no support path on the money
-- ledger; employee summary is a future v_finance_* view — SI-12).
-- =============================================================================
alter table public.bonus_ledger enable row level security;
alter table public.bonus_ledger force row level security;
revoke all on public.bonus_ledger from anon, authenticated;
grant select on public.bonus_ledger to authenticated;                             -- SELECT only
grant all on public.bonus_ledger to service_role;

create policy bonus_ledger_select on public.bonus_ledger
  for select to authenticated
  using (
    organization_id = public.current_org()
    and (public.has_role('finance') or public.has_role('auditor'))
  );
-- No support-grant path (raw money ledger is Finance/Auditor only — decision 1).
-- No INSERT/UPDATE/DELETE policy and no privilege (server-only, append-only writes).
