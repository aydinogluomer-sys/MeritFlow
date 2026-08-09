# 19 — Phase 7 Plan: Anti-Gaming Detection + Dispute Post-Decision

> **Planning document only.** Pre-implementation plan for Phase 7. It **proposes** functions,
> triggers, an idempotency index and migrations; it does **not** implement them. No migration/
> seed/test/config/app code is written or changed by this document. Decision Lock (D1–D12 +
> AD1–AD10) is binding; ADR-020 (implementation gate) governs when any of this may be built.
> The OQ decisions below are **locked** by the user (2026-08-09).

---

## 1. Status and authorization

- **Baseline:** Phase 6-b verified/committed (`a65013d`); migrations `0001..0022`; `test db` Files=16/Tests=690.
- **Phase 7 is a large slice → split into 3 sub-slices**, each its own migration + blocking pgTAP + verbatim
  ADR-020 authorization (`implementation authorized only for Phase 7-X — …`). Build order 7-A → 7-B → 7-C
  (7-C is the highest-risk, financial one; last).
- As of this document: **only 7-A is authorized** (`… Phase 7-A — anti-gaming detection engine`). 7-B/7-C **gated**.
- **Update (2026-08-09):** **7-A is DONE** (commit `ffdea06`; `0023`/`0017`). An out-of-band **Phase 6-d bonus
  engine authz hardening** slice was then implemented (commit `0b8b34a`) and **took migration `0024`** +
  test `0018`. **Consequence — the dispute migration/test numbers below shift by one:** 7-B `0024`/`0018` →
  **`0025`/`0019`**, 7-C `0025`/`0019` → **`0026`/`0020`** (see §3 and §9). 7-B/7-C were **gated** at that point.
- **Update (2026-08-09, later):** **7-B is DONE** (commit `70ba400`; `0025`/`0019`) — `apply_dispute_point_adjustment()`
  posts the resolved+accepted dispute's `point_ledger dispute_adjustment` delta (fail-closed, idempotent, audited;
  same-org FK to disputes). Current tip: migrations `0001..0025`, suites `0001..0019` (**Files=19/Tests=737**). Only
  **7-C** (`0026`/`0020`) remains **gated**.

## 2. Purpose

Phase 3 delivered `anti_gaming_flags` (0016) and `disputes`/`dispute_events` (0015) as **containers only** —
the **detection engine** and the **dispute post-decision effects** were deliberately deferred. Phase 7 adds:
the deterministic detection engine that produces flags (7-A), and the resolved-dispute → point/bonus
correction chain (7-B/7-C).

## 3. Sub-slice map

| Slice | Scope | New migration / test |
| --- | --- | --- |
| **7-A** | Anti-gaming detection engine (4 deterministic rules → flags); isolated, no financial wiring | `0023` / `tests/0017` — **DONE** (`ffdea06`) |
| **7-B** | Dispute post-decision **points**: `point_ledger dispute_adjustment` | `0025` / `tests/0019` — **DONE** (`70ba400`) |
| **7-C** | Dispute post-decision **money**: recalculation (new run+snapshot) + `bonus_ledger` reversal | `0026` / `tests/0020` (was `0025`/`0019`) |

> **Numbering note:** `0024`/`tests/0018` were consumed by the out-of-band **Phase 6-d authz hardening** slice
> (commit `0b8b34a`), so the dispute slices shift up by one.

## 4. Locked OQ decisions (user, 2026-08-09)

- **OQ-1 — thresholds:** **hardcoded constants** in the detect functions; `organization_settings` columns
  deferred to V1.
- **OQ-2 — flag idempotency (dual key):**
  - task-scoped rules (`duplicate_task`, `tiny_task_splitting`): `(organization_id, rule,
    subject_employee_id, related_task_id)`.
  - period-scoped rules (`period_end_spike`, `same_reviewer_concentration`): `(organization_id, rule,
    subject_employee_id, bonus_period_id)`.
  - Implemented as **two partial unique indexes** on `anti_gaming_flags` (+ an **FK-less** `bonus_period_id`
    column — mirrors the existing FK-less `related_task_id`, so D5 isolation "no FK to bonus_* tables" holds).
- **OQ-3 — scan trigger:** **explicit `run_anti_gaming_scan()` call** (HR / a job triggers it); **not**
  automatic at approve-time.
- **OQ-4 — paid accrual (7-C):** **fail-closed** — if an accrual being reversed is already **paid**, raise an
  exception; the clawback path stays gated (D2). 7-C only reverses **un-paid** accrual.
- **OQ-5 — dispute→target mapping:** post-decision functions take **explicit params** (delta, target); the
  app/producer resolves `disputes.target_id` (polymorphic, FK-less). No DB deriving.
- **OQ-6 — recalc trigger:** **explicit HR/server call** (human approval); **not** an automatic resolve
  trigger (D5 spirit).
- **OQ-7 — `self_approval_attempt` trail:** deferred to V1 (self-approval is already hard-blocked at Phase 4).
- **Ek karar — period status on recalc (7-C):** `recalculate_bonus_after_dispute()` moves the period status
  **`approved → calculated`** (re-approval required before re-accrual); this extra transition is added to the
  `0011` bonus-period state machine by an **ALTER (CREATE OR REPLACE `validate_bonus_period_transition`)** in
  the `0026` migration (7-C).

## 5. Detailed design

### 5.1 Slice 7-A — anti-gaming detection (migration `0023`) — DONE (`ffdea06`)

**New (all SECURITY DEFINER, server-only, `set search_path=''`):**

- `run_anti_gaming_scan(p_organization_id uuid, p_bonus_period_id uuid default null)` — orchestrator: runs the
  4 detect functions and inserts flags **idempotently** (`where not exists` guard + the unique indexes as a
  backstop). Period-scoped rules require `p_bonus_period_id`.

- `detect_duplicate_task(p_org)` — same `assignee_id` + same normalized `lower(btrim(title))` within a **24h**
  window, ≥ 2 → flag `duplicate_task` on the later task (`related_task_id` = later task; `evidence` records the
  original task + title). Constant: window = 24h.

- `detect_tiny_task_splitting(p_org)` — a task whose assignee has ≥ **M** tasks with `base_points < THRESHOLD`
  in the preceding **1h** → flag `tiny_task_splitting` (`related_task_id` = the triggering task). Constants:
  `THRESHOLD`, `M`, window = 1h.
- `detect_same_reviewer_concentration(p_org, p_period)` — per employee, among the tasks **approved in the
  period**, if one reviewer's share **> 80%** and total approvals **≥ MIN** → flag
  `same_reviewer_concentration` (`related_reviewer_id` = that reviewer; `bonus_period_id` = period). Constants:
  `0.80`, `MIN`.
- `detect_period_end_spike(p_org, p_period)` — per employee, `task_approved` point gains (via `point_ledger`
  joined to `tasks.approved_at` in the period); if the **last-3-days** gain > **K ×** the period daily average
  → flag `period_end_spike` (`bonus_period_id` = period). Constants: window = 3d, `K`.

**Schema change (additive, D5-safe):** `anti_gaming_flags` gains `bonus_period_id uuid` (**nullable, NO FK** —
FK-less like `related_task_id`; used only by the period-scoped idempotency key). **Two partial unique indexes**
per OQ-2. The `0016` validator / RLS / grants are **not** changed (INSERT stays server-only).

**D5 isolation preserved:** detect functions **read** `tasks` / `task_reviews` / `point_ledger` / `bonus_periods`
and **write only `anti_gaming_flags`** — no write path/FK/trigger to `point_ledger` / `bonus_ledger` /
`compensation_records` / `bonus_*` value tables. A confirmed flag still has **no** financial side effect.

**Out of 7-A (gated):** any write to `point_ledger`/`bonus_ledger`; dispute wiring; `organization_settings`
threshold columns; `self_approval_attempt` trail; app/UI/API. **Catalog stays 20** (scan is server/job — no
new permission).

### 5.2 Slice 7-B — dispute point adjustment (migration `0025`, was `0024`) — DONE (`70ba400`)

- Widen `point_ledger.event_type` CHECK (**DROP+ADD**) to add `'dispute_adjustment'` (append-only preserved —
  only widens the allowed set); widen the conditional-audit trigger WHEN clause to include it.
- `apply_dispute_point_adjustment(p_dispute_id, p_points_delta, p_reason, p_actor)` SECURITY DEFINER,
  server-only — requires the dispute `resolved` + `resolution='accepted'`; writes **one** `dispute_adjustment`
  `point_ledger` row (delta); **idempotent** per dispute; audited. rejected/other → no row.

### 5.3 Slice 7-C — dispute bonus recalculation + reversal (migration `0026`, was `0025`) — GATED

- `recalculate_bonus_after_dispute(p_dispute_id, …)` SECURITY DEFINER, server-only, **explicit HR/server call**
  (OQ-6):
  1. mark the affected period's completed run **`superseded`** (0013 machine);
  2. move the period **`approved → calculated`** (new transition added to `validate_bonus_period_transition`
     in this migration — re-approval required, per the locked decision);
  3. `run_bonus_calculation(…)` with a new idempotency key → **new run + new immutable snapshot** (old snapshot
     preserved — ADR-006);
  4. **paid-accrual guard (OQ-4):** if the old accrual is already paid → **raise** (clawback gated, D2);
  5. else `bonus_ledger` **reversal** (append; balanced) of the old accrual, then `post_bonus_accrual()` for the
     new (re-approved) snapshot.
- Reuses `run_bonus_calculation` (0021) + `post_bonus_accrual` (0022) unchanged; `bonus_ledger` `reversal`
  already writable (0014).

## 6. Dispute post-decision chain (with the D5 guardrail)

```txt
detect (7-A) → flag(open) → [HUMAN review] → confirmed | dismissed
      │ D5: a confirmed flag is NOT an automatic penalty and does NOT auto-create a dispute
      ├─ (a) HR/manager manual_adjustment (existing; reason + audit), OR
      └─ (b) employee opens a dispute (anomaly_false_positive / …)
                    │
   dispute resolved(accepted) → (7-B) apply_dispute_point_adjustment  (point_ledger dispute_adjustment)
                    │ (if a bonus period is affected)
                    └→ (7-C) recalculate_bonus_after_dispute → superseded old run + period approved→calculated
                             → new run/snapshot → paid-guard → bonus_ledger reversal + new accrual
```

**The flag→financial path is never automatic** (D5 / human-in-the-loop). 7-A only produces flags; 7-B/7-C only
run on a human-resolved (accepted) dispute via an explicit call.

## 7. What does NOT change (all slices)

- `anti_gaming_flags` table/RLS/validator (7-A only adds a nullable FK-less column + two partial unique
  indexes); `disputes`/`dispute_events` tables; scoring engine (0020); `run_bonus_calculation` (0021);
  `post_bonus_accrual` (0022); `point_ledger`/`bonus_ledger` append-only; snapshot immutability.
- No new permission (catalog 20). No `0001..0022` edits / existing-test edits. Local dev/staging only (ADR-014).

## 8. Decision Lock conformance

- **D5** (no auto-punish, human-in-loop): detection only flags; confirmed flag has no financial side effect and
  no auto-dispute; all effects are human-gated. ✅
- **D9** (dispute reviewer/assign): unchanged; post-decision runs after resolve. ✅
- **D2** (no automatic clawback): reducing a **paid** bonus is a clawback → **gated**; 7-C reverses only un-paid
  accrual and raises on paid (OQ-4). ✅
- **ADR-006/017**: recalculation = new run + new immutable snapshot (old preserved); correction = reversal
  (append). ✅
- **AD7**: new snapshot records its factors; scoring untouched. ✅

## 9. Migration + test titles

- `migrations/0023_anti_gaming_detection.sql` + `tests/0017_phase7a_anti_gaming_detection.test.sql` (7-A)
- `migrations/0025_dispute_point_adjustment.sql` + `tests/0019_phase7b_dispute_point_adjustment.test.sql` (7-B)
- `migrations/0026_dispute_bonus_recalculation.sql` + `tests/0020_phase7c_dispute_bonus_recalc.test.sql` (7-C)

## 10. Risks

- **7-C financial complexity** (reversal + new accrual + supersede + period re-approval): worked-example test
  mandatory (dispute → point increase → new run → reversal + new accrual; Σ reconciles).
- **False positives** (7-A): flags are human-reviewed; thresholds hardcoded (OQ-1) — calibration is V1.
- **Idempotency races** (7-A): `where not exists` + unique-index backstop; scan is single-writer (HR/job).
- **period re-approval loop** (7-C): the `approved→calculated` transition must not allow skipping re-approval
  before a re-accrual; the `post_bonus_accrual` approved-gate (0022) enforces it.

## 11. Acceptance (per slice)

- 7-A: `db reset` `0001..0023` + seed clean; new pgTAP green; each rule pos/neg; idempotency (re-scan adds no
  flags); **D5 no-side-effect** (point_ledger/bonus_ledger counts unchanged by a scan); flag INSERT server-only;
  catalog 20; `0001..0016` suites still green.
- 7-B / 7-C: analogous, with their own invariants (see §5.2/§5.3).

## Revision history

- **Rev 1 (creation, 2026-08-09):** initial Phase 7 plan with the user's locked OQ-1..OQ-7 + the period-status
  recalc decision. Planning only; 7-A authorized, 7-B/7-C gated.
