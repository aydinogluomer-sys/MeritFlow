# MeritFlow — Supabase (Database Foundation: Phase 3A + Phase 3B-A/3B-B)

This directory is the **database foundation**. It currently implements three
verified slices (each under its own `implementation authorized only for Phase 3X — …`):

- **Phase 3A — Database Foundation & RBAC** (`17_PHASE_3A_...md`): 11 foundation/RBAC
  tables, RLS helpers, RLS (ENABLED + FORCE), constraints, test-tenant seed, blocking pgTAP.
- **Phase 3B-A — Scoring Policy foundation** (`18_PHASE_3B_...md` §5.1/5.2): `scoring_policies` and
  `scoring_policy_versions` (immutable once published, AD7), `policy.manage` permission, RLS + pgTAP.
- **Phase 3B-B — Point Ledger foundation** (`18` §5.3/§7): append-only single-entry `point_ledger`,
  `team_of()` helper, server-only writes, RLS + pgTAP.

Migrations `0001..0009` + seed apply cleanly; blocking pgTAP suites (`0001`/`0002`/`0003`) are green
(see "Verification" below). **Everything downstream is still gated** (see "Out of scope").

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
  seed/seed_test_tenants.sql              2 tenants, RBAC catalog, teams, support grants,
                                          + Phase 3B: policy.manage, scoring policies/versions,
                                          point_ledger fixtures
  tests/
    0001_phase3a_rls.test.sql             blocking pgTAP — RLS/RBAC (Phase 3A)
    0002_phase3b_scoring_policies.test.sql blocking pgTAP — scoring policy/version (Phase 3B-A)
    0003_phase3b_point_ledger.test.sql    blocking pgTAP — point_ledger/append-only (Phase 3B-B)
```

## Apply & test (local)

Requires Docker + the Supabase CLI. From the repo root:

```bash
supabase start            # boots local dev stack (Docker)
supabase db reset         # applies migrations 0001..0009 then seed
supabase test db          # runs the pgTAP suites in tests/ (0001 + 0002 + 0003)
```

If the `supabase` binary is not on PATH (e.g. a fresh install not yet picked up), the project-local
CLI works too: `npx --no-install supabase <cmd>`.

`supabase db reset` is the canonical way to rebuild from scratch; the seed is written to be
re-runnable (on-conflict guards).

## Verification (Phase 3A + Phase 3B-A/3B-B) — local dev/staging only

> **Phase 3A: VERIFIED / DONE** (2026-06-24, local dev stack). Evidence: `supabase db reset`
> applied `0001..0007` + seed; `supabase test db` → **38/38 pgTAP passed (0 failed)**. The only change
> during verification was the pgTAP `throws_ok` assertion form (3-arg → strict 4-arg) in
> `tests/0001_phase3a_rls.test.sql`; **no migration/seed/RLS/schema bug was found**.
>
> **Phase 3B-A + Phase 3B-B: VERIFIED / DONE** (2026-07-24, local dev stack, npx Supabase CLI
> **2.109.1**). Evidence: `supabase db reset` applied migrations **0001..0009** + seed cleanly;
> `supabase test db` → **Files=3, Tests=97, Result=PASS, Failed=0**. Per-suite:
> `0001_phase3a_rls.test.sql` ok · `0002_phase3b_scoring_policies.test.sql` ok ·
> `0003_phase3b_point_ledger.test.sql` ok. Reproduced across two clean runs (deterministic seed).
> A **non-fatal** `storage container not ready: starting` warning appeared during `db reset`'s
> container-restart phase — an ancillary service timing message, **not** a DB/migration/seed defect
> (the 97/97 green suite, incl. seed-dependent assertions, confirms the schema + seed are correct).
> **No migration/seed/RLS/schema bug was found.**
>
> **Later phases remain gated** and require explicit, verbatim authorization (ADR-020).
> **Never run any of this against a production project.**

### Prerequisites

- [ ] **Docker Desktop** installed and **running** — verify: `docker info` (must succeed).
- [ ] **Supabase CLI** available — verify: `supabase --version` **or** `npx --no-install supabase --version`.
  - Install (Windows, no repo impact): **winget** `winget install Supabase.CLI`, **or** **Scoop**
    `scoop bucket add supabase https://github.com/supabase/scoop-bucket.git && scoop install supabase`.
  - Or project-local via `npx supabase` (the CLI is **not** supported as a global npm install).
  - macOS: `brew install supabase/tap/supabase`.
- [ ] You are in the repo root (the folder containing `supabase/`).
- [ ] You are **not** linked to production: do **not** run `supabase link` / `db push` / `db pull`
  against prod. Local only.

### Steps

```bash
supabase start        # 1. boot local stack; note the printed local URLs + dev-default keys
supabase db reset     # 2. apply 0001..0009 + seed (expect clean apply)
supabase test db      # 3. run pgTAP; expect TAP summary 0 failed
```

### Expected pass criteria

- [ ] **All pgTAP assertions pass** (TAP: `0` failed; currently **Files=3, Tests=97, PASS**). The
  suites are **blocking** — a slice is not "done" until green.
- [ ] Green coverage: cross-tenant isolation (SI-7), non-recursive memberships read (§7A), support
  active-vs-expired grant (D4), append-only audit + append-only `point_ledger` (SI-2), helper
  correctness (`current_org`/`has_role`/`has_permission`/`manages_team`/`team_of`), scoring-policy
  `policy.manage` gating + published-version immutability (AD7), point_ledger visibility
  (employee-own / manager-via-`team_of` / org readers / **Finance excluded** / support-scoped), and
  constraint negatives (uniqueness, minimal `event_type` CHECK, composite same-org FKs).
- [ ] `supabase db reset` then re-running the suite is reproducible (deterministic seed UUIDs).
- [ ] (Recommended) check advisors via Supabase MCP `get_advisors` against the **local/staging** project only.

### Failure triage

- **Stale/dead stack** (e.g. `supabase_db_...` shows `Exited (137)` from a prior session) → not a code
  defect; clean-restart with `supabase stop --no-backup` then `supabase start`, then `db reset`.
- **Migration fails on `auth.users` insert** → watchpoint A (extend the seed's `auth.users` columns).
- **`supabase test db` errors "function ... does not exist" / pgTAP missing** → watchpoint B.
- **Assertions about counts fail as authenticated** → watchpoint C (role switching / `request.jwt.claims`).
- **Helpers return null/false unexpectedly under RLS** → watchpoint D (owner role BYPASSRLS assumption).
- **Cross-tenant test "leaks" rows** → a policy is missing its `organization_id = current_org()`
  anchor (a real defect, not an env issue).
- After any fix, re-run `supabase db reset && supabase test db` from a clean state.

### Version-dependent watchpoints

- **A. `auth.users` seed columns** — the seed inserts a minimal column set; if a local Supabase auth
  schema requires additional NOT NULL columns, extend the seed's `auth.users` INSERT. (Seed/migration
  files: do not change without re-authorization — flag instead.)
- **B. pgTAP availability** — `supabase test db` provides pgTAP; use the Supabase test runner.
- **C. role switching / `pg_prove`** — the suites use `set local role authenticated` +
  `set_config('request.jwt.claims', …)`; adjust runner flags if non-TAP setup output is mis-parsed.
- **D. BYPASSRLS owner-role assumption** — recursive-RLS safety (§7A) relies on SECURITY DEFINER
  helpers owned by a role that bypasses RLS (Supabase `postgres`).

### ⛔ Production safety

- These commands target the **local** stack only. Do **not** `supabase link` + `db push`/`db pull` to
  production, and do **not** point Supabase MCP at a production project (ADR-014 / CLAUDE.md).
- `service_role` key stays in env; never commit it, never include it in any client bundle.

## Tables (14) and data classes

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
| audit_logs | yes | audit-critical | append-only (UPDATE/DELETE blocked) |

**Phase 3B-A / 3B-B — scoring policy + point ledger (3):**

| Table | org_id? | Class | Notes |
| --- | :--: | --- | --- |
| scoring_policies | yes | confidential | writes need `policy.manage`; audited |
| scoring_policy_versions | yes | confidential, audit-critical | **immutable once published** (AD7); same-org composite FK |
| point_ledger | yes | audit-critical, financial-critical | **append-only** (ADR-005); server-only writes; Finance excluded; minimal event_type (`manual_adjustment`/`reversal`) |

## Security guarantees enforced here

- **RLS ENABLED + FORCE** on all tenant tables (SI-6); every tenant policy anchored on
  `organization_id = current_org()` → cross-tenant blocked (SI-7).
- **Authorization from DB** (`role_permissions`), never JWT (AD1); JWT = identity only.
- **Recursive-RLS safe** (§7A): helpers (incl. `team_of`) are SECURITY DEFINER + fixed `search_path`.
- **Least privilege**: `authenticated` is never granted `DELETE`; catalog tables read-only to clients;
  `point_ledger` is **SELECT-only** for `authenticated` (writes are server-only, `service_role`).
- **Append-only** (SI-2): triggers block UPDATE/DELETE on `audit_logs` and `point_ledger` even for
  bypassrls roles; correction = reversal row.
- **Scoring-version immutability** (AD7): a published `scoring_policy_versions` row cannot be
  UPDATE/DELETE'd; draft edits and draft→published are allowed.
- **Support access** (D4): default no access; read only via an **active, unexpired** grant; audited.

## Out of scope (later slices / phases — still gated, ADR-020)

Scoring **engine** (the `final_points` math + approve→ledger wiring + `task_approved` event / `task_id`),
tasks & task_reviews, bonus_* / bonus_ledger / snapshots, **compensation_records + comp audit masking**,
disputes, anti_gaming_flags, notifications, exports, projects, objectives, integrations, webhook_events,
Finance aggregate views (`v_finance_*`), UI/dashboard, API routes. Each needs its own phase-scoped,
verbatim authorization (ADR-020).

> **Next recommended DB slice:** `compensation_records` + comp audit masking (AD3/AD6/D7) — the bonus
> engine's cap source and the most sensitive table. **Not authorized yet** — requires
> `implementation authorized only for Phase 3 — compensation_records …`.

## Notes for reviewers

- `auth.users` seeding uses a minimal column set; if a local Supabase version requires additional
  NOT NULL auth columns, extend the seed's `auth.users` INSERT accordingly.
- Open implementation questions (e.g. OQ-RLS-2 comp-audit mechanism) belong to later slices.
- Primary team is resolved **only** from `team_memberships.is_primary` (AD9); `memberships` has no
  `primary_team_id` and must not gain one.
