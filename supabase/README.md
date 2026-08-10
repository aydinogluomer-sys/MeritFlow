# MeritFlow — Supabase (Database Foundation: Phase 3A–3B + comp + bonus periods/pools + components/eligibility + calc runs/allocations/snapshots + ledger + disputes + anti-gaming + notifications + exports)

This directory is the **database foundation**. It currently implements twenty-three verified
slices — the twelve Phase 3 DB slices (**Phase 3 DB foundation complete**), the
**Phase 4 task/review core** (`tasks` + `task_events` + `task_reviews`), the
**Phase 5 scoring engine** (approve → `point_ledger task_approved`), the
**Phase 6 bonus engine** (`run_bonus_calculation()` → allocations + immutable snapshot), the
**Phase 6-b bonus_ledger accrual** (`post_bonus_accrual()` → double-entry accrual from an approved snapshot), the
**Phase 6-d bonus engine authz hardening** (`run_bonus_calculation`/`post_bonus_accrual` → `auth.uid() IS NULL` trusted-context authz), the
**Phase 7-A anti-gaming detection engine** (`run_anti_gaming_scan()` → 4 deterministic rules → `anti_gaming_flags`, ledger-isolated), the
**Phase 7-B dispute point adjustment** (`apply_dispute_point_adjustment()` → resolved+accepted dispute → `point_ledger dispute_adjustment`), the
**Phase 7-C dispute bonus recalculation** (`recalculate_bonus_after_dispute()` → run superseded + period `approved→calculated` + `bonus_ledger` reversal; paid-guard D2; idempotent; C-c1 reduced scope), the
**Phase 7-D dispute_adjustment → bonus basis** (`point_ledger` + `bonus_period_id` attribution column; `run_bonus_calculation()` NET approved_points = task_approved + dispute_adjustment; gate `IN('locked','calculated')`; `dispute_adjustment_points` factors breakdown), the
**Phase 7-E dispute bonus re-run orchestration** (`recalculate_bonus_after_dispute()` upgraded from C-c1 to full orchestration: reversal + new `run_bonus_calculation()` call → new run/snapshot reflecting the `dispute_adjustment`; period stays `calculated` — ADR-006 human re-approval; idempotent; deterministic key tied to reversed snapshot), and the
**Phase 6-c payout/export engine** (`produce_payout_export()` + `mark_payout_paid()` → `exports` record + period `approved→exported→closed` + per-employee `payout_marked_paid` double-entry + BL-3 deferred payout-cap trigger + `v_finance_payout`/`v_finance_period_totals` security_invoker views):

- **Phase 3A — Database Foundation & RBAC** (`17_PHASE_3A_...md`): 11 foundation/RBAC
  tables, RLS helpers, RLS (ENABLED + FORCE), constraints, test-tenant seed, blocking pgTAP.
- **Phase 3B-A — Scoring Policy foundation** (`18_PHASE_3B_...md` §5.1/5.2): `scoring_policies`
  and `scoring_policy_versions` (immutable once published, AD7), `policy.manage`, RLS + pgTAP.
- **Phase 3B-B — Point Ledger foundation** (`18` §5.3/§7): append-only single-entry `point_ledger`,
  `team_of()` helper, server-only writes, RLS + pgTAP.
- **Phase 3 — compensation_records** (`14`/`15`, ADR-018): comp-sensitive salary / cap-basis source
  with **direct raw SELECT closed**, comp.read-gated INSERT/UPDATE, supersede-only retention
  (DELETE blocked), MASKED write/access audit, and an audited + justified
  `read_compensation_record(employee, reason)` — RLS + pgTAP.
- **Phase 3 — bonus_periods + bonus_pools** (`14`/`15`/`16` §3, AD10): period lifecycle state machine +
  pool (one active per period); **AD10 pool-lock-before-period-lock**; a locked pool requires
  `t_org` + `locked_at` + `locked_by` and its financial fields are immutable; locked/non-open period
  identity (dates/type/org) is immutable (SI-4); `period.manage` / `pool.create` separation — RLS + pgTAP.
- **Phase 3 — bonus_pool_components + bonus_pool_eligibility** (`14`/`15`/`16` §3, D1/D10/AD9/AD10): MVP
  **Safe Pro-Rata** component model (`individual` = 1.0 only) + eligibility rows; component/eligibility carry a
  **same-org composite FK** to `bonus_pools`; eligibility `employee_id` is a **same-org composite FK to
  `memberships`** (cross-tenant employees structurally impossible); `primary_team_id` is same-org + **AD9**
  `team_memberships.is_primary` validation; eligibility writes are **server-only** (employee-own + HR/Finance/
  Auditor read), component writes gated by `pool.create`; component and eligibility inputs become **immutable
  once the parent pool leaves `draft`** (SI-4) — RLS + pgTAP.
- **Phase 3 — bonus_calculation_runs + bonus_allocations + bonus_allocation_snapshots** (`14`/`15`/`16` §4–§5,
  D1/D6/AD6/AD7/AD9/AD10): the calculation **scaffolding** (no engine/math). Run state machine
  `running → completed → superseded`; a run starts only on a **locked period AND a locked pool** (AD10 double
  guard); **idempotency** `unique(organization_id, idempotency_key)`; once a run is `completed`, its allocations
  are **frozen** (blanket — amount/status/cap/team/policy/run bindings; SI-4/SI-14); a **thin** snapshot is
  **append-only immutable** (UPDATE/DELETE hard-blocked; per-employee detail lives in allocations, not
  duplicated); allocations carry a **cap-not-exceeded** CHECK + `cap_applied` enum (incl.
  `pending_missing_cap_basis` — AD6); `approved/exported/paid` transitions are **blocked** this slice;
  same-org composite FKs (period/pool/policy_version/run/employee/team); **server-only** writes with
  employee-own allocation read (Finance raw excluded — view-only, SI-12); `Σfinal + undistributed_remainder =
  pool` is **test/fixture-verified only** (no hard trigger — SI-13/INV-4) — RLS + pgTAP.
- **Phase 3 — bonus_ledger** (`06 §2`, `14`/`15`/`16`, ADR-017): append-only **double-entry** money ledger
  (`entry_type` debit/credit, `account` pool/accrual/payout/clawback); correction = reversal (UPDATE/DELETE
  hard-blocked — BL-1); a **DEFERRABLE INITIALLY DEFERRED balance trigger** hard-enforces
  `Σdebit = Σcredit` per `(organization_id, transaction_id)`; accrual requires `snapshot_id` (structural SI-3;
  approved-gate deferred to Phase 6); idempotent accrual `unique(snapshot_id, employee_id, account)`; only
  `bonus_accrual` + `reversal` are writable this slice (payout/clawback/approval events blocked by a guard);
  raw SELECT is **Finance + Auditor only** (HR/Employee/Manager/Support excluded — SI-12); **server-only**
  writes; same-org composite FKs (pool/run/snapshot/employee); INSERT audit (BL-4) — RLS + pgTAP.
- **Phase 3 — disputes + dispute_events** (`07`, `14`/`15`/`16` §6, D9): the dispute lifecycle. `disputes` is a
  **mutable state machine** (`open → under_review → needs_info → under_review → resolved → closed`) with a
  validate trigger (allowed/forbidden transitions + post-open identity immutability); `dispute_events` is
  **append-only** and **auto-written by a SECURITY DEFINER trigger** on every INSERT/status transition
  (`actor_id = auth.uid()`), with no authenticated write path. **D9** is enforced against a stored
  `decision_owner_id`: `owns_review_decision()` + CHECKs (`assigned_reviewer_id <> decision_owner_id`,
  `<> complainant_id`) + resolve RLS `NOT owns_review_decision`. Assign is **HR-only via `has_role('hr')`** (no
  `dispute.assign` permission added — that would change the seeded catalog count asserted by test 0001);
  `due_at` is stored + a sanity CHECK (business-day calc deferred); RLS read = complainant, assigned reviewer,
  HR and Auditor (Finance/Support excluded); `target_id` is polymorphic (no FK) — RLS + pgTAP.
- **Phase 3 — anti_gaming_flags** (`08`, `14`/`15`/`16` §7, D5): the 5 deterministic anti-gaming flags. A
  **mutable review lifecycle** (`open → reviewing → confirmed | dismissed`) with a validate trigger
  (forbidden skip / `reviewing→open` / terminal transitions + post-insert identity immutability), review
  consistency (`confirmed|dismissed ⇒ reviewed_by + review_note`) and `reviewed_by <> subject_employee_id`.
  **D5 (no automatic punishment) is guaranteed by construction**: the table is **isolated** — it has NO FK,
  trigger or write path to `point_ledger` / `bonus_ledger` / any `bonus_*` table / `compensation_records`;
  confirming a flag is inert (a test asserts `point_ledger` / `bonus_ledger` row counts do not change).
  INSERT is **server-only** (the rule engine); review (confirm/dismiss) is `has_role('hr') OR
  manages_team(team_of(subject_employee_id))` (**no `flag.review` permission added** — it would change the
  seeded catalog count asserted by test 0001); read = subject-own + own-team manager + HR + Auditor
  (Finance/Support excluded); `related_task_id` is FK-less (tasks gated); **`bonus_period_id` (FK-less) is added by
  Phase 7-A (`0023`)** for period-scoped flag idempotency; DELETE forbidden — RLS + pgTAP.
- **Phase 3 — notifications** (`14` §424-429, `15` §139-142): a **recipient-only** notification delivery sink.
  One-way `unread → read` lifecycle (a validate trigger keeps `read` terminal — `read → unread` rejected — and
  makes the identity fields org/recipient/type/payload/link/created_at immutable after insert); the recipient
  marks **their own** notification read and `read_at` is **server-stamped** on the transition. INSERT is
  **server-only** (service_role — emission is future engine/app work); there is **no client DELETE and no
  `prevent_delete`** — notifications are personal data with a planned **V1 TTL** (OQ-DD-3), not a legal-retention
  surface, so a future service-role retention job stays possible. **No audit trigger** (data dict §429). **No
  new permission or role** — RLS keys off `current_org()` + `auth.uid()` only, so the seeded permission catalog
  (20) is unchanged. **No `type` enum** (non-empty CHECK only); `payload` must be a JSON object; a read-
  consistency CHECK ties `read_at` to `status`. Recipient is a **same-org composite FK**
  `(organization_id, recipient_id) → memberships`. RLS is **recipient-only SELECT/UPDATE** — HR / Auditor /
  Manager / Finance / Support cannot read another user's notifications (the audit trail lives in `audit_logs`,
  not here) — RLS + pgTAP.
- **Phase 3 — exports** (`14` §444-451, `15` §149-152, `16` §8; SI-3/AD6/SI-15): the payout-export
  **record/container** — the export **generation engine is NOT built** here. **Finance INSERT** via the existing
  `payout.export` permission (no new permission — catalog stays 20), with **actor integrity**: the INSERT WITH
  CHECK pins `exported_by = auth.uid()` (Finance cannot record another user as the exporter). **`snapshot_id` is
  NOT NULL** (SI-3/INV-7 — no export without a snapshot). The **AD6/SI-15 gate** is a SECURITY DEFINER trigger
  that blocks the export when the snapshot's `calculation_run_id` has any `bonus_allocations` row with
  `pending_missing_cap_basis` (by `status` **or** `cap_applied`) — checked against the run, not just the snapshot
  row; it also enforces `exports.bonus_period_id = snapshot.bonus_period_id`. **Append-only client posture**: no
  authenticated UPDATE/DELETE; a **`prevent_delete`** trigger enforces retention (financial record). **Audit on
  INSERT** (`exports.insert`). RLS is **Finance + Auditor SELECT** — HR / Manager / Employee / Support excluded —
  RLS + pgTAP.
- **Phase 4 — tasks + task_events + task_reviews** (`04`, `14`/`15`/`16` §1-2; D3/AD4/AD5): the submit→review
  **lifecycle container** — NOT the scoring engine. `tasks` is a **status machine**
  (`draft→assigned→in_progress→submitted→needs_revision↺→approved|rejected`; cancelled/archived) with a validate
  trigger (forbidden skip-state / `approved→in_progress` / mid-state insert) and **DELETE forbidden** (cancel/
  archive = status). `task_events` is **auto-written append-only** history (AD4 source; UPDATE/DELETE blocked).
  `task_reviews` is **append-only**, and its INSERT is the authoritative review action: a **SECURITY DEFINER
  trigger applies the tasks status transition** (Decision A), so a **direct client approve/reject/needs_revision
  is rejected** — only a valid review (or trusted server) drives it. **Self-approval is hard-blocked** (AD4:
  `reviewer_id <> assignee` at review INSERT + a tasks CHECK + a transition belt); **D3** approve⇒`quality<>poor`;
  `complexity/impact/quality/timeliness` enums come from `04`. Same-org composite FKs throughout. RLS read =
  assignee / creator / reviewer / own-team manager / HR / Auditor + **support-grant (top-level OR)**;
  task_events/task_reviews inherit task visibility; **Finance has NO raw task/review/event SELECT** (SI-12). No
  new permission (catalog 20). This slice is the lifecycle container; **scoring/point_ledger is wired in `0020`
  (Phase 5)** — approving a task now writes exactly one `task_approved` point_ledger row (see the Phase 5 slice) —
  RLS + pgTAP.
- **Phase 6 — bonus engine (Safe Pro-Rata calculation)** (`05`, `09` §8; D1/D6/D10/AD6/AD7/AD8/AD9/AD10;
  SI-13): the **calculation engine** that populates the existing `0013` containers. `run_bonus_calculation()`
  (SECURITY DEFINER, server-only) validates a **locked period + locked pool** (AD10), sums approved points from
  `point_ledger task_approved` joined to `tasks.approved_at` in the period, computes Safe Pro-Rata
  (`W_individual=1.0`, no malus), caps from `compensation_records.cap_basis` × `cap_rate` (missing →
  `pending_missing_cap_basis`, **no unlimited cap** — AD6), applies T_org + AD8 top-up, allocates integer
  **kuruş via largest-remainder** (tie-break `employee_id` asc), writes `bonus_allocations` + one **immutable**
  `bonus_allocation_snapshot`, completes the run (freeze) and transitions the period `locked→calculated`.
  **Idempotent** per `(org, idempotency_key)`; `Σfinal + undistributed = pool_ref` (SI-13); accrual → **Phase 6-b**
  (`a65013d`); no new permission (catalog 20); Finance raw-excluded — pgTAP (`0015`).
- **Phase 6-b — bonus_ledger accrual** (`06 §2`, ADR-006/ADR-017; D2/AD6/AD8; BL-1/BL-2; SI-3/SI-7/SI-12/SI-13):
  the **approve→accrual posting engine** over the existing `bonus_ledger` (0014). `post_bonus_accrual()`
  (SECURITY DEFINER, server-only) requires an **APPROVED period** (the snapshot-approval boundary — HR moves the
  `bonus_period` `calculated→approved` via `period.manage`; the immutable snapshot is **not** mutated and no new
  permission is added — catalog 20), takes the single completed run's snapshot + allocations, blocks on any
  `pending_missing_cap_basis` allocation (**AD6 gate**), and posts **one balanced transaction**: `debit pool =
  Σfinal`, `credit accrual` per employee (`bonus_accrual`). **Idempotent** per snapshot; append-only (**BL-1**);
  `Σdebit = Σcredit` (0014); a new **`DEFERRABLE INITIALLY DEFERRED` trigger** enforces **BL-2** `Σaccrual ≤
  pool_ref` (AD8-aware); **BL-3** (payout ≤ accrual) is added in **Phase 6-c (`0027`)** — no payout producer in this slice. Finance +
  Auditor raw read; server-only — pgTAP (`0016`).
- **Phase 6-d — bonus engine authz hardening** (`0021`/`0022`, AD1): both engines gated their entry on
  `has_permission('period.manage') OR current_user not in ('authenticated','anon')`, but inside a SECURITY DEFINER
  function `current_user` is the function OWNER (not the caller), so that clause was **always true** and
  `period.manage` was never actually enforced. `0024_authz_hardening.sql` **CREATE OR REPLACEs** both functions with
  **byte-identical bodies except the single authz clause each** — `current_user not in (...)` → **`auth.uid() IS
  NULL`** (the trusted server/job signal used by 0023; an authenticated user always carries a JWT `sub`). Same
  signatures → existing GRANTs and COMMENTs are preserved (same OID); **no logic/formula/ledger change, no new
  table/permission (catalog stays 20), no seed change, 0023 untouched**; idempotent (re-runs cleanly on `db reset`).
  Behaviour is a **one-way tightening**: an authenticated caller lacking `period.manage` now gets `42501` (no
  app/client calls these server-only functions, so nothing breaks) — pgTAP (`0018`).
- **Phase 7-A — anti-gaming detection engine** (`08`, plan `19`; D5/OQ-1..OQ-3): the **deterministic detection
  engine** that produces flags into the existing `anti_gaming_flags` (0016) container (no new table/permission —
  catalog 20). `run_anti_gaming_scan(organization_id, bonus_period_id?)` (SECURITY DEFINER, server-only)
  orchestrates four `detect_*` rules: **duplicate_task** (same assignee + normalized `lower(btrim(title))` within
  24h → flag the later task), **tiny_task_splitting** (same assignee with ≥3 tasks `base_points<5` within 1h),
  **same_reviewer_concentration** (one reviewer's share >0.80 with ≥3 approvals in the period), **period_end_spike**
  (last-3-days `task_approved` point gain > 3× the period daily average). Thresholds are **hardcoded** (OQ-1;
  `organization_settings` columns deferred to V1). **OQ-2 dual idempotency:** `anti_gaming_flags` gains an
  **FK-less `bonus_period_id`** column (mirrors the FK-less `related_task_id`, so D5's "no FK to bonus_* tables"
  holds) + **two partial unique indexes** (task-scoped `(org, rule, subject, related_task_id)` / period-scoped
  `(org, rule, subject, bonus_period_id)`) — a re-scan adds no flags. **OQ-3:** detection runs only via an explicit
  `run_anti_gaming_scan()` call (HR/job), never automatic at approve-time. **D5 by construction:** the detect
  functions **read** `tasks`/`task_reviews`/`point_ledger`/`bonus_periods` and **write only `anti_gaming_flags`** —
  no write/FK/trigger to `point_ledger`/`bonus_ledger`/any `bonus_*`/`compensation_records`, so a scan produces **no
  financial side effect** (asserted: ledger row counts are unchanged), and a flag is **not** an auto-punishment nor
  an auto-dispute (human-in-loop). **Authz:** `has_role('hr') OR auth.uid() IS NULL` (a trusted server/job context —
  `current_user` is unreliable inside SECURITY DEFINER, it is the owner); non-HR authenticated gets `42501`;
  `detect_*` are granted to `service_role` only — pgTAP (`0017`).
- **Phase 7-B — dispute point adjustment** (`07 §62`, plan `19 §5.2`; D9/D2/ADR-005): the resolved+accepted dispute
  → `point_ledger` **`dispute_adjustment`** effect over the existing `point_ledger` (0009) container (no new table/
  permission — catalog 20). `apply_dispute_point_adjustment(p_dispute_id, p_points_delta, p_reason, p_actor)`
  (SECURITY DEFINER, server-only) checks, in order: **authz** (`has_permission('dispute.resolve') OR auth.uid() IS
  NULL` — the resolving reviewer or a trusted server/job; else `42501`), **non-zero delta** (OQ-7B-5; `0` → `23514`),
  loads the dispute (org + employee **derived** from the row — no cross-org param, SI-7), **fail-closed precondition**
  (OQ-7B-3: unless `status in ('resolved','closed') AND resolution='accepted'` → `23514`, no row), **idempotency** (a
  prior `dispute_adjustment` for the dispute → no-op, returns it), then appends **one delta** for the complainant
  (`employee_id = disputes.complainant_id` — OQ-7B-2). **Schema (additive, 0020 precedent):** `point_ledger` gains a
  `dispute_id` + a **same-org composite FK `(dispute_id, organization_id) → disputes`** (SI-7); the event_type CHECK
  is widened via **DROP+ADD under the same name** to add `dispute_adjustment` (0003 regression holds); a
  `point_ledger_dispute_adjustment_chk` (dispute_id NOT NULL + reverses_entry_id NULL); a **partial unique index**
  `(dispute_id) where event_type='dispute_adjustment'` (one adjustment per dispute — 23505 backstop). **Audit:** the
  INSERT audit WHEN clause is widened (DROP+CREATE) to audit `dispute_adjustment`; **`task_approved` stays un-audited**
  (0020 behaviour). Append-only is preserved (UPDATE/DELETE → `23001`); **D2** is not violated (a point correction is
  not a paid-money clawback — the money side is 7-C), **D9** is enforced at the resolve step (0015) — pgTAP (`0019`).
- **Phase 6-c — payout/export engine** (`06 §2`, ADR-017; D2/AD6; BL-3; SI-12): the **payout producer** over the existing `exports` (0018) and `bonus_ledger` (0014) containers (no new table/permission — catalog 20). `produce_payout_export(org, period, snapshot, format, actor)` (SECURITY DEFINER, server-only) requires `period.export OR auth.uid() IS NULL`, gates on `period='approved'`, re-uses the 0018 AD6/SI-15 trigger (pending_missing_cap_basis → `23514`), inserts the `exports` record (SECURITY DEFINER — Finance lacks `period.manage`), and transitions the period `approved→exported`. `mark_payout_paid(org, period, export_id, actor)` (SECURITY DEFINER, server-only) checks **idempotency BEFORE the period gate** (if the export is already paid, returns the existing `transaction_id` — safe re-call), requires `period='exported'`, posts per-employee balanced `payout_marked_paid` rows (one `debit accrual` + one `credit payout` per employee, same `transaction_id`; doc-06 §2 double-entry), and closes the period `exported→closed`. **BL-3** is added as a new `DEFERRABLE INITIALLY DEFERRED` trigger `enforce_bonus_ledger_payout_cap()`: it computes net accrual per employee (Σ credit accrual − Σ debit reversal) and rejects any payout that exceeds it (`23514`). `bonus_ledger`: `payout_marked_paid` is unlocked in `validate_bonus_ledger_event()` (now requires `export_id NOT NULL`); `payout_exported` and `clawback_*` remain blocked. `exports` gains `UNIQUE(id, organization_id)` for the `bonus_ledger export_id` same-org composite FK (mirrors the `(dispute_id, organization_id) → disputes` pattern from 7-B). Finance views: `v_finance_payout` (employee_id, display_name, bonus_period_id, final_amount_minor, paid_amount_minor, status, paid_at — ledger-sourced) and `v_finance_period_totals` (bonus_period_id, period_status, pool_amount, distributable, undistributed_remainder, total_accrued, total_paid) — both `security_invoker`, **NO raw points/quality/cap_basis/comp** (SI-12). 0020 test-only amendment: paid-guard fixture now injects `payout_exported` (not `payout_marked_paid`) because the new `bonus_ledger_payout_export_chk` CHECK requires `export_id IS NOT NULL` for `payout_marked_paid` rows — `payout_exported` is still rejected by `validate_bonus_ledger_event()` (`23514`), so the paid-guard fires correctly — pgTAP (`0021`; + `0020` amended).

Migrations `0001..0028` + seed apply cleanly; blocking pgTAP suites (`0001`..`0022`) are green (see
"Verification"). **Phase 3 DB foundation, Phase 4/5, the Phase 6 bonus calculation engine, the Phase 6-b
`bonus_ledger` accrual, the Phase 6-c payout/export engine, the Phase 6-d authz hardening, the Phase 7-A
anti-gaming detection engine, the Phase 7-B dispute point adjustment, the Phase 7-C dispute bonus recalculation,
the Phase 7-D dispute_adjustment → bonus basis and the Phase 7-E dispute bonus re-run orchestration
are all done; Phase 5-b, Phase 8 and everything downstream (app UI/API) remain gated** (see "Out of scope").

## ⚠️ Environment rule (non-negotiable — ADR-014 / CLAUDE.md)

- These migrations/seed run on **local dev / staging only**. **Never production.**
- Do **not** point the Supabase CLI/MCP at a production project.
- The `service_role` key is **env-only**: never committed, never shipped to the client.
  (Local `supabase start` prints the well-known **local dev default** keys — those are not secrets.)
- The seed (`seed/seed_test_tenants.sql`) creates **test** users/tenants only.

## Layout

```text
supabase/
  config.toml                             local dev/staging config
  migrations/
    0001_extensions_and_helpers.sql       pgcrypto, set_updated_at, prevent_mutation
    0002_core_tenant_identity.sql         organizations, organization_settings, profiles
    0003_rbac.sql                         roles, permissions, role_permissions, memberships
    0004_teams.sql                        teams, team_memberships
    0005_support_and_audit.sql            support_access_grants, audit_logs + audit triggers
    0006_rls_helpers.sql                  current_org/has_role/has_permission/manages_team/
                                          has_support_grant/shares_org (recursive-RLS safe, §7A)
    0007_rls_enable_and_policies.sql      RLS ENABLE+FORCE + policies (11 foundation tables)
    0008_scoring_policies.sql             scoring_policies + scoring_policy_versions (AD7 immutable
                                          published) + policy.manage RLS + audit  (Phase 3B-A)
    0009_point_ledger.sql                 point_ledger (append-only) + team_of() + server-only RLS +
                                          conditional audit  (Phase 3B-B)
    0010_compensation_records.sql         compensation_records (comp-sensitive) — raw SELECT closed;
                                          comp.read INSERT/UPDATE; DELETE blocked; mask_compensation +
                                          log_comp_audit (masked) + read_compensation_record (justified)
    0011_bonus_periods_pools.sql          bonus_periods + bonus_pools — state machine + AD10 pool-lock
                                          guard; locked pool needs t_org+locked_at+locked_by (immutable);
                                          period identity immutable (SI-4); period.manage/pool.create RLS
    0012_bonus_components_eligibility.sql bonus_pool_components (MVP individual=1.0 — D1) + bonus_pool_eligibility
                                          (same-org employee via memberships composite FK; AD9 is_primary; 15-day
                                          + proration — D10); server-only eligibility writes; inputs immutable
                                          once parent pool leaves draft (SI-4); pool.create component RLS
    0013_bonus_calc_runs_allocations_snapshots.sql bonus_calculation_runs + bonus_allocations +
                                          bonus_allocation_snapshots — run machine (running/completed/superseded)
                                          + AD10 locked-period+locked-pool guard; idempotency unique(org,key);
                                          completed-run allocation freeze (SI-4/SI-14); thin snapshot append-only;
                                          cap-not-exceeded + pending_missing_cap_basis; approved/exported/paid
                                          blocked; server-only writes (Finance raw excluded — SI-12)
    0014_bonus_ledger.sql                 bonus_ledger (append-only double-entry) — deferred Σdebit=Σcredit
                                          per (org, transaction_id) balance trigger; accrual⇒snapshot_id;
                                          idempotent accrual; only bonus_accrual+reversal writable; Finance/
                                          Auditor raw read only; server-only writes; INSERT audit (BL-4)
    0015_disputes.sql                     disputes (mutable state machine) + dispute_events (append-only,
                                          auto-written by trigger) — D9 stored decision_owner_id +
                                          owns_review_decision; HR-only assign via has_role('hr'); due_at stored
                                          + sanity; Finance/Support excluded; target_id polymorphic (no FK)
    0016_anti_gaming_flags.sql            anti_gaming_flags (mutable review lifecycle open/reviewing/confirmed/
                                          dismissed) — D5 no-auto-punish (isolated; no FK/write to point_ledger/
                                          bonus_ledger/bonus_*/compensation); review consistency + reviewer≠subject;
                                          server-only INSERT; review has_role('hr') OR manages_team(team_of(subject));
                                          Finance/Support excluded; related_task_id FK-less; DELETE forbidden
    0017_notifications.sql                notifications (recipient-only delivery sink) — one-way unread→read
                                          lifecycle (read terminal; identity immutable; read_at server-stamped);
                                          server-only INSERT; no client DELETE & no prevent_delete (retention/TTL
                                          V1); no audit trigger; no new permission; no type enum (non-empty) +
                                          payload JSON object; same-org FK (org,recipient)→memberships; RLS
                                          recipient-only SELECT/UPDATE (HR/Auditor/Manager/Finance/Support excluded)
    0018_exports.sql                      exports (payout export record/container; generation engine NONE) —
                                          Finance INSERT via existing payout.export + actor integrity
                                          exported_by=auth.uid(); snapshot_id NOT NULL (SI-3); AD6/SI-15 gate
                                          (SECURITY DEFINER trigger: snapshot.calculation_run_id→bonus_allocations
                                          pending_missing_cap_basis by status/cap_applied); bonus_period_id=snapshot
                                          period; append-only client (no UPDATE/DELETE) + prevent_delete; audit on
                                          INSERT; RLS Finance+Auditor SELECT; no new permission (catalog 20)
    0019_tasks_events_reviews.sql         tasks + task_events + task_reviews (Phase 4; submit->review lifecycle) —
                                          status machine + DELETE forbidden; task_events auto-written append-only
                                          history (AD4); task_reviews append-only, INSERT drives task transition
                                          (SECURITY DEFINER apply_review_to_task); direct client approve/reject/
                                          needs_revision blocked; self-approval hard block (AD4); D3 approve⇒
                                          quality≠poor; doc-04 enums; same-org FKs; RLS assignee/creator/reviewer/
                                          team-manager/HR/Auditor + support-grant, Finance excluded; no new
                                          permission (catalog 20); scoring/point_ledger wired in 0020 (Phase 5)
    0020_scoring_engine.sql               scoring engine (Phase 5; approve -> point_ledger task_approved) —
                                          ALTER point_ledger +task_id/task_approved + task_approved CHECKs +
                                          same-org FK to tasks + SI-1 partial unique idempotency; tasks.final_points
                                          integer->numeric; SECURITY DEFINER BEFORE UPDATE trigger on approved
                                          transition computes doc-04 formula from published policy multipliers/
                                          revision_penalty_rule, sets final_points, writes one task_approved earning
                                          row (breakdown metadata); raw numeric no rounding; AD4 review timeliness;
                                          AD5 collaboration non-scoring; D3/AD7 guards; direct-approve w/o review
                                          skips; Finance excluded; no new permission (catalog 20); no bonus changes
    0021_bonus_engine.sql                 bonus engine (Phase 6; Safe Pro-Rata calculation) —
                                          run_bonus_calculation() SECURITY DEFINER server-only: locked
                                          period+pool (AD10), approved points from point_ledger task_approved
                                          × tasks.approved_at in period, Safe Pro-Rata (W_individual=1.0), cap
                                          from compensation_records×cap_rate (AD6 pending_missing_cap_basis),
                                          T_org+AD8 top-up, largest-remainder kuruş (tie-break employee_id),
                                          writes bonus_allocations + immutable snapshot, run completed +
                                          period locked→calculated; idempotent; SI-13 Σ invariant; NO
                                          bonus_ledger accrual (posted in 0022, 6-b); no new permission (catalog 20)
    0022_bonus_ledger_accrual.sql         bonus_ledger accrual (Phase 6-b; approve->accrual posting) —
                                          post_bonus_accrual() SECURITY DEFINER server-only: APPROVED period
                                          (period.manage calculated->approved; immutable snapshot untouched) +
                                          single completed run -> AD6 gate (pending_missing_cap_basis blocks) ->
                                          one balanced accrual (debit pool=Σfinal / credit accrual per employee);
                                          idempotent per snapshot; append-only (BL-1); Σdebit=Σcredit (0014);
                                          new DEFERRABLE trigger BL-2 Σaccrual≤pool_ref (AD8-aware); BL-3 deferred
                                          to payout phase; no new permission (catalog 20)
    0023_anti_gaming_detection.sql        anti-gaming detection engine (Phase 7-A; plan doc 19) —
                                          run_anti_gaming_scan(org, bonus_period_id?) SECURITY DEFINER server-only
                                          orchestrator + 4 detect_* (duplicate_task/tiny_task_splitting/
                                          same_reviewer_concentration/period_end_spike) producing anti_gaming_flags;
                                          adds FK-less bonus_period_id col + dual partial unique idempotency index
                                          (OQ-2 task-scoped related_task_id / period-scoped bonus_period_id);
                                          hardcoded thresholds (OQ-1); explicit-call only (OQ-3, no approve-time
                                          trigger); D5 isolation — reads tasks/reviews/point_ledger/periods, writes
                                          ONLY flags (no ledger/bonus/comp write/FK), scan has no financial side
                                          effect; authz has_role('hr') OR auth.uid() IS NULL; detect_* service_role
                                          only; no new permission (catalog 20)
    0024_authz_hardening.sql              bonus engine authz hardening (Phase 6-d) — CREATE OR REPLACE
                                          run_bonus_calculation (0021) + post_bonus_accrual (0022) with byte-
                                          identical bodies except the authz clause: current_user not in
                                          ('authenticated','anon') -> auth.uid() is null (current_user is the
                                          owner inside SECURITY DEFINER, so the old check never enforced
                                          period.manage). Same signatures -> GRANTs/COMMENTs preserved; no logic/
                                          formula/ledger change; no new permission (catalog 20); 0023 untouched;
                                          idempotent
    0025_dispute_point_adjustment.sql     dispute point adjustment (Phase 7-B) — point_ledger gains dispute_id +
                                          same-org composite FK (dispute_id, organization_id) -> disputes; event_type
                                          CHECK DROP+ADD (same name) adds 'dispute_adjustment' (0020 precedent);
                                          dispute_adjustment_chk (dispute_id NOT NULL, no reverses_entry_id); partial
                                          unique index (dispute_id) where event_type='dispute_adjustment' (idempotency);
                                          audit WHEN clause DROP+CREATE adds dispute_adjustment (task_approved still
                                          un-audited); apply_dispute_point_adjustment(dispute, delta, reason, actor)
                                          SECURITY DEFINER server-only: authz dispute.resolve OR auth.uid() IS NULL ->
                                          non-zero delta -> resolved+accepted (fail-closed 23514) -> idempotent ->
                                          one delta for the complainant; no new permission (catalog 20)
    0026_dispute_bonus_recalculation.sql  dispute bonus recalculation (Phase 7-C; plan doc 19 §5.3) —
                                          recalculate_bonus_after_dispute() SECURITY DEFINER server-only:
                                          run superseded (0013 machine) + period approved->calculated
                                          (CREATE OR REPLACE validate_bonus_period_transition adds this
                                          transition) + balanced bonus_ledger reversal (debit<->credit swap,
                                          new transaction_id; append-only BL-1); paid-guard (23514 if any
                                          accrual row paid — D2 clawback-gated); idempotent (reversal exists
                                          -> no-op); authz has_permission('period.manage') OR
                                          auth.uid() IS NULL; C-c1 reduced scope (no new run/snapshot;
                                          dispute_adjustment->bonus basis deferred to Phase 7-D); no new
                                          permission (catalog 20)
    0027_payout_export_engine.sql         payout/export engine (Phase 6-c) —
    0028_dispute_bonus_basis.sql          dispute_adjustment → bonus basis (Phase 7-D) —
                                          point_ledger gains nullable bonus_period_id + same-org composite FK
                                          to bonus_periods (SI-7) + point_ledger_bonus_period_event_chk (dispute_
                                          adjustment => bonus_period_id NOT NULL; all other events => NULL);
                                          apply_dispute_point_adjustment DROP+CREATE (adds p_bonus_period_id,
                                          grant re-issued); run_bonus_calculation() CREATE OR REPLACE: gate
                                          IN('locked','calculated') (OQ-7D-3); NET approved_points = task_approved
                                          (tasks.approved_at in period) + dispute_adjustment (bonus_period_id =
                                          p_bonus_period_id — NULL task_id no longer dropped by JOIN); net<=0 ->
                                          excluded (0 bonus, OQ-7D-4); factors gains dispute_adjustment_points
                                          breakdown (OQ-7D-5); 0019 test-only fix (3 lines); no new permission
                                          (catalog 20)
                                          exports unique(id,org) composite constraint for bonus_ledger export_id FK;
                                          bonus_ledger: export_id FK col + payout_export_chk (payout_marked_paid
                                          requires export_id NOT NULL); validate_bonus_ledger_event() CREATE OR
                                          REPLACE: unlocks payout_marked_paid (payout_exported+clawback_* stay
                                          blocked); BL-3 DEFERRABLE INITIALLY DEFERRED trigger
                                          enforce_bonus_ledger_payout_cap() (payout ≤ net accrual, reversal-aware);
                                          produce_payout_export(org,period,snapshot,format,actor) SECURITY DEFINER
                                          server-only: payout.export OR auth.uid() IS NULL; approved period gate;
                                          exports record + period approved->exported; mark_payout_paid(org,period,
                                          export_id,actor) SECURITY DEFINER server-only: payout.mark_paid OR
                                          auth.uid() IS NULL; idempotency BEFORE period gate; exported period ->
                                          per-employee payout_marked_paid (debit accrual/credit payout, same txn);
                                          period exported->closed; v_finance_payout + v_finance_period_totals
                                          (security_invoker, NO raw points/quality/cap_basis/comp — SI-12);
                                          no new permission (catalog 20)
    0029_dispute_bonus_rerun.sql          dispute bonus re-run orchestration (Phase 7-E) —
                                          recalculate_bonus_after_dispute() CREATE OR REPLACE (same 3-arg
                                          signature → grant/OID kept): upgrades 7-C C-c1 to full
                                          orchestration; mechanical steps (reversal + supersede +
                                          approved->calculated) unchanged; NEW: locked pool fetch from DB
                                          (0 rows -> 23514) + run_bonus_calculation() call with
                                          idempotency key = 'disp-recalc-snap-'||reversed_snapshot_id
                                          (deterministic; safe for multiple dispute cycles); returns NEW
                                          snapshot id (reflects dispute_adjustment via 7-D engine); period
                                          stays 'calculated' (HR re-approves -> post_bonus_accrual
                                          separately — ADR-006 human re-approval preserved); idempotent
                                          (reversal+run exist -> return new snap; reversal only -> pool+run;
                                          0020 test-only fix: _b7c_snap helper accrual-filtered + #6 scope
                                          + #10 expects new re-run snap); no new permission (catalog 20)
  seed/seed_test_tenants.sql              2 tenants, RBAC catalog, teams, support grants,
                                          + Phase 3B (scoring/versions, point_ledger) + comp + bonus fixtures
                                          (periods/pools + components/eligibility + calc run/allocations/snapshot
                                          + balanced accrual ledger) + dispute fixtures (auto-events)
                                          + anti-gaming flag fixtures + notification fixtures
                                          + export fixtures + AD6-gate pending-cap fixtures
                                          + Phase 4 task fixtures (walked to submitted/in_progress)
                                          + Phase 5 policy multipliers/penalty rule (doc-04 values on d2/b-d2)
                                          + Phase 6 dedicated Org C (ceres) worked-example fixtures (05 §8)
                                          + Phase 6-b Org C auditor (for the 0016 accrual RLS assertion)
                                          (Phase 7-A anti-gaming detection uses inline test fixtures — no seed change)
  tests/
    0001_phase3a_rls.test.sql             blocking pgTAP — RLS/RBAC (Phase 3A)
    0002_phase3b_scoring_policies.test.sql blocking pgTAP — scoring policy/version (Phase 3B-A)
    0003_phase3b_point_ledger.test.sql    blocking pgTAP — point_ledger/append-only (Phase 3B-B)
    0004_phase3_compensation.test.sql     blocking pgTAP — compensation_records/masked audit (Phase 3)
    0005_phase3_bonus_periods_pools.test.sql blocking pgTAP — bonus periods/pools + AD10/SI-4 (Phase 3)
    0006_phase3_bonus_components_eligibility.test.sql blocking pgTAP — components/eligibility + D1/D10/AD9/SI-4 (Phase 3)
    0007_phase3_bonus_calc_runs_allocations_snapshots.test.sql blocking pgTAP — runs/allocations/snapshots + AD10/SI-4/SI-14 (Phase 3)
    0008_phase3_bonus_ledger.test.sql     blocking pgTAP — bonus_ledger double-entry/balance/append-only (Phase 3)
    0009_phase3_disputes.test.sql         blocking pgTAP — disputes state machine/D9/auto-events/append-only (Phase 3)
    0010_phase3_anti_gaming_flags.test.sql blocking pgTAP — anti_gaming_flags state machine/D5-no-side-effect (Phase 3)
    0011_phase3_notifications.test.sql    blocking pgTAP — notifications recipient-only RLS/mark-read/one-way lifecycle (Phase 3)
    0012_phase3_exports.test.sql          blocking pgTAP — exports snapshot/AD6-gate/actor-integrity/append-only/Finance+Auditor RLS (Phase 3)
    0013_phase4_tasks_reviews.test.sql    blocking pgTAP — tasks state machine/review-driven transition/self-approval/D3/AD4 timing/append-only/RLS (Phase 4)
    0014_phase5_scoring.test.sql          blocking pgTAP — scoring determinism (187.5)/SI-1 idempotency/AD4/AD5/D3/AD7/Finance-excluded/no-bonus (Phase 5)
    0015_phase6_bonus_engine.test.sql     blocking pgTAP — bonus engine worked example (05 §8)/idempotency/cap+D6 residual/AD8 top-up/T_org=0/Σadj=0/single-eligible/AD6 pending/SI-13/no-bonus_ledger/Finance-excluded (Phase 6)
    0016_phase6b_bonus_ledger_accrual.test.sql blocking pgTAP — accrual worked example (05 §8)/approval boundary/idempotency/BL-2 Σaccrual≤pool_ref/AD6 gate/append-only/Finance+Auditor RLS (Phase 6-b)
    0017_phase7a_anti_gaming_detection.test.sql blocking pgTAP — 4 detect_* rules pos/neg + dual idempotency (re-scan adds no flag)/D5 no-side-effect (scan leaves point_ledger+bonus_ledger counts unchanged)/server-only (non-HR 42501, detect_* not callable, direct flag INSERT rejected) (Phase 7-A)
    0018_phase6d_authz_hardening.test.sql blocking pgTAP — run_bonus_calculation + post_bonus_accrual authz: authenticated w/o period.manage (Finance c4) -> 42501; authenticated w/ period.manage (HR c3) -> authz passes -> 23503; trusted context (auth.uid() null) -> authz passes -> 23503 (Phase 6-d)
    0019_phase7b_dispute_point_adjustment.test.sql blocking pgTAP — apply_dispute_point_adjustment: positive (one dispute_adjustment delta, employee=complainant)/negative rejected+under_review+zero-delta 23514/idempotency (no-op + 23505 backstop)/missing dispute_id 23514 + invalid event_type 23514 (0003 regression)/audit row/append-only 23001/cross-tenant FK 23503/employee-without-dispute.resolve 42501 (Phase 7-B)
    0020_phase7c_dispute_bonus_recalculation.test.sql blocking pgTAP — recalculate_bonus_after_dispute: worked example (approve+accrue period 230 then recalc: reversal balanced Σdebit=Σcredit, magnitude=accrual total, run superseded, period->calculated, snapshot immutable 23001, re-approval required post_bonus_accrual->23514); idempotency (no-op, no duplicate reversal); paid-guard (manual accrual fixture + disabled trigger for payout row injection -> 23514); authz (employee->42501); append-only (reversal UPDATE->23001); DB balance check (Phase 7-C)
    0021_phase6c_payout_export.test.sql  blocking pgTAP — payout/export engine:
    0023_phase7e_dispute_bonus_rerun.test.sql blocking pgTAP — dispute bonus re-run orchestration: full chain
                                          (approve+accrue period 230 + dispute +1M delta + recalculate: 5
                                          reversal rows, old run superseded, period calculated, NEW completed
                                          run exists, NEW snapshot distinct from reversed, Ali factors
                                          dispute_adjustment_points=1M, SI-13 Σfinal+undistributed=pool_ref,
                                          Ali final↑); idempotency (second call no-op, returns same new snap,
                                          no dup reversal or run); re-accrual still gated 23514 (ADR-006);
                                          pool guard (no locked pool -> 23514); precondition (locked period
                                          with no accrual -> 23514); authz (Finance without period.manage
                                          -> 42501); catalog stays 20 (Phase 7-E)
    0022_phase7d_dispute_bonus_basis.test.sql blocking pgTAP — dispute_adjustment → bonus basis: dispute enters
                                          net approved_points (Section A: baseline regression + positive dispute
                                          delta + factors.dispute_adjustment_points + SI-13 Σ invariant + net<=0
                                          excluded + idempotency); period attribution CHECK/FK (Section B:
                                          dispute_adjustment without bonus_period_id -> 23514; non-dispute with
                                          bonus_period_id -> 23514; cross-org bonus_period_id -> 23503); gate +
                                          catalog (Section C: approved-period gate 23514; catalog stays 20);
                                          authz (Section D: Finance without period.manage -> 42501) (Phase 7-D) Section A happy path (approve+accrue period 230 -> produce_payout_export -> mark_payout_paid: exports record created, period approved->exported->closed, payout Σdebit=Σcredit, idempotency no-op, append-only 23001); Section B AD6 gate (pending_missing_cap_basis -> produce_payout_export -> 23514); Section C ledger guards (payout_exported 23514; clawback_pending 23514; payout_marked_paid without export_id 23514; BL-3 payout>accrual 23514; BL-3 reversal-aware net=0->payout blocked; set constraints all immediate passes); Section D authz+view+cross-tenant (employee without payout.export 42501; employee without payout.mark_paid 42501; Finance reads v_finance_payout; v_finance_payout no adjusted_score/cap_basis_minor; cross-tenant Finance A reads 0 Org C rows) (Phase 6-c)
```

## Apply & test (local)

Requires Docker + the Supabase CLI. From the repo root:

```bash
supabase start            # boots local dev stack (Docker)
supabase db reset         # applies migrations 0001..0029 then seed
supabase test db          # runs the pgTAP suites in tests/ (0001..0023)
```

If the `supabase` binary is not on PATH (e.g. a fresh install not yet picked up), the project-local
CLI works too: `npx --no-install supabase <cmd>`.

`supabase db reset` is the canonical way to rebuild from scratch; the seed is written to be
re-runnable (on-conflict guards).

## Verification (local dev/staging only)

> **Phase 3A: VERIFIED / DONE** (2026-06-24). `db reset` (`0001..0007`) + `test db` → **38/38 passed**.
> Only change during verification: `throws_ok` 3-arg → strict 4-arg in `tests/0001`. No schema bug.
>
> **Phase 3B-A + 3B-B: VERIFIED / DONE** (2026-07-24, npx Supabase CLI **2.109.1**). `db reset`
> (`0001..0009`) + seed; `test db` → **Files=3, Tests=97, PASS, Failed=0**. Reproduced across two clean runs.
>
> **Phase 3 compensation_records: VERIFIED / DONE** (2026-07-24, npx Supabase CLI **2.109.1**;
> commit `c9cd0f2`). `db reset` (`0001..0010`) + seed; `test db` → **Files=4, Tests=139, PASS, Failed=0**.
> Security (AD3/D7/SI-5): **direct raw SELECT closed**, **raw reads require
> `read_compensation_record(employee, reason)`**, **write + access audits masked** (raw salary/cap never
> in `audit_logs`).
>
> **Phase 3 bonus_periods + bonus_pools: VERIFIED / DONE** (2026-07-24, npx Supabase CLI **2.109.1**;
> commit `d04b954`). `db reset` applied migrations **0001..0011** + seed cleanly; `test db` →
> **Files=5, Tests=194, Result=PASS, Failed=0** (`0001`..`0005` ok), reproduced across two clean runs.
> Invariants proven (AD10/SI-4): **a period cannot lock before its pool is locked**; a **locked pool
> requires `t_org` + `locked_at` + `locked_by`** and its amount/`t_org` are immutable (new version); a
> **locked/non-open period's identity (dates/type/org) is immutable**; `period.manage` (owner/hr) vs
> `pool.create` (finance) separation of duties; DELETE blocked. A non-fatal storage-container readiness
> warning during `db reset` is non-blocking (the green suite confirms schema + seed).
>
> **Phase 3 bonus_pool_components + bonus_pool_eligibility: VERIFIED / DONE** (2026-07-24, npx Supabase CLI
> **2.109.1**; commit `8f74e8d`). `db reset` applied migrations **0001..0012** + seed cleanly; `test db` →
> **Files=6, Tests=238, Result=PASS, Failed=0** (`0001`..`0006` ok), reproduced across two clean runs.
> Invariants proven (D1/D10/AD9/AD10/SI-4): MVP **Safe Pro-Rata** component (`individual` = 1.0 only);
> **cross-tenant employee eligibility is structurally impossible** (`(organization_id, employee_id)` composite
> FK to `memberships` → an out-of-org employee is rejected with `23503`); `primary_team_id` is same-org and
> must be the employee's `team_memberships.is_primary` (AD9); eligibility writes are **server-only**;
> **component and eligibility inputs cannot mutate once the parent pool leaves `draft`** (locked/superseded →
> `23001`); DELETE blocked. The storage-container readiness warning during `db reset` remains non-blocking.
>
> **Phase 3 bonus_calculation_runs + bonus_allocations + bonus_allocation_snapshots: VERIFIED / DONE**
> (2026-07-25, npx Supabase CLI **2.109.1**; commit `e3bd1a3`). `db reset` applied migrations **0001..0013** +
> seed cleanly; `test db` → **Files=7, Tests=299, Result=PASS, Failed=0** (`0001`..`0007` ok). Invariants proven
> (D1/D6/AD6/AD7/AD9/AD10/SI-4/SI-12/SI-13/SI-14): a run starts **only on a locked period AND a locked pool**
> (draft/superseded pool rejected with `23514`); state machine `running→completed→superseded`; **idempotency**
> `unique(organization_id, idempotency_key)` (`23505` on duplicate); once a run is `completed` its allocations
> are **frozen** (`23001` on any INSERT/UPDATE); the **thin snapshot is append-only** (UPDATE/DELETE → `23001`,
> one per run); `cap_applied='yes'` enforces `final_amount ≤ cap`; `approved/exported/paid` writes rejected
> (`23514`); cross-tenant runs/allocations rejected by composite FK (`23503`); `Σfinal + undistributed_remainder
> = pool` is asserted on the seed fixture (no hard trigger). One transient `db reset` "container exit 1" flake
> (vector/analytics/pg_meta unhealthy) cleared on a `--debug` reset — not a code/schema defect.
>
> **Phase 3 bonus_ledger: VERIFIED / DONE** (2026-07-26, npx Supabase CLI **2.109.1**; commit `71e68f7`).
> `db reset` applied migrations **0001..0014** + seed cleanly; `test db` → **Files=8, Tests=328, Result=PASS,
> Failed=0** (`0001`..`0008` ok). Invariants proven (ADR-017/BL-1..4/SI-3/SI-12): **double-entry** — a
> **DEFERRABLE INITIALLY DEFERRED** balance trigger rejects any `(organization_id, transaction_id)` where
> `Σdebit ≠ Σcredit` (`23514`, forced in tests via `set constraints all immediate`); **append-only** (UPDATE/
> DELETE → `23001`, correction = reversal); accrual requires `snapshot_id` (`23514`) and is idempotent per
> `(snapshot, employee, account)` (`23505`); only `bonus_accrual` + `reversal` are writable — payout/clawback/
> approval events rejected (`23514`); raw SELECT is **Finance + Auditor only** (HR/Employee/Manager/Support all
> read 0 rows); cross-tenant ledger rows rejected by composite FK (`23503`). The deferred balance trigger fires
> at commit, so the balanced seed accrual (debit pool = Σ credit accruals) applies cleanly. A transient
> `db reset` container flake (`ENOTFOUND` / "exit 1") cleared on retry — not a code/schema defect.
>
> **Phase 3 disputes + dispute_events: VERIFIED / DONE** (2026-07-26, npx Supabase CLI **2.109.1**; commit
> `1bf63fe`). `db reset` applied migrations **0001..0015** + seed cleanly; `test db` → **Files=9, Tests=388,
> Result=PASS, Failed=0** (`0001`..`0009` ok). Invariants proven (D9/SI-6/SI-7 + ADR-006): the dispute **state
> machine** rejects skip/reopen/`closed→*` transitions (`23514`) and `open→under_review` without a reviewer;
> post-open identity is immutable (`23001`); `dispute_events` is **auto-written** by the trigger (2 rows for the
> seed dispute: `opened` by the complainant, `assigned` by HR) and is **append-only** (UPDATE/DELETE → `23001`);
> **D9** — `assigned_reviewer_id <> decision_owner_id` / `<> complainant_id` CHECKs (`23514`) and
> `owns_review_decision()` is TRUE for the decision owner / FALSE for the reviewer; HR-only assign via
> `has_role('hr')`; `due_at ≤ opened_at` rejected (`23514`); cross-tenant actors rejected by composite FK
> (`23503`); RLS read is complainant / assigned reviewer / HR / Auditor only (Finance, Support and unrelated
> employees read 0 rows). A few transient stack flakes (`ENOTFOUND`/timeout) were cleared with `supabase
> stop/start` + retry — not a code/schema defect. (One in-slice fix: `owns_review_decision` moved from
> `language sql` to `plpgsql` so its body's `disputes` reference resolves at call time, not at CREATE time.)
>
> **Phase 3 anti_gaming_flags: VERIFIED / DONE** (2026-07-31, npx Supabase CLI **2.109.1**; commit `0c813e9`).
> `db reset` applied migrations **0001..0016** + seed cleanly; `test db` → **Files=10, Tests=427, Result=PASS,
> Failed=0** (`0001`..`0010` ok). Invariants proven (D5/SI-6/SI-7 + ADR-006): the **review state machine**
> rejects skip / `reviewing→open` / terminal transitions (`23514`) and a terminal no-op is immutable (`23001`);
> post-insert identity is immutable (`23001`); review consistency (`23514`) and `reviewed_by <> subject`
> (`23514`); **D5 no-auto-punish** — after confirming a flag, `point_ledger` and `bonus_ledger` row counts are
> **unchanged** (the table is isolated: no FK/write to any financial table); INSERT is server-only (`42501` for
> authenticated); review is HR / own-team manager (`manages_team(team_of(subject))`), and the recorded
> `reviewed_by` must equal the actor (`42501` otherwise); cross-tenant subject/reviewer rejected by composite FK
> (`23503`); RLS read = subject-own + own-team manager + HR + Auditor (Finance, Support, other-team manager and
> unrelated employees read 0 rows). One in-slice test fix: `confirmed→dismissed` surfaces the transition error
> (`23514`), while a terminal no-op surfaces the immutability error (`23001`).
>
> **Phase 3 notifications: VERIFIED / DONE** (2026-07-31, npx Supabase CLI **2.109.1**; commit `fe1b81e`).
> `db reset` applied migrations **0001..0017** + seed cleanly; `test db` → **Files=11, Tests=475, Result=PASS,
> Failed=0** (`0001`..`0011` ok). Invariants proven (14 §424-429 / 15 §139-142): the **mark-read guard** stamps
> `read_at` on `unread→read` (recipient marks their own read) and rejects `read→unread` (`23514`, read is
> terminal); post-insert identity (org/recipient/type/payload/link/created_at) is immutable (`23001`); CHECKs
> reject an invalid `status`, an empty/whitespace `type`, a non-object `payload`, and read-consistency
> violations (`23514`); the same-org composite FK rejects a cross-org recipient (`23503`); INSERT and DELETE are
> **denied for authenticated** (`42501` — server-only, no client delete); RLS read is **recipient-only** — the
> recipient reads their own row while an unrelated employee, HR, Auditor, the own-team Manager, Finance and
> Support all read **0 rows**; cross-tenant recipients read 0; and the seeded **permission catalog is unchanged
> (20)** — no new permission was added.
>
> **Phase 3 exports: VERIFIED / DONE** (2026-07-31, npx Supabase CLI **2.109.1**; commit `b66350d`).
> `db reset` applied migrations **0001..0018** + seed cleanly; `test db` → **Files=12, Tests=523, Result=PASS,
> Failed=0** (`0001`..`0012` ok). Invariants proven (14 §444-451 / 15 §149-152 / 16 §8; SI-3/AD6/SI-15): a null
> `snapshot_id` is rejected (`23502`); `status`/`format`/`row_count`/`checksum`/`file_path` CHECKs (`23514`);
> same-org composite FKs reject a cross-org snapshot / exporter (`23503`); `exports.bonus_period_id` must equal
> the snapshot period (`23514`); the **AD6/SI-15 gate blocks export by allocation `status` and by `cap_applied`**
> (via `snapshot.calculation_run_id → bonus_allocations`, not just the snapshot row) while a clean-snapshot insert
> succeeds; `prevent_delete` blocks DELETE (`23001`, retention); INSERT audited (`exports.insert`); **Finance
> INSERT** via the existing `payout.export` permission, with **actor integrity** — Finance cannot record another
> user as `exported_by` (`42501`); Finance and Auditor SELECT while HR / Manager / Employee / Support read **0
> rows**; Finance cannot UPDATE or DELETE (`42501`, append-only); cross-tenant reads 0; and the **permission
> catalog is unchanged (20)** — no new permission was added. One in-slice review fix hardened the INSERT WITH
> CHECK to pin `exported_by = auth.uid()`.
>
> **Phase 4 task/review core: VERIFIED / DONE** (2026-08-01, npx Supabase CLI **2.109.1**; commit `148667e`).
> `db reset` applied migrations **0001..0019** + seed cleanly; `test db` → **Files=13, Tests=591, Result=PASS,
> Failed=0** (`0001`..`0013` ok). Invariants proven (04/14/15/16; D3/AD4/AD5): the **status machine** rejects
> mid-state creation, skip-state (`draft→approved`) and `approved→in_progress` (`23514`); **DELETE is forbidden**
> (`23001`); `task_events` is auto-written and **append-only** (UPDATE/DELETE → `23001`); a **review INSERT drives
> the task transition** (approve → task `approved`, needs_revision → `needs_revision` + `revision_count`++), while
> a **direct client approve/reject/needs_revision is blocked** (`23514`, review-driven) — including the assignee
> and the manager; **self-approval is hard-blocked** (`23514`, AD4); **D3** approve+`quality=poor` → `23514`;
> **AD4 timing** — submit stamps `submitted_at`, `needs_revision` preserves it and increments `revision_count`,
> resubmit refreshes it; cross-org assignee / policy-version → `23503`; **RLS** — assignee, own-team manager,
> reviewer, HR, Auditor and a **support-grant (top-level OR)** see the task while **Finance and other-team and
> cross-tenant read 0** (task_events/task_reviews inherit task visibility); the **permission catalog is unchanged
> (20)**. One in-slice fix restructured the tasks SELECT so `has_support_grant()` is a top-level OR (support users
> have no membership → `current_org()` is null). (Phase 5 note: approving task 100 now writes exactly one
> `task_approved` row; the 0013 boundary assertion was amended accordingly.)
>
> **Phase 5 scoring engine: VERIFIED / DONE** (2026-08-01, npx Supabase CLI **2.109.1**; commit `aa47e40`).
> `db reset` applied migrations **0001..0020** + seed cleanly; `test db` → **Files=14, Tests=626, Result=PASS,
> Failed=0** (`0001`..`0014` ok). Invariants proven (04; D3/AD4/AD5/AD7/SI-1/SI-11/SI-12): when a task becomes
> `approved` (review-driven), a **SECURITY DEFINER BEFORE UPDATE trigger** reads the locked **published** policy
> version's multipliers + `revision_penalty_rule`, computes `final = base·complexity·impact·quality·timeliness·
> (1-min(rev·0.05,0.25))` (doc 04), sets `tasks.final_points` (now `numeric`), and writes **exactly one**
> `point_ledger` `task_approved` earning row (breakdown in `metadata`). **Determinism:** task 100 = 187.5, and
> `tasks.final_points = points_delta`. **SI-1 idempotency:** a partial unique index — a second `task_approved` for
> the same task → `23505`. **AD5:** a different `collaboration_score` yields the same `final_points` (it is
> metadata-only). **AD4:** the earning row's timeliness is the approving review's value (a late approval never
> re-penalizes). **Revision cap:** rev-6 → rate `0.25` → `140.625`. **AD7:** a draft/non-published policy version
> cannot score (`23514`, no row). **D3:** approve+`quality=poor` is rejected before scoring (`23514`, no row). A
> **trusted direct-approve without a review skips** scoring; review-driven approves score. **Finance is excluded**
> from raw `point_ledger` (`SI-12`); the earning row is **server-written** (`SI-11`); the **catalog stays 20**; and
> **no `bonus_ledger`/bonus rows** are written. Seed populated `d2`/`b-d2` policy multipliers + penalty rule with
> doc-04 values. In-slice fix: scoring **skips** (rather than errors) when a trusted approve has no review; and the
> 0013 obsolete "no ledger" boundary assertion was amended (authorized).
>
> **Phase 6 bonus engine: VERIFIED / DONE** (2026-08-09, npx Supabase CLI **2.109.1**; commit `0c54fba`).
> `db reset` applied migrations **0001..0021** + seed cleanly; `test db` → **Files=15, Tests=665, Result=PASS,
> Failed=0** (`0001`..`0015` ok). Invariants proven (05 §8; D1/D6/D10/AD6/AD7/AD8/AD9/AD10/SI-13): the **doc-05
> §8 worked example** reproduces exactly (final 3,177,630 / 3,177,629 / 953,289 / 2,691,452; Σ = pool
> 10,000,000; undistributed 0; tie-break Ali 201 < Ayşe 202); the run is **idempotent** per `(org, key)` (one
> run, four allocations); completed-run allocations are **frozen** and the snapshot **immutable**; **AD10** — an
> unlocked period is rejected (`23514`); **cap-binding + D6** — all-capped Σ = 20,000,000 with residual
> 980,000,000 undistributed (not redistributed); **AD8** — T_org=1.2 without top-up caps distributable at the
> pool (`top_up_applied=false`), with top-up reaches 1.2× (`top_up_applied=true`); **T_org=0** and **Σadj=0**
> both leave the whole pool undistributed; a **single eligible** employee takes the full distributable; **AD6** —
> a missing cap basis yields `pending_missing_cap_basis` with no cap materialized; the engine writes **NO
> `bonus_ledger` rows** (accrual deferred to 6-b; seed count stays 5); the **permission catalog is unchanged
> (20)**; Finance cannot read raw allocations (SI-12). One in-slice **test-only** fix qualified an ambiguous
> `top_up_applied` reference to `s.top_up_applied` in the snapshot subquery.
>
> **Phase 6-b bonus_ledger accrual: VERIFIED / DONE** (2026-08-09, npx Supabase CLI **2.109.1**; commit `a65013d`).
> `db reset` applied migrations **0001..0022** + seed cleanly; `test db` → **Files=16, Tests=690, Result=PASS,
> Failed=0** (`0001`..`0016` ok). Invariants proven (ADR-006/017; D2/AD6/AD8; BL-1/BL-2; SI-3/SI-7/SI-12/SI-13):
> the **snapshot-approval boundary** — `post_bonus_accrual()` is rejected (`23514`) while the period is
> `calculated`, and only after HR moves it `calculated→approved` (`period.manage`, existing transition; the
> immutable snapshot is never mutated) does it post; the **worked-example accrual** reproduces doc-05 §8 (credits
> 3,177,630 / 3,177,629 / 953,289 / 2,691,452; `debit pool = Σfinal = 10,000,000`; `Σdebit = Σcredit`); the post
> is **idempotent** per snapshot (a re-post adds no rows); **BL-2** — an accrual whose `Σaccrual` exceeds
> `pool_ref` is rejected (`23514`, deferred trigger); **AD6 gate** — a `pending_missing_cap_basis` allocation
> blocks the accrual (`23514`); **BL-1** append-only (UPDATE → `23001`); the money ledger raw read stays **Finance
> and Auditor only** (HR / employee / manager read 0; cross-tenant reads 0 — SI-12/SI-7); the **permission catalog
> is unchanged (20)**. **BL-3** (payout ≤ accrual) stays deferred (no payout producer in this slice). Two in-slice
> **test-only** fixes (org-scope the privileged Section-A queries; `::bigint` cast on a `Σaccrual`); no
> migration/engine defect.
>
> **Phase 6-d bonus engine authz hardening: VERIFIED / DONE** (2026-08-09, npx Supabase CLI **2.109.1**; commit
> `0b8b34a`). `db reset` applied migrations **0001..0024** + seed cleanly; `test db` → **Files=18, Tests=720,
> Result=PASS, Failed=0** (`0001`..`0018` ok). Invariants proven (AD1): both `run_bonus_calculation` (0021) and
> `post_bonus_accrual` (0022) had an entry-authz whose "trusted context" clause was `current_user not in
> ('authenticated','anon')` — **ineffective inside a SECURITY DEFINER** (there `current_user` is the owner, so the
> clause is always true and `period.manage` was never enforced). `0024` **CREATE OR REPLACEs** both with
> byte-identical bodies except that clause → **`auth.uid() IS NULL`**. An **authenticated caller without
> `period.manage` (Finance c4) is now rejected `42501`**; an **authenticated caller with `period.manage` (HR c3)**
> passes authz and then hits `23503` on a bogus period (proving the privileged path is admitted); a **trusted
> context (`auth.uid()` null)** likewise passes authz → `23503` — asserted for **both** functions (the authz check
> runs before any lookup, so bogus UUIDs suffice). **No regression:** the 0015/0016 engine calls all run in a
> trusted context and stay green. Same signatures → GRANTs/COMMENTs preserved; **no logic/ledger change, no new
> permission (catalog 20), no seed change, 0023 untouched**; the migration is idempotent (`CREATE OR REPLACE`).
> Consequence: with 6-d taking `0024`, the planned dispute migrations shift to **7-B `0025` / 7-C `0026`** (doc-19 §9).
>
> **Phase 7-A anti-gaming detection engine: VERIFIED / DONE** (2026-08-09, npx Supabase CLI **2.109.1**; commit
> `ffdea06`). `db reset` applied migrations **0001..0023** + seed cleanly; `test db` → **Files=17, Tests=712,
> Result=PASS, Failed=0** (`0001`..`0017` ok). Invariants proven (08; D5/OQ-1..OQ-3): `run_anti_gaming_scan()`
> orchestrates four `detect_*` rules and each fires **positively** on a crafted anomaly and **not** on a clean
> fixture — **duplicate_task** (same assignee + normalized title within 24h), **tiny_task_splitting** (≥3
> `base_points<5` tasks within 1h), **same_reviewer_concentration** (a reviewer's share >0.80 with ≥3 period
> approvals), **period_end_spike** (last-3-days `task_approved` gain > 3× the period daily average); **dual
> idempotency** (OQ-2) — a re-scan adds **no** new flag (the two partial unique indexes back the `where not
> exists` guard); **D5 no-side-effect** — a scan leaves `point_ledger` **and** `bonus_ledger` row counts
> **unchanged** (the engine writes only `anti_gaming_flags`; no FK/write to any financial table), a confirmed flag
> is still inert and no dispute is auto-created; **server-only** — a non-HR authenticated caller is rejected
> (`42501`), the `detect_*` helpers are not callable by `authenticated` (granted to `service_role` only), and a
> direct client `anti_gaming_flags` INSERT stays rejected (0016 posture). One in-slice **migration fix**: the scan
> authz was `current_user not in (...)`, which is ineffective inside a SECURITY DEFINER (there `current_user` is
> the owner) — corrected to `has_role('hr') OR auth.uid() IS NULL`. **Note (now resolved):**
> `run_bonus_calculation` (0021) and `post_bonus_accrual` (0022) carried the **same** latent `current_user` authz
> weakness — **fixed in Phase 6-d (`0024`, commit `0b8b34a`)**; all three (0021/0022/0023) now use the
> `auth.uid() IS NULL` trusted-context check.
>
> **Phase 7-B dispute point adjustment: VERIFIED / DONE** (2026-08-09, npx Supabase CLI **2.109.1**; commit
> `70ba400`). `db reset` applied migrations **0001..0025** + seed cleanly; `test db` → **Files=19, Tests=737,
> Result=PASS, Failed=0** (`0001`..`0019` ok). Invariants proven (07 §62; D9/D2/ADR-005):
> `apply_dispute_point_adjustment()` on a **resolved+accepted** dispute appends **exactly one** `point_ledger`
> `dispute_adjustment` delta for the **complainant**, returns its id; a **rejected**, an **under_review**, or a
> **zero-delta** call is rejected `23514` (fail-closed); a **second** apply is an idempotent **no-op** (returns the
> same row; a direct duplicate hits the partial unique index → `23505`); a `dispute_adjustment` **without a
> dispute_id** → `23514`, while an **invalid event_type** is still rejected by the same-named CHECK (0003
> regression holds); the insert **produces an `audit_logs` row** (`point_ledger.insert` — the widened WHEN clause);
> the row is **append-only** (UPDATE → `23001`); a **cross-org** dispute_id/organization_id pairing is rejected by
> the same-org composite FK (`23503`, SI-7); and an **authenticated caller without `dispute.resolve`** (a plain
> employee) is rejected `42501`. `task_approved` stays un-audited (0020 behaviour); the **catalog stays 20**; D2 is
> not violated (a point correction is not a paid-money clawback — the money side is 7-C).
>
> **Phase 7-C dispute bonus recalculation: VERIFIED / DONE** (2026-08-10, npx Supabase CLI **2.109.1**; commit
> `8941089`). `db reset` applied migrations **0001..0026** + seed cleanly; `test db` → **Files=20, Tests=753,
> Result=PASS, Failed=0** (`0001`..`0020` ok). Invariants proven (plan `19 §5.3`; D2/OQ-4/OQ-6/ADR-006/ADR-017;
> BL-1; SI-7): `recalculate_bonus_after_dispute()` on an **approved period with an accrued completed run**
> (Section A worked example — period 230 / Org C, accrual=10,000,000) marks the run **superseded**, transitions
> the period **`approved→calculated`** (re-approval required before re-accrual — `post_bonus_accrual()` 0022
> approved-gate enforces it; confirmed: re-accrual raises `23514`), and posts a **balanced reversal**: 5 mirror
> rows (one pool-credit + 4 employee-debits; debit↔credit swap; new `transaction_id`); `Σdebit=Σcredit` of the
> reversal (ADR-017); reversal magnitude = original accrual total (10,000,000); the original accrual rows are
> **intact** (snapshot immutable — UPDATE → `23001`); **idempotent** (a second call is a no-op; no duplicate
> reversal rows). **Paid-guard (OQ-4/D2):** a self-contained fixture inserts a manual accrual pair + a simulated
> `payout_exported` row (trigger disabled/re-enabled with `set constraints all immediate` to flush deferred
> events before ALTER) → `recalculate_bonus_after_dispute()` raises `23514` (paid clawback gated). **Authz:**
> a plain employee without `period.manage` is rejected `42501`. **Append-only:** a reversal UPDATE → `23001`
> (BL-1). **DB balance:** `Σ(original accrual + reversal) credits = Σ debits`. **C-c1 reduced scope:** no new
> run or snapshot is produced; dispute_adjustment rows have `NULL task_id` so the engine would compute an
> unchanged bonus basis anyway — that correction path is **handled in Phase 7-D (`31c226f`)**. `validate_bonus_period_transition()`
> is CREATE OR REPLACEd to add the `approved→calculated` transition required by recalculation. No new permission
> (catalog 20); BL-3 is added in Phase 6-c (`0027`).
>
> **Phase 6-c payout/export engine: VERIFIED / DONE** (2026-08-10, npx Supabase CLI **2.109.1**; commit
> `77615e3`). `db reset` applied migrations **0001..0027** + seed cleanly; `test db` → **Files=21, Tests=780,
> Result=PASS, Failed=0** (`0001`..`0021` ok). Invariants proven (06 §2; D2/AD6; BL-3; SI-12):
> `produce_payout_export()` on an **approved period** (AD6 gate: `pending_missing_cap_basis` → `23514`) inserts
> the `exports` record and transitions the period **`approved→exported`** (SECURITY DEFINER — Finance lacks
> `period.manage`); an **`exported` period** passed to `mark_payout_paid()` posts **per-employee balanced
> `payout_marked_paid`** rows (one debit-accrual + one credit-payout per employee, same `transaction_id`; the
> deferred balance trigger confirms `Σdebit=Σcredit`) and closes the period **`exported→closed`**; the post is
> **idempotent** — a second `mark_payout_paid` call returns the existing `transaction_id` without inserting new
> rows (idempotency guard fires **before** the period gate, so the call succeeds even when the period is already
> `closed`); **BL-3** — `enforce_bonus_ledger_payout_cap()` (DEFERRABLE INITIALLY DEFERRED) rejects a payout
> that exceeds net accrual (`23514`, reversal-aware: net = Σcredit-accrual − Σdebit-reversal), and a net-zero
> accrual blocks all payout; **AD6 gate** — a `pending_missing_cap_basis` allocation blocks
> `produce_payout_export()` (`23514`); `payout_exported` and `clawback_pending` are still blocked by
> `validate_bonus_ledger_event()` (`23514`); a `payout_marked_paid` row without `export_id` → `23514`; Finance
> without `payout.export` → `42501`; Finance without `payout.mark_paid` → `42501`; Finance reads the worked
> example in `v_finance_payout` (final_amount_minor + paid_amount_minor + status); `v_finance_payout` has **no
> `adjusted_score`, `cap_basis_minor`** (SI-12 clean); cross-tenant Finance A reads **0 rows** from Org C.
> 0020 test-only amendment: paid-guard fixture changed `payout_marked_paid` → `payout_exported` (the new
> `bonus_ledger_payout_export_chk` CHECK requires `export_id IS NOT NULL` for `payout_marked_paid` rows —
> `payout_exported` is still rejected by `validate_bonus_ledger_event()` with `23514`, so the paid-guard in
> `recalculate_bonus_after_dispute()` still fires correctly). **No migration/engine defect** in any prior slice.
>
> **Phase 7-D dispute_adjustment → bonus basis: VERIFIED / DONE** (2026-08-10, npx Supabase CLI **2.109.1**;
> commit `31c226f`). `db reset` applied migrations **0001..0028** + seed cleanly; `test db` → **Files=22,
> Tests=797, Result=PASS, Failed=0** (`0001`..`0022` ok). Invariants proven (plan `19`; OQ-7D-1..7D-7;
> SI-13): `point_ledger` gains nullable `bonus_period_id` with composite FK to `bonus_periods` and a CHECK
> enforcing `dispute_adjustment → NOT NULL / others → NULL`; `apply_dispute_point_adjustment()` gains a
> 5th param `p_bonus_period_id` (DROP+CREATE; GRANTs re-issued); `run_bonus_calculation()` sums
> `dispute_adjustment` rows via `WHERE bonus_period_id = p_bonus_period_id` in addition to the task-JOIN
> path, and the `factors` jsonb gains `dispute_adjustment_points`; a +1,000,000 delta raises Ali's bonus
> basis and shifts all allocations (SI-13 Σ invariant holds); a net ≤ 0 employee is excluded (existing `>0`
> filter); the engine is idempotent from `calculated` state (OQ-7D-3: gate widened to `IN('locked',
> 'calculated')`); the CHECK correctly rejects a `dispute_adjustment` with NULL `bonus_period_id` (`23514`),
> a non-dispute row with non-NULL `bonus_period_id` (`23514`), and a cross-org FK pairing (`23503`); an
> approved-period gate attempt raises `23514`; catalog stays 20 (OQ-7D-7); Finance without `period.manage`
> raises `42501`. **0015 #18 regression verified**: gate message text preserved verbatim. **0019 amendments**:
> 3 in-suite fixes for new CHECK (apply call + direct insert + cross-tenant insert now supply `bonus_period_id`).
>
> **Phase 7-E dispute bonus re-run orchestration: VERIFIED / DONE** (2026-08-10, npx Supabase CLI **2.109.1**;
> commit `3efe95d`). `db reset` applied migrations **0001..0029** + seed cleanly; `test db` → **Files=23,
> Tests=814, Result=PASS, Failed=0** (`0001`..`0023` ok). Invariants proven (plan `19`; OQ-7E-1..7E-6;
> ADR-006/D2): `recalculate_bonus_after_dispute()` CREATE OR REPLACE (same 3-arg signature → grant/OID kept)
> upgraded from C-c1 to full orchestration — mechanical steps (reversal 5 rows, run superseded, period
> `approved→calculated`) unchanged; NEW `run_bonus_calculation()` call fetches the locked pool from the DB
> (missing pool → `23514`) and produces a new completed run + immutable snapshot under idempotency key
> `'disp-recalc-snap-'||reversed_snapshot_id`; returns the NEW snapshot id; new allocation reflects
> `dispute_adjustment_points=1,000,000` for Ali (7-D engine); SI-13 Σ invariant holds on the new snapshot;
> Ali's new final > old final. **Idempotency**: second call returns same new snapshot, no duplicate reversal
> or run rows. **Re-accrual gated** (`post_bonus_accrual` on `calculated` period → `23514`; ADR-006 preserved).
> **Pool guard**: no locked pool → `23514`. **Precondition**: locked period with no accrual → `23514`.
> **Authz**: Finance without `period.manage` → `42501`. Catalog stays 20. **0020 amendments** (3 test-only
> fixes): `_b7c_snap` helper gains accrual filter (prevents ambiguity with 7-E's new non-accrued re-run);
> `#6` scoped via accrued snapshot; `#10` expects the new re-run snapshot (7-E semantics).
>
> **Phase 3 DB foundation is COMPLETE** (12 migrations `0001..0018` / 12 suites, Tests=523); the **Phase 4 task/
> review core** (`0019`/`0013`), **Phase 5 scoring engine** (`0020`/`0014`), **Phase 6 bonus calculation
> engine** (`0021`/`0015`), **Phase 6-b bonus_ledger accrual** (`0022`/`0016`), the **Phase 6-c payout/export
> engine** (`0027`/`0021`), the **Phase 6-d bonus engine authz hardening** (`0024`/`0018`), the **Phase 7-A
> anti-gaming detection engine** (`0023`/`0017`), the **Phase 7-B dispute point adjustment** (`0025`/`0019`),
> the **Phase 7-C dispute bonus recalculation** (`0026`/`0020`), the **Phase 7-D dispute_adjustment → bonus
> basis** (`0028`/`0022`) and the **Phase 7-E dispute bonus re-run orchestration** (`0029`/`0023`) are also done
> (**Files=23, Tests=814** total). **Phase 5-b, Phase 8 and everything downstream (app UI/API) remain gated**
> (ADR-020). **Never run any of this against a production project.**

### Prerequisites

- [ ] **Docker Desktop** installed and **running** — verify: `docker info`.
- [ ] **Supabase CLI** available — `supabase --version` **or** `npx --no-install supabase --version`.
  - Install (Windows, no repo impact): **winget** `winget install Supabase.CLI`, **or** **Scoop**
    `scoop bucket add supabase https://github.com/supabase/scoop-bucket.git && scoop install supabase`.
  - Or project-local via `npx supabase` (the CLI is **not** supported as a global npm install).
  - macOS: `brew install supabase/tap/supabase`.
- [ ] You are in the repo root, and **not** linked to production (no `supabase link`/`db push`/`db pull`).

### Steps

```bash
supabase start        # 1. boot local stack; note the printed local URLs + dev-default keys
supabase db reset     # 2. apply 0001..0027 + seed (expect clean apply)
supabase test db      # 3. run pgTAP; expect TAP summary 0 failed
```

### Expected pass criteria

- [ ] **All pgTAP assertions pass** (TAP: `0` failed; currently **Files=22, Tests=797, PASS**). Blocking.
- [ ] Green coverage: cross-tenant isolation (SI-7), non-recursive memberships read (§7A), support
  active-vs-expired grant (D4), append-only audit + append-only `point_ledger` (SI-2), helper
  correctness, scoring-policy `policy.manage` gating + published-version immutability (AD7), point_ledger
  visibility (Finance excluded), **compensation_records** (raw SELECT closed, masked audit, justified read),
  **bonus_periods/pools** (state machine, AD10 pool-lock, locked t_org + immutability, period identity
  immutability, period.manage/pool.create separation — SI-4/SI-7), **bonus_pool_components/eligibility**
  (MVP individual=1.0 — D1; cross-tenant employee rejected via memberships composite FK; AD9 is_primary;
  server-only eligibility writes; inputs immutable once parent pool leaves draft — SI-4), and
  **bonus_calculation_runs/allocations/snapshots** (run machine + AD10 locked-period+locked-pool guard;
  idempotency; completed-run allocation freeze; thin snapshot append-only; cap-not-exceeded;
  approved/exported/paid blocked; Finance raw-allocation excluded — SI-12/SI-14), **bonus_ledger**
  (double-entry deferred `Σdebit=Σcredit` per (org, transaction_id); append-only; accrual⇒snapshot + idempotent;
  only bonus_accrual+reversal writable; Finance/Auditor-only raw read — HR/Employee/Manager/Support excluded),
  **disputes/dispute_events** (state machine + forbidden transitions + post-open identity immutability;
  auto-written append-only events; D9 reviewer≠owner/complainant + owns_review_decision; HR-only assign;
  due_at sanity; Finance/Support excluded from reads — D9/SI-6/SI-7), **anti_gaming_flags** (review state
  machine + terminal immutability; review consistency + reviewer≠subject; D5 no-side-effect — confirming a flag
  leaves point_ledger/bonus_ledger counts unchanged; server-only INSERT; HR/own-team-manager review; Finance/
  Support excluded — D5/SI-6/SI-7), **notifications** (recipient-only RLS — HR/Auditor/Manager/Finance/
  Support read 0 rows; one-way unread→read with server-stamped read_at + read→unread rejected; identity
  immutable; server-only INSERT + no client DELETE; no new permission — catalog stays 20; cross-tenant recipient
  rejected via memberships composite FK — SI-7), and **exports** (Finance INSERT via existing payout.export +
  actor integrity exported_by=auth.uid(); snapshot_id NOT NULL; AD6/SI-15 gate blocks by allocation status or
  cap_applied via snapshot.calculation_run_id→bonus_allocations; bonus_period_id=snapshot period; append-only
  client posture + prevent_delete; audit on INSERT; Finance+Auditor SELECT — HR/Manager/Employee/Support read 0
  rows; no new permission — catalog stays 20; cross-tenant reads 0 — SI-3/AD6/SI-7), and **tasks/task_events/
  task_reviews** (status machine + forbidden transitions + DELETE forbidden; auto-written append-only task_events
  — AD4; review-driven transition via task_reviews INSERT + direct client approve/reject/needs_revision blocked;
  self-approval hard block — AD4; D3 approve⇒quality≠poor; AD4 submitted_at/revision timing; same-org FKs; RLS
  assignee/creator/reviewer/team-manager/HR/Auditor/support-grant — Finance excluded; catalog stays 20 —
  D3/AD4/AD5/SI-7/SI-12), and **scoring engine** (approve→one task_approved point_ledger row = 187.5 deterministic;
  tasks.final_points numeric = points_delta; SI-1 partial-unique idempotency; AD4 review timeliness; AD5
  collaboration non-scoring; revision cap 25%; AD7 draft-policy cannot score; D3 blocked pre-scoring; direct-approve
  w/o review skips; Finance excluded from raw point_ledger; server-only; no bonus writes; catalog 20 —
  SI-1/SI-11/SI-12/AD4/AD5/AD7/D3), and **bonus engine** (doc-05 §8 worked example Σ = pool 10,000,000,
  undistributed 0; idempotency; cap + D6 residual 980,000,000; AD8 T_org=1.2 top-up yes/no; T_org=0 & Σadj=0
  whole-pool undistributed; AD6 `pending_missing_cap_basis`; NO `bonus_ledger` accrual; period locked→calculated
  — SI-13/AD6/AD8/AD10), and **anti-gaming detection engine** (`run_anti_gaming_scan()` + 4 `detect_*` rules each
  positive-on-anomaly / negative-on-clean; dual idempotency OQ-2 — re-scan adds no flag; D5 no-side-effect —
  scan leaves point_ledger + bonus_ledger counts unchanged, flag isolated from all financial tables; server-only
  — non-HR 42501, detect_* service_role-only, direct flag INSERT rejected; authz `has_role('hr') OR auth.uid() IS
  NULL`; hardcoded thresholds OQ-1; catalog stays 20 — D5/OQ-1/OQ-2/OQ-3), and **bonus engine authz hardening**
  (`run_bonus_calculation` + `post_bonus_accrual`: authenticated without period.manage -> 42501; authenticated with
  period.manage -> authz passes -> 23503; trusted context auth.uid() null -> authz passes -> 23503; no regression —
  0015/0016 stay green — AD1), and **dispute point adjustment** (`apply_dispute_point_adjustment()`: resolved+accepted
  -> one point_ledger dispute_adjustment delta for the complainant; rejected/under_review/zero-delta -> 23514
  fail-closed; idempotent no-op + 23505 backstop; missing dispute_id -> 23514 + invalid event_type -> 23514 (0003
  regression); audit row on insert; append-only 23001; cross-tenant FK 23503; employee without dispute.resolve -> 42501;
  catalog 20 — D9/D2/ADR-005/SI-7), and **dispute bonus recalculation**
  (`recalculate_bonus_after_dispute()`: run superseded + period approved→calculated + balanced reversal
  Σdebit=Σcredit + original accrual immutable; idempotent no-op; paid-guard 23514 (D2 OQ-4); authz
  employee without period.manage -> 42501; reversal UPDATE -> 23001 (BL-1); DB balance; catalog 20 —
  D2/OQ-4/OQ-6/ADR-006/ADR-017/BL-1/SI-7).
- [ ] `supabase db reset` then re-running the suite is reproducible (deterministic seed).

### Failure triage

- **Stale/dead stack** (`supabase_db_...` shows `Exited (137)`) → not a code defect; `supabase stop
  --no-backup` then `supabase start`, then `db reset`.
- **Migration fails on `auth.users` insert** → watchpoint A (extend seed's `auth.users` columns).
- **`supabase test db` errors "function ... does not exist" / pgTAP missing** → watchpoint B.
- **Assertions about counts fail as authenticated** → watchpoint C (role switching / `request.jwt.claims`).
- **Helpers return null/false unexpectedly under RLS** → watchpoint D (owner role BYPASSRLS assumption).
- **Cross-tenant test "leaks" rows** → a policy is missing its `organization_id = current_org()` anchor
  (a real defect). After any fix, re-run `supabase db reset && supabase test db` from a clean state.

### Version-dependent watchpoints

- **A. `auth.users` seed columns** — extend the seed's `auth.users` INSERT if a local Supabase auth
  schema requires more NOT NULL columns. (Seed/migration files: do not change without re-authorization.)
- **B. pgTAP availability** — use the Supabase test runner (`supabase test db`).
- **C. role switching** — suites use `set local role authenticated` + `set_config('request.jwt.claims', …)`.
- **D. BYPASSRLS owner-role** — recursive-RLS safety (§7A) relies on SECURITY DEFINER helpers owned by a
  bypassrls role (Supabase `postgres`).

### ⛔ Production safety

- Local stack only. Do **not** `supabase link` + `db push`/`db pull` to prod, and do **not** point
  Supabase MCP at production (ADR-014 / CLAUDE.md). `service_role` key stays in env.

## Tables and data classes

**Phase 3A — foundation/RBAC (11):**

| Table | org_id? | Class | Notes |
| --- | :--: | --- | --- |
| organizations | no (root) | internal | tenant root |
| organization_settings | yes | confidential | 1-1, audited |
| profiles | **no (global)** | personal-data | auth-bound; org link via memberships (§8A) |
| roles / permissions / role_permissions | **no (catalog)** | internal/confidential | global, read-only to clients (§8A) |
| memberships | yes (anchor) | confidential | one primary_role/org (AD2); audited |
| teams | yes | internal | manager_id drives manages_team |
| team_memberships | yes | internal | is_primary = single eval team (AD9) |
| support_access_grants | yes | audit-critical | time-bounded (D4); audited |
| audit_logs | yes | audit-critical | append-only; comp payload masked (AD3) |

**Phase 3B / Phase 3 comp + bonus + governance (15):**

| Table | org_id? | Class | Notes |
| --- | :--: | --- | --- |
| scoring_policies | yes | confidential | writes need `policy.manage`; audited |
| scoring_policy_versions | yes | confidential, audit-critical | **immutable once published** (AD7); same-org composite FK |
| point_ledger | yes | audit-critical, financial-critical | **append-only**; server-only writes; Finance excluded |
| compensation_records | yes | **compensation-sensitive**, personal-data | **no direct raw SELECT**; comp.read INSERT/UPDATE; DELETE blocked; masked write/access audit; raw reads via `read_compensation_record()` |
| bonus_periods | yes | financial-critical | state machine (open→locked→…→closed); locked needs metadata; identity immutable once locked (SI-4); org-wide read, `period.manage` write; DELETE blocked |
| bonus_pools | yes | financial-critical | one active pool/period; **AD10** period-lock guard; locked needs `t_org`+metadata + immutable; HR/Finance/Auditor read, `pool.create` write; DELETE blocked |
| bonus_pool_components | yes | financial-critical | MVP `individual`=1.0 only (D1); same-org composite FK to pool; HR/Finance/Auditor read, `pool.create` write; **immutable once pool leaves draft** (SI-4); DELETE blocked |
| bonus_pool_eligibility | yes | financial-critical, personal-data | 15-day + proration (D10); **same-org employee via `memberships` composite FK**; `primary_team_id` same-org + AD9 `is_primary`; **server-only writes**; employee-own + HR/Finance/Auditor read; **immutable once pool leaves draft** (SI-4); DELETE blocked |
| bonus_calculation_runs | yes | financial-critical, audit-critical | run machine running/completed/superseded; starts only on **locked period + locked pool** (AD10); idempotency `unique(org, key)`; **server-only writes**; HR/Finance/Auditor read; audited; DELETE blocked |
| bonus_allocations | yes | financial-critical | per (run, employee); cap-not-exceeded + `cap_applied` (pending_missing_cap_basis); same-org employee/team composite FK + AD9; **frozen once run completed** (SI-4/SI-14); **server-only writes**; employee-own + HR/Auditor read (**Finance view-only — SI-12**); DELETE blocked |
| bonus_allocation_snapshots | yes | financial-critical, audit-critical | **thin** freeze marker, one per run; **append-only immutable** (UPDATE/DELETE blocked — INV-6/SI-14); same-org composite FK; **server-only** insert; HR/Finance/Auditor read; audited |
| bonus_ledger | yes | financial-critical, audit-critical | **double-entry** (debit/credit; pool/accrual/payout/clawback); **append-only** (correction=reversal); **deferred `Σdebit=Σcredit` per (org, transaction_id)** trigger; accrual⇒snapshot + idempotent; only bonus_accrual+reversal writable; **server-only writes**; **raw read Finance+Auditor only** (HR/Employee/Manager/Support excluded — SI-12); audited (BL-4) |
| disputes | yes | confidential, personal-data | **mutable state machine** (open→under_review→needs_info→resolved→closed); post-open identity immutable; **D9** reviewer≠owner/complainant + `owns_review_decision`; HR-only assign (`has_role('hr')`); `due_at` stored + sanity; read complainant/reviewer/HR/Auditor (**Finance/Support excluded**); `target_id` polymorphic (no FK); DELETE blocked; audited |
| dispute_events | yes | audit-critical | **append-only** history **auto-written** by a definer trigger on each dispute transition (`actor_id=auth.uid()`); no authenticated write; UPDATE/DELETE blocked; read follows parent-dispute visibility (+ Auditor) |
| anti_gaming_flags | yes | confidential | **mutable review lifecycle** (open→reviewing→confirmed\|dismissed); post-insert identity immutable; **D5 no-auto-punish** — isolated (no FK/write to point_ledger/bonus_ledger/bonus_*/compensation); review consistency + `reviewed_by≠subject`; **server-only INSERT**; review `has_role('hr')` OR `manages_team(team_of(subject))` (no `flag.review` permission); read subject-own + own-team manager + HR + Auditor (**Finance/Support excluded**); DELETE blocked; audited |

## Security guarantees enforced here

- **RLS ENABLED + FORCE** on all tenant tables (SI-6); every tenant policy anchored on
  `organization_id = current_org()` → cross-tenant blocked (SI-7).
- **Authorization from DB** (`role_permissions`), never JWT (AD1); JWT = identity only.
- **Recursive-RLS safe** (§7A): helpers (incl. `team_of`) are SECURITY DEFINER + fixed `search_path`.
- **Least privilege**: `authenticated` is never granted `DELETE`; catalog tables read-only; `point_ledger`
  is SELECT-only for `authenticated`; **`compensation_records` has NO raw SELECT** (only column `id`;
  raw reads via the audited `read_compensation_record()`); `bonus_pools` read limited to HR/Finance/Auditor.
- **Append-only** (SI-2): triggers block UPDATE/DELETE on `audit_logs` and `point_ledger`.
- **Scoring-version immutability** (AD7): published `scoring_policy_versions` cannot be UPDATE/DELETE'd.
- **Compensation confidentiality** (AD3/D7/SI-5): raw salary/cap never directly selectable and never in
  `audit_logs` (masked write + access audit); raw reads require a reason and are audited; DELETE forbidden.
- **Bonus lock discipline** (AD10/SI-4): a period cannot lock before its pool is locked; a locked pool
  requires `t_org` + lock metadata and freezes its amount/`t_org`; a locked/non-open period's dates/type/org
  are immutable; `period.manage` vs `pool.create` separation of duties.
- **Bonus calc-input integrity** (D1/D10/AD9/SI-4): `bonus_pool_eligibility.employee_id` is a **same-org
  composite FK to `memberships`** → a cross-tenant employee cannot be made eligible; `primary_team_id` is
  same-org and must be the employee's `team_memberships.is_primary` (AD9); components are limited to MVP
  `individual`=1.0 (D1); eligibility writes are **server-only**; once the parent pool leaves `draft`, both
  components and eligibility rows are **immutable** (locked/superseded calc inputs cannot silently change).
- **Bonus calculation integrity** (AD6/AD10/SI-4/SI-12/SI-13/SI-14): a `bonus_calculation_run` starts **only on
  a locked period AND a locked pool** (draft/superseded pool rejected); runs are idempotent per
  `(organization_id, idempotency_key)`; once a run is `completed`, its `bonus_allocations` are **fully frozen**
  (any INSERT/UPDATE rejected); `bonus_allocation_snapshots` are **thin + append-only** (UPDATE/DELETE blocked,
  one per run); allocations enforce `final_amount ≤ cap` when capped and carry the `pending_missing_cap_basis`
  marker (AD6); `approved/exported/paid` transitions are blocked in this slice; all run/allocation/snapshot
  child links are **same-org composite FKs** (cross-tenant impossible); allocation reads exclude Finance (raw
  is view-only, SI-12); `Σfinal + undistributed_remainder = pool` is verified by test/fixture, not a hard
  trigger (SI-13/INV-4).
- **Double-entry money integrity** (ADR-017/BL-1..4/SI-3/SI-12): `bonus_ledger` is **append-only** (UPDATE/
  DELETE hard-blocked; correction = reversal); a **DEFERRABLE INITIALLY DEFERRED** balance trigger rejects any
  `(organization_id, transaction_id)` where `Σdebit ≠ Σcredit`; accrual requires `snapshot_id` and is
  idempotent per `(snapshot_id, employee_id, account)`; only `bonus_accrual` + `reversal` are writable in this
  slice; raw read is **Finance + Auditor only** (HR/Employee/Manager **and support-grant** all excluded);
  writes are **server-only**; all child links are same-org composite FKs. BL-2/BL-3 are test/fixture-verified.
- **Dispute integrity** (D9/SI-6/SI-7 + ADR-006): `disputes` is a mutable state machine with a validate trigger
  (allowed/forbidden transitions + post-open identity immutability); `dispute_events` is **auto-written** by a
  SECURITY DEFINER trigger on each transition and is **append-only** (no authenticated write; UPDATE/DELETE
  blocked). **D9**: an assigned reviewer cannot be the decision owner nor the complainant (CHECKs), and the
  resolver cannot be the owner of the disputed decision (`owns_review_decision`); assign is **HR-only**
  (`has_role('hr')`, no new permission). Reads are complainant / assigned reviewer / HR / Auditor only
  (**Finance and support-grant excluded**); all actor links are same-org composite FKs.
- **Anti-gaming no-auto-punish** (D5/SI-6/SI-7 + ADR-006): `anti_gaming_flags` is a mutable review lifecycle
  with a validate trigger (forbidden skip/`reviewing→open`/terminal transitions + post-insert identity
  immutability). **D5 is guaranteed BY CONSTRUCTION**: the table is fully **isolated** — it has NO FK, trigger
  or write path to `point_ledger` / `bonus_ledger` / any `bonus_*` table / `compensation_records`, so a
  `confirmed` flag has **no automatic financial/penalty effect** (proven: ledger row counts are unchanged on
  confirm). INSERT is server-only (rule engine); review (confirm/dismiss) is HR or the subject's own-team
  manager (`manages_team(team_of(subject))`) with the recorded `reviewed_by` = the actor and `≠` the subject; no
  `flag.review` permission is added. Reads are subject-own / own-team manager / HR / Auditor (**Finance and
  support-grant excluded**); all actor links are same-org composite FKs.
- **Support access** (D4): default no access; read only via an **active, unexpired** grant; audited. Support is
  **not** a raw-read path on sensitive governance data — `bonus_ledger`, `disputes`/`dispute_events` and
  `anti_gaming_flags` are all role-scoped (support-grant excluded).

## Out of scope (later slices / phases — still gated, ADR-020)

Manual point override/adjustment
(`point.override` 2-step → `manual_adjustment`), the **export generation engine**
(CSV/XLSX/storage write, checksum/row_count, status progression `requested→generated→downloaded`, the
period=`approved` gate) + `payout_exported`/`payout_marked_paid` ledger wiring (+ **BL-3** `payout ≤ accrual`
hard-enforce) + mark-paid + Finance aggregate views (`v_finance_*`), clawback workflow, the **dispute post-decision
wiring** — **Phase 7-B** point_ledger `dispute_adjustment` (`0024`) + **Phase 7-C** recalculation (new run/snapshot +
period `approved→calculated` re-approval + paid-accrual guard) + bonus_ledger reversal (`0025`) — the anti-gaming
**detection engine itself is now DONE** (Phase 7-A, `0023`); only statistical `anomaly_baselines`/Z-score (beyond the
5 deterministic rules) and the `self_approval_attempt` trail remain; the
notification **delivery engine** (email/push/realtime) + notification preferences + retention job, projects,
objectives, integrations, webhook_events, UI/dashboard, API routes. Each needs its own phase-scoped, verbatim
authorization (ADR-020).

> **Phase 3 DB foundation is complete** — all twelve table slices (`0001..0018`) are verified/committed; no DB
> table slice remains. The **app foundation scaffold** (Phase 3.5) is also **done** (commit `a8b05ac`): a
> Next.js 16.2.12 + React 19 + TS-strict App Router app with browser/server Supabase clients and a guarded,
> unused `server-only` service-role admin client, `@supabase/ssr` auth + DB/RLS-sourced RBAC (JWT identity only,
> AD1), `proxy.ts` (Next 16), Tailwind + shadcn base UI, a Zod Server Action wrapper, Vitest + Playwright, and CI
> (typecheck/lint/unit) — typecheck/lint/test/build all PASS. Sentry is a gated placeholder (SDK deferred pending
> Next 16 support). The **Phase 4 task/review core** (`0019`/`0013`) is also **done** (commit `148667e`):
> `tasks`, `task_events` and `task_reviews` — status machine + DELETE forbidden; auto-written append-only
> `task_events` history (AD4); append-only `task_reviews` whose INSERT drives the task transition via a SECURITY
> DEFINER trigger (a direct client approve/reject/needs_revision is blocked); self-approval hard block (AD4); D3
> approve⇒quality≠poor; AD4 timing tested; same-org composite FKs; RLS with assignee/creator/reviewer/team-manager/
> HR/Auditor and support-grant (top-level OR) visibility, Finance excluded; no new permission (catalog 20). The
> **Phase 5 scoring engine** (`0020`/`0014`) is also **done** (commit `aa47e40`): on the approved transition a
> SECURITY DEFINER trigger computes the doc-04 formula from the locked published policy version and writes exactly
> one `point_ledger task_approved` earning row (breakdown metadata) + the `tasks.final_points` numeric cache;
> SI-1 partial-unique idempotency; AD4 (review timeliness), AD5 (collaboration non-scoring), D3/AD7 guards; a
> trusted direct-approve without a review skips scoring; Finance excluded; no new permission; no bonus writes.
> The **Phase 6 bonus calculation engine** (`0021`/`0015`, commit `0c54fba`) is also **done**:
> `run_bonus_calculation()` populates `bonus_allocations` + an immutable snapshot from a locked period+pool
> (Safe Pro-Rata + cap + T_org/top-up + largest-remainder kuruş; Σ invariant SI-13; period locked→calculated;
> idempotent). Finally the **Phase 6-b `bonus_ledger` accrual** (`0022`/`0016`, commit `a65013d`) is **done**:
> after HR approves the period (`calculated→approved`, `period.manage`), `post_bonus_accrual()` posts one balanced
> double-entry accrual (debit pool = Σfinal / credit accrual per employee) from the approved snapshot — idempotent;
> AD6 gate; **BL-2** `Σaccrual ≤ pool_ref` (deferred trigger); the snapshot stays immutable and no new permission
> is added. The **Phase 7-A anti-gaming detection engine** (`0023`/`0017`, commit `ffdea06`) is **done**:
> `run_anti_gaming_scan()` + four `detect_*` rules produce flags into `anti_gaming_flags` with dual idempotency
> (OQ-2) and **D5 isolation** (a scan writes only flags — no ledger/bonus/comp write, no financial side effect);
> authz `has_role('hr') OR auth.uid() IS NULL`; no new permission. And the **Phase 6-d bonus engine authz
> hardening** (`0024`/`0018`, commit `0b8b34a`) is **done**: `run_bonus_calculation` + `post_bonus_accrual` had an
> ineffective `current_user`-based "trusted context" check inside a SECURITY DEFINER (current_user = owner), so
> `period.manage` was never enforced — `0024` CREATE OR REPLACEs both with byte-identical bodies except that clause
> → `auth.uid() IS NULL`; a one-way tightening (authenticated without `period.manage` now gets `42501`), no logic
> change, catalog stays 20, 0023 untouched. Finally the **Phase 7-B dispute point adjustment** (`0025`/`0019`,
> commit `70ba400`) is **done**: `apply_dispute_point_adjustment()` posts one `point_ledger` `dispute_adjustment`
> delta for the complainant on a resolved+accepted dispute (fail-closed `23514` otherwise), idempotent per dispute
> (partial unique index), audited, with a same-org composite FK to disputes (SI-7); the event_type CHECK was widened
> (DROP+ADD) and the audit WHEN clause widened (task_approved stays un-audited); no new permission. `db reset`
> `0001..0025` + seed; `test db` → **Files=19, Tests=737, PASS, Failed=0**. **Next major step:** **Phase 7-C —
> dispute bonus recalculation + reversal** (`0026`/`0020`: superseded run + period `approved→calculated`
> re-approval + new run/snapshot + paid-accrual guard → bonus_ledger reversal + new accrual); or the **payout/export engine**
> (`payout_exported`/`payout_marked_paid` + `v_finance_*` + BL-3). A scope-lock is recommended. **Not authorized yet.**

## Notes for reviewers

- `auth.users` seeding uses a minimal column set; extend the seed's `auth.users` INSERT if a local
  Supabase version requires additional NOT NULL auth columns.
- Primary team is resolved **only** from `team_memberships.is_primary` (AD9); `memberships` has no
  `primary_team_id` and must not gain one.
- Comp direct-SELECT access-auditing for HR/Finance is intentionally closed at the DB (no raw SELECT
  path); the audited path is `read_compensation_record()` (OQ-RLS-2 resolved for this table).
- bonus_periods overlap prevention is `unique(org, starts_on, ends_on)` + `ends_on > starts_on`; full
  daterange overlap exclusion (btree_gist) is deferred to a later slice.
