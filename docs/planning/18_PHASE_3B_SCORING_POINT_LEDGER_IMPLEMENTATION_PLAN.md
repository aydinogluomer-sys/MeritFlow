# 18 — Phase 3B Implementation Plan: Scoring Policy & Point Ledger Foundation

> **Status (updated 2026-07-24):** the slices proposed here — **3B-A (scoring policy foundation)**
> and **3B-B (point ledger foundation)** — have since been **implemented and runtime-verified**
> (see §1 for evidence). The remainder of this document is the original pre-implementation plan and
> still governs any not-yet-built detail. Decision Lock (D1–D12 + AD1–AD10) is binding; ADR-020
> (implementation gate) governs when any *further* work may be built.

---

## 1. Status and authorization

- **Mode:** Slices **3B-A** and **3B-B** are **implemented and runtime-verified** (status below).
  Remaining Phase 3B work (and everything downstream) stays planning-only until its own authorization.
- **Phase 3A baseline:** `40d957f — chore: establish verified Phase 3A baseline` on branch `main`.
- **Phase 3A verification result:** VERIFIED / DONE (2026-06-24, local dev stack). Evidence:
  `supabase db reset` applied migrations `0001..0007` + seed cleanly; `supabase test db` ran the
  blocking pgTAP suite **38/38 passed (0 failed)**. The only change during verification was the
  pgTAP `throws_ok` assertion form (3-arg → strict 4-arg) in
  `supabase/tests/0001_phase3a_rls.test.sql`; **no migration/seed/RLS/schema defect was found**.
- **Phase 3B implementation status:**
  - **3B-A — Scoring Policy foundation: VERIFIED/DONE** — `migrations/0008_scoring_policies.sql`,
    `tests/0002_phase3b_scoring_policies.test.sql` (commit `dd9b861`).
  - **3B-B — Point Ledger foundation: VERIFIED/DONE** — `migrations/0009_point_ledger.sql`,
    `tests/0003_phase3b_point_ledger.test.sql` (commit `f46ab49`).
  - **Verification (2026-07-24, local dev stack, npx Supabase CLI 2.109.1):** `supabase db reset`
    applied migrations `0001..0009` + seed cleanly; `supabase test db` → **Files=3, Tests=97,
    Result=PASS, Failed=0** (`0001` ok · `0002` ok · `0003` ok), reproduced across two clean runs
    (deterministic seed). A non-fatal storage-container readiness warning during `db reset` was
    **non-blocking** (no DB/migration/seed defect). Docs/status synced under
    `implementation authorized only for Phase 3B — Docs/status update after green verification`.
  - **Remaining work stays GATED.** Each further slice requires its own verbatim authorization in the
    form `implementation authorized only for Phase 3X — <slice name>` (ADR-020); phase- and
    slice-scoped. **compensation_records** (commit `c9cd0f2`), **bonus_periods + bonus_pools**
    (commit `d04b954` — migrations `0010`/`0011`, tests `0004`/`0005`), **bonus_pool_components +
    bonus_pool_eligibility** (commit `8f74e8d` — migration `0012`, test `0006`), and
    **bonus_calculation_runs + bonus_allocations + bonus_allocation_snapshots** (commit `e3bd1a3`,
    2026-07-25 — migration `0013`, test `0007`; run machine + AD10 locked-period+locked-pool guard;
    idempotency `unique(organization_id, idempotency_key)`; completed-run allocation freeze; thin snapshot
    append-only; approved/exported/paid blocked; db reset `0001..0013`, test db Files=7/Tests=299/PASS), and
    **bonus_ledger** (commit `71e68f7`, 2026-07-26 — migration `0014`, test `0008`; append-only double-entry;
    deferred `Σdebit=Σcredit` per (org, transaction_id) balance trigger; accrual ⇒ snapshot_id; idempotent
    accrual; only bonus_accrual+reversal writable; Finance/Auditor raw read only — HR/Employee/Manager/Support
    excluded; server-only; db reset `0001..0014`, test db Files=8/Tests=328/PASS), and **disputes +
    dispute_events** (commit `1bf63fe`, 2026-07-26 — migration `0015`, test `0009`; mutable state machine +
    post-open identity immutability; append-only auto-history trigger; D9 stored decision_owner_id +
    owns_review_decision + reviewer≠owner/complainant CHECK; HR-only assign via has_role('hr') — no
    dispute.assign permission added; due_at stored + sanity; Finance/Support excluded; db reset `0001..0015`,
    test db Files=9/Tests=388/PASS), and **anti_gaming_flags** (commit `0c813e9`, 2026-07-31 — migration `0016`,
    test `0010`; mutable review lifecycle open→reviewing→confirmed|dismissed; D5 no-auto-punish — isolated from
    all ledgers, no FK/write to point_ledger/bonus_ledger/bonus_*/compensation, confirm inert & test-proven;
    review consistency + reviewer≠subject; server-only INSERT; review via has_role('hr') OR
    manages_team(team_of(subject)) — no flag.review permission; no bonus_period_id; related_task_id FK-less;
    Finance/Support excluded; db reset `0001..0016`, test db Files=10/Tests=427/PASS) are
    now **VERIFIED/DONE** (see `supabase/README.md` / `IMPLEMENTATION.md`). Data dictionary `14` idempotency
    and markdownlint sync landed as commit `dae4c6b`; ADR-020 markdownlint as commit `53d90de`.
    **Next recommended DB slice:** notifications foundation (recipient_id/type/payload/status
    unread|read/read_at/link; RLS recipient-only; server-only INSERT; retention TTL V1) — the
    smallest/isolated, lowest-risk foundation step after disputes + anti-gaming (no financial/engine coupling).
    exports (payout export record; snapshot_id NOT NULL — AD6/SI-3; export-gate is engine work; RLS
    Finance/Auditor) is a more financial/risky surface and is deferred until after notifications — not authorized.

---

## 2. Purpose of Phase 3B

Phase 3 is the **security/finance foundation** (roadmap `12`, §Phase 3). Phase 3A delivered tenancy,
identity, RBAC, RLS helpers and append-only audit. Phase 3B adds the **next foundational layer
beneath any task/scoring/bonus feature**:

- **Scoring policy + versioning (`scoring_policies`, `scoring_policy_versions`)** establishes the
  **immutable, period-lockable policy snapshot** that AD7 requires *before* any scoring math runs.
  Tasks (Phase 4) reference `scoring_policy_version_id`; the scoring engine (Phase 5) reads locked
  multipliers from a published version. Building the policy-version substrate first means the engine
  has a stable, immutable, auditable contract to compute against — no policy drift, no silent factor
  changes (AD7, SI-4).
- **Point ledger (`point_ledger`)** establishes the **append-only, single-entry source of truth for
  points** (ADR-005, SI-1/SI-2). Points are derived from ledger rows, never a mutable total. The
  scoring engine's `approved → points` step (Phase 5) and manual/dispute adjustments all *write into*
  this ledger. Standing it up first — with append-only enforcement, RLS, and manager/employee
  visibility — means every later writer plugs into an already-proven, tamper-evident store.

Sequencing rationale: **policy-version immutability and ledger append-only integrity are structural
invariants** that are far cheaper to get right (and to test) in isolation than retrofitted under a
live task/scoring engine. Phase 3B builds the *containers and their guarantees*; Phases 4–6 build the
*producers* that fill them. This is the smallest slice that advances the foundation without pulling in
tasks, the scoring engine, or any money/bonus surface.

---

## 3. Explicit scope (Phase 3B — Scoring Policy & Point Ledger Foundation)

**Deliverables (proposed; new migrations/files only — `0008+`):**

1. **Table —** `scoring_policies` — logical scoring policy (1—* versions).
2. **Table —** `scoring_policy_versions` — immutable published policy snapshot (multipliers, thresholds, penalty rule).
3. **Table —** `point_ledger` — append-only, single-entry point ledger **without** `task_id` / `bonus_period_id` (see §5).
4. **Helper —** `team_of(employee_id) -> uuid` — primary-team resolver, **only** if needed for the manager point-ledger SELECT policy (see §7). Canonical source = `team_memberships.is_primary`.
5. **RLS / authorization —** RLS ENABLE + FORCE + policies + least-privilege grants for the three new tables (§6), reusing the 3A patterns (`current_org()`, `has_role()`, `has_permission()`, `has_support_grant()`, `prevent_mutation()`, `log_audit()`).
6. **Seed (dev/staging only) —** forward-compatible permission-catalog + role-mapping additions (notably `policy.manage` — see §5/§8), one scoring policy + one published version per test tenant, and a few deterministic `point_ledger` rows (manual adjustment + reversal) to exercise visibility and append-only tests.
7. **Tests —** a new blocking pgTAP suite for Phase 3B (§9), in the same strict style as the 3A suite.

Everything here is built as **new files** (`migrations/0008..`, a new test file, additive seed blocks).
**No edits to `0001..0007`, the existing seed beyond additive blocks, the existing test, config, or
`CLAUDE.md`** are part of this slice.

---

## 4. Explicit out-of-scope (still gated — do NOT build in Phase 3B)

Each of the following is explicitly **excluded** from Phase 3B and remains behind its own ADR-020 gate:

- `tasks`, `task_assignments`, `task_comments`, `task_attachments`, `task_events`, `task_reviews` — **any task table or task workflow**.
- **Scoring calculation engine** (the `final_points = base * complexity * impact * quality * timeliness * (1 - revision_penalty)` math, approve→ledger wiring, breakdown). Phase 3B stores the *policy* and the *ledger*, not the engine.
- `bonus_periods`, `bonus_pools`, `bonus_pool_components`, `bonus_pool_eligibility`, `bonus_calculation_runs`, `bonus_allocations`, `bonus_allocation_snapshots`, `bonus_ledger` — **all bonus/period/snapshot/money tables**.
- `compensation_records` — comp-sensitive data and cap source.
- `disputes`, `dispute_events`.
- `anti_gaming_flags` — anti-gaming rules.
- `notifications`.
- `exports` and any payout/export surface.
- **Finance aggregate/reporting views** (`v_finance_*`). Finance gets **no** point-ledger access in this phase (raw or view); aggregate views are a later slice/phase.
- **API routes / Server Actions / UI / dashboards** — none.
- **Production database** — never touched. Local dev/staging only.
- **Remote Supabase commands** — no `supabase link`, `db push`, `db pull`, or any remote/prod command; no Supabase MCP against production.

**Column-level gates (binding for this slice):**

- **Do NOT add `task_id` or `bonus_period_id` to `point_ledger`.** Those columns (and the
  `task_approved` idempotency index) are added only when the tasks/bonus phases exist. See §5 open
  questions OQ-3B-2 / OQ-3B-3.
- **Do NOT expose raw `point_ledger` to Finance by default.** Finance is excluded from the
  point_ledger SELECT policy entirely in 3B.
- **Do NOT add `memberships.primary_team_id`.** Primary team is resolved exclusively from
  `team_memberships.is_primary` (AD9; doc 13/14, ADR-019 note).

---

## 5. Proposed schema

> Conceptual intent (matches doc 14). Exact DDL is written only under slice authorization. Conventions
> follow 3A: `id uuid PK default gen_random_uuid()`, `organization_id uuid NOT NULL references
> organizations(id) on delete cascade`, `created_at timestamptz NOT NULL default now()`. Mutable rows
> get `updated_at` + `set_updated_at()` trigger; append-only rows get **no** `updated_at`.

### 5.1 `scoring_policies`

- **Columns:** `id`, `organization_id`, `name text`, `status text` (`draft|active|archived`),
  `description text` (nullable), `created_by uuid`, `created_at`, `updated_at`.
- **Foreign keys:** `organization_id → organizations(id)` (cascade); `created_by → profiles(id)`.
- **Constraints:** `unique (organization_id, name)`; `check (status in ('draft','active','archived'))`;
  **`unique (id, organization_id)`** — redundant given the PK, but added so a **composite FK** from
  `scoring_policy_versions` can target `(id, organization_id)` and guarantee same-org integrity (§5.5
  decision 7).
- **Indexes:** `(organization_id)` lead; `(organization_id, status)`.
- **Immutability:** none (mutable header; status transitions allowed). `updated_at` via `set_updated_at()`.
- **Audit:** YES — `log_audit()` AFTER INSERT/UPDATE/DELETE (scoring policy change). Sensitivity: confidential.

### 5.2 `scoring_policy_versions`

- **Columns:** `id`, `organization_id`, `scoring_policy_id uuid`, `version_no int`,
  `status text` (`draft|published`), `multipliers jsonb` (complexity/impact/quality/timeliness tables),
  `revision_penalty_rule jsonb`, `timeliness_thresholds jsonb`, `notes text` (nullable),
  `published_at timestamptz` (nullable), `published_by uuid` (nullable), `created_by uuid`, `created_at`.
- **Foreign keys:** `organization_id → organizations(id)` (cascade);
  **composite `(scoring_policy_id, organization_id) → scoring_policies(id, organization_id)` (cascade)**
  — this *replaces* a plain `scoring_policy_id → scoring_policies(id)` FK and **structurally guarantees
  that a version's `organization_id` equals its parent policy's `organization_id`** (same-org integrity,
  §5.5 decision 7); `published_by → profiles(id)`; `created_by → profiles(id)`.
- **Constraints:** `unique (scoring_policy_id, version_no)`; `check (status in ('draft','published'))`;
  `check (status = 'published' implies published_at is not null and published_by is not null)`
  (expressed as `status <> 'published' or (published_at is not null and published_by is not null)`).
  **Same-org integrity is enforced by the composite FK above (§5.5 decision 7), not left to the
  application.**
- **Indexes:** `(scoring_policy_id, version_no)`; `(organization_id)`.
- **Immutability (AD7, SI-4, SI-14 family):** a **published version is immutable.** Enforced by a
  dedicated trigger `prevent_published_version_mutation()` (BEFORE UPDATE/DELETE): raise if
  `OLD.status = 'published'` (block both UPDATE and DELETE of a published row); **draft rows may be
  edited and the draft→published transition is allowed** (the trigger permits an UPDATE whose
  `OLD.status = 'draft'`). This is *conditional* immutability, so it does **not** reuse the blanket
  `prevent_mutation()` (which blocks all UPDATE/DELETE); it is a new SECURITY DEFINER trigger function
  in the same spirit. Sensitivity: confidential, audit-critical.
- **Audit:** YES — `log_audit()` (new version publish / change). Publish is the audited event.

### 5.3 `point_ledger` *(append-only, single-entry — ADR-005)*

- **Columns (Phase 3B subset):** `id`, `organization_id`, `employee_id uuid`,
  `event_type text`, `points_delta numeric`, `reason text`, `scoring_policy_version_id uuid` (nullable),
  `reverses_entry_id uuid` (nullable in general, **required when `event_type = 'reversal'`** — LOCKED,
  see §5.5), `metadata jsonb` (nullable; breakdown — base + each multiplier + base submission time,
  AD4-forward), `created_by uuid`, `created_at`.
  - **Deliberately absent (gated):** `task_id`, `bonus_period_id`. Added only with the tasks/bonus
    phases (OQ-3B-2/3). No `updated_at` (append-only).
- **Foreign keys:** `organization_id → organizations(id)` (cascade); `employee_id → profiles(id)`;
  `created_by → profiles(id)`; `scoring_policy_version_id → scoring_policy_versions(id)` (nullable —
  allowed because the table exists in this slice); `reverses_entry_id → point_ledger(id)` (self-FK,
  nullable).
- **Constraints:**
  - **`check (event_type in ('manual_adjustment','reversal'))` — MINIMAL Phase 3B vocabulary (LOCKED,
    see §5.5).** Only the two events that have a producer in this slice are permitted. Every other
    event type is **rejected** until the phase that produces it widens the CHECK:
    `task_approved` → Phase 5 / scoring engine; `dispute_adjustment` → dispute phase;
    `anomaly_hold` / `anomaly_released` → anti-gaming phase; `period_locked` → bonus/period-locking
    phase. Widening the CHECK is each of those phases' job, not 3B's.
  - **No `(task_id, event_type)` idempotency unique index in 3B** — `task_id` does not exist yet. The
    `task_approved` idempotency constraint (INV-1) is added together with `task_id` in the
    tasks/scoring phase. Documented as a deliberate deferral, not an omission.
  - **`check (event_type <> 'reversal' or reverses_entry_id is not null)`** — a `reversal` row must
    reference the entry it reverses (LOCKED, §5.5).
- **Indexes:** `(organization_id, employee_id)`; `(employee_id, created_at)`. The
  `(organization_id, employee_id, bonus_period_id)` composite index from doc 14 is deferred until
  `bonus_period_id` exists.
- **Immutability (SI-2):** append-only. Trigger `trg_point_ledger_append_only BEFORE UPDATE OR DELETE
  ... EXECUTE FUNCTION prevent_mutation()` (reuses the existing 3A function). **No UPDATE/DELETE
  policy and no UPDATE/DELETE privilege** at the grant layer. Correction = reversal/adjustment row.
- **Audit:** conditional — audit only the human/correction events producible in 3B. A trigger
  `AFTER INSERT ON point_ledger FOR EACH ROW WHEN (new.event_type in ('manual_adjustment','reversal'))
  EXECUTE FUNCTION log_audit()`. (`log_audit()` already resolves `organization_id` from NEW and writes
  an append-only audit row.) The WHEN clause is widened to include `dispute_adjustment` **only in the
  future dispute phase** that produces it — it is **not** part of the Phase 3B trigger. Sensitivity:
  audit-critical, financial-critical.

### 5.4 Open questions (schema)

- **OQ-3B-1 — RESOLVED / LOCKED (`policy.manage` permission).** See §5.5 decision 1.
- **OQ-3B-2 (`task_id` deferral):** confirmed deferred — adding it now would be a fake/orphan column
  (no `tasks` table). Added with Phase 4. **Recommendation:** defer (binding per §4).
- **OQ-3B-3 — RESOLVED / LOCKED (`event_type` vocabulary):** minimal CHECK
  (`manual_adjustment`, `reversal`) — see §5.5 decision 4. (The earlier forward-compatible-wide
  recommendation is **superseded**: a tenant ledger must not advertise event types it has no producer
  for; each later phase widens the CHECK when it adds a producer.)
- **OQ-3B-4 — RESOLVED / LOCKED (`reverses_entry_id` self-FK):** included; required when
  `event_type = 'reversal'` — see §5.5 decision 5.
- **OQ-3B-5 (`created_by` for system events):** for 3B's `manual_adjustment` / `reversal`,
  `created_by` is the acting HR/manager profile (the server writes it under service_role after authz).
  **Recommendation:** `created_by` NOT NULL = acting profile; revisit a dedicated system-actor profile
  if/when a non-user writer appears (V1). *(`task_approved` system-origin attribution is a Phase 5
  concern — no such row exists in 3B.)*

### 5.5 Locked decisions (this revision)

These were open questions/recommendations and are now **locked** for Phase 3B implementation:

1. **`policy.manage` permission — LOCKED.** It **must be added** (domain `scoring`).
   **Granted to:** `owner`, `admin`, `hr`. **Not granted to:** `manager`, `finance`, `employee`,
   `auditor`. It governs creating a scoring policy, drafting a version, and publishing it. *(Catalog
   rows currently live in the dev/staging seed; production catalog provisioning is a separate,
   pre-existing bootstrap concern, flagged but out-of-scope here.)*
2. **`point_ledger` writes are server-only in Phase 3B — LOCKED.** No `authenticated` INSERT policy;
   no client-side direct ledger minting. All writes occur via `service_role` from trusted server
   context. `point.override` remains an **app/server authorization check** for future manual-adjustment
   flows (it is *not* an RLS INSERT policy in 3B). See §6.3.
3. **No tenant-scoped table without RLS in the same slice — LOCKED.** See §11.
4. **`point_ledger.event_type` — LOCKED minimal CHECK:** `manual_adjustment`, `reversal` only. Future
   event types are added by the phase that introduces their producer (`task_approved` → Phase 5;
   `dispute_adjustment` → dispute phase; `anomaly_hold`/`anomaly_released` → anti-gaming phase;
   `period_locked` → bonus/period-locking phase).
5. **`reverses_entry_id` — LOCKED:** included in Phase 3B; nullable in general; **required when
   `event_type = 'reversal'`**; references `point_ledger(id)`. Improves auditability without breaking
   append-only integrity (it is a column on a new insert, never a mutation of the referenced row).
6. **Support read of `point_ledger` — LOCKED:** an active support grant may read `point_ledger` **only
   within the granted organization scope**; expired / no grant must not read. Covered by pgTAP
   (§6.4, §9).
7. **`scoring_policy_versions` same-org integrity — LOCKED:**
   `scoring_policy_versions.organization_id` **must match** its parent
   `scoring_policies.organization_id`. **Preferred strategy (for slice 3B-A):** add a composite unique
   constraint `unique (id, organization_id)` on `scoring_policies` (§5.1) and a **composite FK**
   `scoring_policy_versions (scoring_policy_id, organization_id) → scoring_policies (id, organization_id)`
   (§5.2) so a cross-org pairing is structurally impossible (rejected by the FK, not merely the app).
   **Must be proven by pgTAP** (§9 #24): inserting a version whose `organization_id` differs from its
   parent policy's is rejected. *Document only — not implemented now; built in slice 3B-A.*

---

## 6. RLS and authorization design

> Reuses 3A principles verbatim: every tenant table RLS **ENABLED + FORCE**; every policy anchored on
> `organization_id = public.current_org()` (cross-tenant blocked, SI-6/SI-7); `authenticated` is
> **never** granted DELETE; `service_role` (bypassrls) is the trusted server writer; helpers are
> SECURITY DEFINER + fixed `search_path` (AD1, §7A). Auditor is read-only everywhere. Support reads
> only via `has_support_grant(org)`.

### 6.1 `scoring_policies`

- **Grants:** `revoke all from anon, authenticated`; `grant select, insert, update to authenticated`;
  `grant all to service_role`. (No DELETE.)
- **SELECT:** `organization_id = current_org() or has_support_grant(organization_id)` — whole org may
  read its policies.
- **INSERT:** `with check (organization_id = current_org() and has_permission('policy.manage'))`.
- **UPDATE:** `using/with check (organization_id = current_org() and has_permission('policy.manage'))`.
- **DELETE:** none (no policy, no privilege).
- **Who writes:** Owner / Admin / HR — the `policy.manage` holders (LOCKED, §5.5 decision 1).
  **Forbidden:** Manager, Finance, Employee, Auditor writes; cross-tenant.

### 6.2 `scoring_policy_versions`

- **Grants:** same shape as 6.1 (`select, insert, update` to `authenticated`; no DELETE).
- **SELECT:** `organization_id = current_org() or has_support_grant(organization_id)` (org read).
- **INSERT:** `with check (organization_id = current_org() and has_permission('policy.manage'))`.
- **UPDATE:** `using/with check (organization_id = current_org() and has_permission('policy.manage'))`
  — **plus** the `prevent_published_version_mutation()` trigger, which blocks the UPDATE if the row is
  already `published` (defense-in-depth: RLS gates *who*, the trigger gates *immutability of published*).
- **DELETE:** none (trigger also blocks DELETE of published; drafts are not client-deletable — no
  DELETE privilege at all).
- **`policy.manage` semantics:** the single permission governs creating a policy, drafting a version,
  and publishing it (the draft→published UPDATE). Publishing is the audited, immutability-freezing
  action.

### 6.3 `point_ledger`

- **Grants:** `revoke all from anon, authenticated`; **`grant select to authenticated`** (read only);
  `grant all to service_role`. **No INSERT/UPDATE/DELETE privilege to `authenticated`** in 3B — see
  the insertion decision below.
- **SELECT:** anchored on `organization_id = current_org()` AND one of:
  - `employee_id = auth.uid()` (own rows), OR
  - `manages_team(team_of(employee_id))` (manager of the employee's **primary** team), OR
  - `has_role('hr')` / `has_role('owner')` / `has_role('admin')` / `has_role('auditor')`, OR
  - `has_support_grant(organization_id)` (support read).
  - **Finance is intentionally excluded** — no Finance branch. Finance never reads raw point_ledger in
    3B (SI-12; aggregate `v_finance_*` views are a later phase).
- **INSERT / UPDATE / DELETE:** **no client policy and no privilege.** All writes occur via
  `service_role` (bypassrls) from trusted server context, with app-layer authz (e.g. `point.override`
  for `manual_adjustment`) verified before the write (ADR-012). UPDATE/DELETE additionally blocked by
  the append-only trigger (SI-2).

#### Point-ledger insertion model — DECISION (LOCKED, §5.5 decision 2)

**`point_ledger` writes are server-only in Phase 3B.** Specifically:

- **No `authenticated` INSERT policy** and no INSERT privilege to `authenticated`.
- **No client-side direct ledger minting** — points can never be inserted from a client session.
- Every ledger write is performed by **`service_role`** (bypassrls) from trusted server context, after
  the server verifies authorization. This mirrors the 3A precedent where `audit_logs` has **no** client
  INSERT (writes only via SECURITY DEFINER triggers / service_role) and keeps the append-only ledger to
  a single, trusted writer.
- **`point.override` remains an app/server authorization check** for future manual-adjustment flows —
  it is *not* an RLS INSERT policy in 3B. doc 15's "manual_adjustment WITH CHECK `point.override`" is
  satisfied at the application layer now (and re-asserted there even though service_role bypasses RLS,
  per ADR-012). A client manual-adjustment INSERT policy may be reconsidered later **alongside** the
  manual-adjustment feature/UI, when there is a producer and a test for it — not in this foundation slice.

*Rationale:* there is no app/API layer in 3B to exercise a client write path; the ledger is
financial-critical; server-only is the smallest, safest surface and matches `audit_logs`.

### 6.4 Cross-cutting

- **RLS ENABLED + FORCE** on all three new tables (SI-6).
- **Auditor:** read-only (covered by SELECT branches; no write policy anywhere).
- **Support (LOCKED, §5.5 decision 6):** an **active** support grant may read `point_ledger` (and the
  scoring tables) **only within the granted organization scope** — the `has_support_grant(organization_id)`
  branch is org-anchored, so it can never cross tenants. An **expired or absent** grant must not read
  (default no access, D4). This resolves doc-15 OQ-RLS-5 for these tables (point_ledger is in the
  support read set; every support access remains audited) and **must be covered by pgTAP** (§9 #14).
- **Service role never reaches the client** (env-only; ADR-012/014; SI-11).

---

## 7. Helper function design — `team_of(employee_id)`

**Needed?** Yes — only for the `point_ledger` manager SELECT branch
(`manages_team(team_of(employee_id))`). No other 3B table needs it. If the manager visibility branch
were dropped, `team_of` would not be required; but manager-of-primary-team point visibility is in
doc 15 and is worth establishing now.

- **Signature / return type:** `public.team_of(p_employee uuid) returns uuid` — the employee's
  **primary** team id within `current_org()`, or `null` if none.
- **SECURITY DEFINER:** **yes** — must read `team_memberships` rows for *other* employees without
  tripping `team_memberships` RLS, exactly like the 3A `shares_org()` / `manages_team()` helpers.
- **`search_path`:** fixed empty (`set search_path = ''`), fully-qualified table names.
- **Volatility:** `stable`.
- **Body (intent):**

  ```sql
  select tm.team_id
  from public.team_memberships tm
  where tm.profile_id = p_employee
    and tm.organization_id = public.current_org()
    and tm.is_primary = true
  limit 1;
  ```

- **Canonical source:** resolves primary team **only** from `team_memberships.is_primary` (AD9). It
  does **not** read any `memberships.primary_team_id` (which does not and must not exist).
- **Recursion risk:** none. As a SECURITY DEFINER function owned by the bypassrls migration role, its
  internal read of `team_memberships` does not re-enter RLS (same guarantee as 3A helpers, §7A). The
  `point_ledger` SELECT policy calling `team_of()` → `manages_team()` (both definer) does not recurse
  into `point_ledger`.
- **Tenant safety:** anchored on `current_org()` so it cannot resolve a primary team across tenants.
- **Grants:** `revoke execute from public, anon`; `grant execute to authenticated, service_role`
  (identical to the 3A helper grant block).
- **Required tests:** returns the correct primary team for an employee with one; returns `null` for an
  employee with no primary team; does not resolve across tenants (Org A caller → Org B employee yields
  `null`/no leak); manager SELECT on point_ledger composes correctly (manager sees own-team employee
  rows, not other-team).

---

## 8. Seed design (local / dev / staging only — never production)

Additive blocks appended to the existing deterministic test-tenant seed (no rewrite of 3A rows;
on-conflict guards keep `supabase db reset` re-runnable). All UUIDs deterministic.

- **Permission catalog + mapping (OQ-3B-1):** add `('policy.manage','Manage scoring policy','scoring',
  false)` to `permissions`; add `role_permissions` rows `('hr','policy.manage')`,
  `('admin','policy.manage')`, `('owner','policy.manage')`. (`point.override` already exists for
  manual adjustments.)
- **Scoring policy + version per tenant:** one `scoring_policies` row (status `active`) for Org A and
  Org B; one **published** `scoring_policy_versions` row each (`version_no = 1`, deterministic
  `multipliers`/`thresholds`/`revision_penalty_rule` JSON) to test published immutability and
  cross-tenant isolation. Optionally one `draft` version for Org A to test the draft-editable path.
- **Point ledger rows (Org A):** a `manual_adjustment` row for `emp-alpha` (created_by HR or
  Manager Alpha holding `point.override`) and a `reversal` row referencing it (`reverses_entry_id`),
  plus a row for `emp-beta`. These exercise: employee-sees-own, manager-sees-own-team (Manager Alpha
  sees emp-alpha via `team_of`), Finance-blocked, append-only, and cross-tenant (Org B sees none).
- **No production seed. No `compensation_records`, no bonus/task rows.**

---

## 9. pgTAP test plan (blocking — Phase 3B is not "done" until green)

New strict suite (e.g. `supabase/tests/0002_phase3b_scoring_ledger.test.sql`), same conventions as the
3A suite: `set local role authenticated` + `set_config('request.jwt.claims', ...)` per actor;
`throws_ok(sql, errcode, errmsg, description)` strict 4-arg form for negatives. **Blocking** tests:

1. **Structural / RLS-enabled —** RLS is ENABLED **and** FORCE on `scoring_policies`, `scoring_policy_versions`, `point_ledger`.
2. `authenticated` has no DELETE privilege on any of the three (and no INSERT on `point_ledger`).

**Cross-tenant (SI-7) — blocking**
3. Org A actor cannot SELECT Org B `scoring_policies` / `scoring_policy_versions` / `point_ledger` (0 rows).

**Scoring policy authorization**
4. Employee INSERT into `scoring_policies` is denied (no `policy.manage`).
5. HR/Admin INSERT into `scoring_policies` succeeds.
6. Manager/Finance cannot write `scoring_policies` (no `policy.manage`).

**Published-version immutability (AD7 / SI-4) — blocking**
7. UPDATE of a `published` `scoring_policy_versions` row is blocked (trigger raises; strict errcode/msg).
8. DELETE of a `published` version is blocked.
9. A `draft` version *can* be updated and transitioned `draft → published` by a `policy.manage` holder.

**Point-ledger visibility**
10. Employee sees only **own** `point_ledger` rows (`employee_id = auth.uid()`), not another employee's — blocking (privacy).
11. Manager sees own-team employees' rows via `manages_team(team_of(...))`; not other-team employees' rows.
12. HR sees org rows; Auditor sees org rows (read-only).
13. **Finance cannot SELECT `point_ledger`** (no policy branch) — blocking (SI-12).
14. **Support read (LOCKED, §5.5 decision 6) — blocking:** an active support grant reads `point_ledger`
    **only within the granted org**; an expired grant and a no-grant actor read nothing; a grant for
    Org A never exposes Org B rows (org-scoped).

**Point-ledger append-only (SI-2) — blocking**
15. UPDATE on `point_ledger` is blocked (`prevent_mutation`, errcode `23001`, strict message).
16. DELETE on `point_ledger` is blocked (errcode `23001`).
17. `authenticated` cannot INSERT into `point_ledger` (server-only; privilege denied) — negative test.

**Helper correctness**
18. `team_of(emp-alpha)` returns Team Alpha; `team_of` for an employee with no primary team returns null; no cross-tenant resolution.

**Audit coverage**
19. A `manual_adjustment` INSERT and a `reversal` INSERT each produce an `audit_logs` row (both are in
    the conditional-audit WHEN clause), verified via service_role inserts. *(Phase 3B tests use only
    `manual_adjustment` and `reversal`. `task_approved` belongs to the future scoring engine/task phase
    and must not appear in Phase 3B tests — there is no producer and no Phase 3B audit semantics for it.)*

**Constraints (negatives)**
20. Duplicate `scoring_policies (organization_id, name)` rejected (`23505`, strict).
21. Duplicate `scoring_policy_versions (scoring_policy_id, version_no)` rejected (`23505`, strict).
22. `point_ledger` rejects a disallowed `event_type` — use a **generic invalid value**
    `'invalid_event_type'` (never `task_approved`/`dispute_adjustment`/other future events, to keep
    Phase 3B tests free of later-phase leakage) — minimal CHECK violation (`23514`, strict), proving
    the ledger advertises no event type without a producer.
23. A `point_ledger` row with `event_type = 'reversal'` and `reverses_entry_id IS NULL` is rejected
    (CHECK `23514`, strict).
24. **Same-org integrity (§5.5 decision 7) — blocking:** inserting a `scoring_policy_versions` row whose
    `organization_id` differs from its parent `scoring_policies.organization_id` is rejected by the
    composite FK (`23503` foreign_key_violation, strict), proving a version cannot belong to a different
    tenant than its policy.

Acceptance: full suite green (`0` failed) under `supabase test db`; reproducible after
`supabase db reset` (deterministic seed). Tests must stay **strict** (exact errcode + message), not
generic pass/fail.

---

## 10. Risk analysis

| Risk | Phase 3B mitigation |
| --- | --- |
| **Ledger append-only integrity** (SI-2) | Reuse proven `prevent_mutation()` trigger; no UPDATE/DELETE policy; no UPDATE/DELETE privilege; correction = reversal row. Tested (#15/#16). |
| **RLS recursion** (§7A) | `team_of` is SECURITY DEFINER + fixed search_path, owned by bypassrls role → no re-entry into `team_memberships`/`point_ledger` RLS. Policies compose definer helpers only. Mirrors 3A. |
| **Cross-tenant isolation** (SI-7) | Every policy anchored on `organization_id = current_org()`; `team_of` anchored on `current_org()`. Blocking cross-tenant tests (#3, #18). |
| **Policy-version immutability** (AD7/SI-4/SI-14) | Dedicated `prevent_published_version_mutation()` trigger blocks UPDATE/DELETE of published rows while allowing draft edits + draft→published. Tested (#7/#8/#9). |
| **Auditability** (D-scoring, AD3-forward) | Conditional `log_audit()` on `point_ledger` for the Phase 3B human/correction events (`manual_adjustment`, `reversal` only) — avoids over-auditing future high-volume system rows; `log_audit()` on both scoring tables. (`dispute_adjustment` is added to the WHEN clause only by the future dispute phase.) Tested (#19). |
| **Future task/bonus linkage** | `task_id`/`bonus_period_id` and the `task_approved` idempotency index deliberately deferred; added later via nullable `ALTER ADD COLUMN` + new index — append-only-safe (no row rewrite). `event_type` CHECK is **minimal** in 3B (LOCKED §5.5 decision 4); each later phase widens it when it adds a producer — no event type is advertised without a producer. |
| **`policy.manage`** (LOCKED §5.5 decision 1) | Added to catalog/seed and granted to owner/admin/hr only; without it, scoring-policy writes have no authorizing permission. Built **with RLS in the same slice** (§11). |
| **Rollback safety** | All changes are **new** migrations (`0008+`) + a new test file + additive seed blocks; `0001..0007` untouched. In dev, rollback = drop new objects / `supabase db reset` to the prior state. Migrations are forward-only in normal flow; no destructive change to existing objects. |
| **Finance over-exposure** (SI-12) | Finance excluded from `point_ledger` SELECT entirely; no `v_finance_*` view in 3B. Tested (#13). |
| **Service-role leakage** (SI-11) | No change to the env-only service_role posture; `point_ledger` writes are server-only with no client INSERT path (LOCKED §5.5 decision 2). |
| **Tenant table without RLS** | LOCKED §5.5 decision 3 / §11: no new tenant-scoped table is merged without RLS ENABLE+FORCE, grants, policies, and blocking pgTAP in the **same** slice. |

---

## 11. Proposed implementation slices (each requires its own ADR-020 authorization)

> **Security rule — LOCKED (§5.5 decision 3):** **No new tenant-scoped table may be merged without RLS
> ENABLE + FORCE, grants, policies, and blocking pgTAP coverage in the same slice.** There is no
> "tables now, RLS later" slice. A standalone deferred-RLS slice is **not permitted** in this repo —
> a tenant table existing without its RLS, even briefly between merges, is a tenant-isolation defect.

Build order respects FK/trigger dependencies; each slice ships **table + RLS + minimal blocking
tests together** and ends green before the next is authorized.

- **3B-A — Scoring Policy tables + RLS + minimal tests.**
  `scoring_policies` + `scoring_policy_versions` (with `set_updated_at` on the mutable header and the
  `prevent_published_version_mutation()` trigger), **plus** RLS ENABLE+FORCE, least-privilege grants,
  and policies per §6.1/§6.2 (writes gated on `policy.manage`), **plus** the `policy.manage` permission
  catalog/role-mapping seed addition (§5.5 decision 1), **plus** the minimal blocking pgTAP for these
  tables (RLS on/force, cross-tenant, `policy.manage` write-gating, published-version immutability —
  §9 #1/#3–#9/#20/#21). Suggested files: `migrations/0008_scoring_policies.sql` (table + trigger + RLS)
  and the scoring-policy portion of the new test suite. No ledger here.
- **3B-B — Point Ledger table + append-only + `team_of` helper + RLS + minimal tests.**
  `point_ledger` (3B column subset; minimal `event_type` CHECK; `reverses_entry_id` required for
  `reversal`) + `trg_point_ledger_append_only` (reusing `prevent_mutation()`) + conditional
  `log_audit()` trigger; the `team_of()` SECURITY DEFINER helper (§7); **and in the same slice** RLS
  ENABLE+FORCE, grants (SELECT-only to `authenticated`; **no** INSERT — server-only, §5.5 decision 2),
  the §6.3 SELECT policy (employee-own / manager-via-`team_of` / HR·Owner·Admin·Auditor / support;
  **Finance excluded**), **plus** minimal blocking pgTAP (append-only #15–#17, visibility #10–#14,
  helper #18, audit #19, CHECK negatives #22/#23). Suggested files:
  `migrations/0009_point_ledger.sql` (table + triggers), `migrations/0010_point_ledger_rls.sql`
  (`team_of` + RLS/policies), and the ledger portion of the test suite. No `task_id`/`bonus_period_id`.
- **3B-C — Seed expansion + full pgTAP hardening (if not already covered).** Round out the deterministic
  dev/staging seed (§8: scoring policy + published/draft versions, the manual_adjustment + reversal
  ledger rows) and add any cross-cutting/edge tests not already shipped inside 3B-A/3B-B, so the §9
  suite is complete and green end-to-end. (Per the security rule, 3B-A/3B-B each already ship their own
  minimal blocking tests; this slice closes remaining gaps and hardens.)
- **3B-D — Docs / status update after green verification.** Only after `db reset` + `test db` are green:
  update roadmap `12` (Phase 3B status), this plan's status block, and `supabase/README.md`
  (scope/verification). *This doc-update slice is itself out of the present authorization and is
  explicitly listed so status is flipped only on evidence — never pre-emptively.*

---

## 12. Acceptance criteria

**Before implementation may start:**

- This plan reviewed/accepted; the §5.5 locked decisions stand (`policy.manage` → owner/admin/hr;
  server-only ledger writes; minimal `event_type`; `reverses_entry_id`; RLS-in-same-slice; support
  read scope). OQ-3B-2 (`task_id` defer) and OQ-3B-5 (`created_by`) remain as documented.
- Verbatim, slice-scoped authorization given (`implementation authorized only for Phase 3B — <slice>`),
  e.g. `... — Scoring Policy tables + RLS + minimal tests` for 3B-A.
- Before-coding checklist (CLAUDE.md): relevant planning docs (13/14/15/16) + ADRs (005/006/012/015/
  017/018/020) read; Decision Lock conflicts checked; RLS + audit + ledger impact considered; test
  scenarios listed.

**Before Phase 3B is marked verified/done:**

- `supabase db reset` applies `0008+` + additive seed cleanly on the local stack.
- `supabase test db` runs the new blocking suite **green (0 failed)**, reproducibly after reset.
- RLS ENABLED + FORCE on all three new tables; cross-tenant blocking tests pass (SI-7).
- `point_ledger` append-only proven (UPDATE/DELETE blocked); no client INSERT path (server-only — §5.5
  decision 2); minimal `event_type` CHECK proven (disallowed types rejected).
- Published `scoring_policy_versions` immutability proven; draft path works (AD7).
- Employee-sees-own and Finance-blocked point-ledger tests pass (privacy, SI-12); support read is
  org-scoped (active grant only).
- Each new tenant-scoped table shipped **with** RLS ENABLE+FORCE + policies + blocking pgTAP in the
  same slice (§5.5 decision 3 / §11).
- Manual-adjustment + reversal audit rows produced.
- No edits to `0001..0007`, the existing test, config, or `CLAUDE.md`; primary team still resolved
  only via `team_memberships.is_primary`.
- Decision Lock (D + AD) not violated; docs updated (slice 3B-D) **on evidence**.

---

## 13. Future Claude Code prompts (DRAFT — **NOT AUTHORIZED YET**)

> These are drafts for review only. They are **not** authorizations. Building requires the user to
> issue the verbatim sentence; until then Phase 3B remains gated (ADR-020).
>
> **Note:** there is intentionally **no "tables now, RLS later" prompt.** Each slice ships its table(s)
> *with* RLS ENABLE+FORCE, grants, policies, and blocking pgTAP in the same authorization (§5.5
> decision 3 / §11).

### 13.A — DRAFT prompt for slice 3B-A (NOT AUTHORIZED YET)

```text
implementation authorized only for Phase 3B — Scoring Policy tables + RLS + minimal tests

Scope (all in this one slice):
- migrations/0008_scoring_policies.sql: scoring_policies + scoring_policy_versions per
  docs/planning/18 §5.1/§5.2; prevent_published_version_mutation() trigger (block
  UPDATE/DELETE of published versions; allow draft edits and draft→published);
  set_updated_at() on scoring_policies; log_audit() triggers on both tables.
  SAME-ORG INTEGRITY (§5.5 decision 7): scoring_policies has unique (id, organization_id);
  scoring_policy_versions uses a COMPOSITE FK (scoring_policy_id, organization_id) →
  scoring_policies (id, organization_id) so a version cannot belong to a different tenant
  than its policy.
- SAME slice: RLS ENABLE + FORCE + least-privilege grants + policies for BOTH tables per
  §6.1/§6.2 (writes gated on policy.manage).
- SAME slice: add the policy.manage permission + role mapping to owner/admin/hr ONLY
  (seed/catalog, §5.5 decision 1).
- SAME slice: minimal blocking pgTAP for these tables (RLS on+force, cross-tenant,
  policy.manage write-gating incl. manager/finance/employee denied, published-version
  immutability incl. draft→published allowed, unique negatives, and same-org composite-FK
  mismatch rejected per §9 #24) per §9.
Do NOT: defer RLS to a later slice; create point_ledger or team_of; touch tasks/bonus/comp;
  edit 0001..0007, the existing test, config, CLAUDE.md, roadmap, ADRs; run any remote/prod
  command. Phase 3B-B+ remains gated.
Report: files created; immutability trigger; RLS+policies in-slice; policy.manage granted to
  owner/admin/hr only; tests green; forbidden files changed (no); Phase 3B-B still gated (yes).
```

### 13.B — DRAFT prompt for slice 3B-B (NOT AUTHORIZED YET)

```text
implementation authorized only for Phase 3B — Point Ledger table + append-only + team_of + RLS + minimal tests

Scope (all in this one slice):
- migrations/0009_point_ledger.sql: point_ledger with the Phase 3B column subset per
  docs/planning/18 §5.3 — NO task_id, NO bonus_period_id; nullable scoring_policy_version_id;
  reverses_entry_id (nullable, REQUIRED when event_type='reversal'); MINIMAL event_type CHECK
  ('manual_adjustment','reversal') per §5.5 decision 4; trg_point_ledger_append_only reusing
  public.prevent_mutation(); conditional log_audit() AFTER INSERT WHEN event_type in
  ('manual_adjustment','reversal') ONLY (no dispute_adjustment — that is a future dispute phase).
- SAME slice: team_of(employee_id) SECURITY DEFINER helper (fixed search_path; resolves
  primary team only from team_memberships.is_primary) per §7.
- SAME slice: RLS ENABLE + FORCE; grant SELECT only to authenticated (NO INSERT/UPDATE/DELETE
  — server-only, §5.5 decision 2); SELECT policy per §6.3 (employee-own / manager via
  team_of / HR·Owner·Admin·Auditor / active support grant; FINANCE EXCLUDED).
- SAME slice: minimal blocking pgTAP per §9 — append-only UPDATE/DELETE blocked, no
  authenticated INSERT, employee-sees-own, manager-via-team_of, Finance-blocked, support
  org-scoped (active vs expired), team_of correctness, audit on manual_adjustment+reversal,
  minimal event_type CHECK negative, reversal-without-reverses_entry_id negative.
Do NOT: add task_id/bonus_period_id or any task_approved idempotency index (no producer yet);
  add an authenticated INSERT policy / client mint path; expose point_ledger to Finance; defer
  RLS; touch tasks/bonus/comp; edit 0001..0008, the existing test, config, CLAUDE.md, roadmap,
  ADRs; run any remote/prod command. Remaining slices gated.
Report: files created; append-only + audit triggers; team_of; RLS+policies in-slice
  (server-only, Finance excluded); tests green; columns deliberately absent; forbidden files
  changed (no); remaining Phase 3B slices still gated (yes).
```

---

## Revision history

- **Rev 1 (creation):** initial Phase 3B plan (scoring policy + point ledger foundation), planning only.
- **Rev 2 (security-safe revision — this version):** after Codex review of the slicing. Changes:
  (1) **slicing reworked** so every new tenant-scoped table ships **with** RLS ENABLE+FORCE, grants,
  policies, and blocking pgTAP in the **same** slice — removed the "tables now, RLS later" 3B-C; new
  order 3B-A (scoring policy + RLS + tests) / 3B-B (point ledger + append-only + `team_of` + RLS +
  tests) / 3B-C (seed + pgTAP hardening) / 3B-D (docs on green); (2) **`policy.manage` locked** →
  granted to owner/admin/hr only (not manager/finance/employee/auditor); (3) **point_ledger writes
  locked server-only** (no authenticated INSERT policy; no client mint; `point.override` is an
  app/server check); (4) **`event_type` minimalized** to `manual_adjustment`/`reversal` (other events
  added by their producing phase); (5) **`reverses_entry_id` locked** (required when
  `event_type='reversal'`); (6) **removed the `task_approved` test** (no producer in 3B); (7) **support
  read locked** to active, org-scoped grants (pgTAP-covered); (8) **future prompts rewritten** to bundle
  table+RLS+tests, still marked NOT AUTHORIZED YET. See §5.5 for the locked decisions.
- **Rev 3 (pre-commit cleanup — this version):** after a second Codex review. Changes:
  (1) **removed stale `dispute_adjustment`** from the Phase 3B audit-trigger text, risk table, and the
  3B-B prompt — its only remaining mentions are explicit "future dispute phase" deferrals (audit WHEN
  clause is `manual_adjustment`/`reversal` only); (2) **removed `task_approved` from Phase 3B tests** —
  test #22 now uses the generic `invalid_event_type` and the doc states `task_approved` belongs to the
  future scoring engine/task phase and must not appear in Phase 3B tests; (3) **locked same-org
  integrity for `scoring_policy_versions`** (§5.5 decision 7) via a composite FK
  `(scoring_policy_id, organization_id) → scoring_policies (id, organization_id)` backed by a new
  `unique (id, organization_id)` on the parent, plus blocking pgTAP #24; (4) reverted an unintended
  lint-only formatting change to `docs/adr/ADR-006-...md` (working tree now shows only this doc).
- **Rev 4 (post-verification docs sync — 2026-07-24):** slices 3B-A and 3B-B were implemented under
  their own authorizations (commits `dd9b861`, `f46ab49`) and **runtime-verified** (`db reset`
  `0001..0009` + seed; `test db` Files=3 / Tests=97 / PASS / Failed=0). This revision updates §1 status
  and the top banner to reflect verified/done, under `implementation authorized only for Phase 3B —
  Docs/status update after green verification`. Migrations/tests/seed unchanged.
- **Phase 3B (scoring policy + point ledger foundation) status:** **VERIFIED/DONE.** Further phases
  (scoring engine, tasks, bonus, compensation_records, disputes, anti-gaming, notifications, exports,
  UI/API) remain **GATED** (ADR-020).
