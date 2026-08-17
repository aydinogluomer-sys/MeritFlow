# Data Lifecycle, Retention & Deletion Policy (ENGINEERING-12)

Retention, export, and deletion policy for MeritFlow tenant data. This is an **operational policy
document, not legal advice**.

> **KVKK / Türkiye iş hukuku is a legal-review item** (ADR-016 / Decision Lock D8). Retention periods
> and any erasure of financial/audit records require **legal / HR / finance sign-off before
> production use**. Nothing here overrides a statutory retention obligation.

> **No destructive deletion code ships in this slice** (deliberate). Org/account deletion is defined
> here as a *procedure*; a coded, RLS-guarded, audited deletion/export workflow is a future slice that
> must clear legal review first. Building a destructive RPC and calling it "done" would violate both
> the legal-review gate and the append-only ledger/audit guarantees.

## 1. Data classes

| Class | Examples | Sensitivity |
| --- | --- | --- |
| Identity | `profiles`, `auth.users`, memberships | personal data (KVKK) |
| Operational | tasks, reviews, points, notifications | business data |
| Financial | `compensation_records`, bonus pools/allocations, `point_ledger`, `bonus_ledger` | comp-sensitive (AD3) + financial record |
| Audit | `audit_logs`, comp-access logs | immutable evidence |

## 2. Retention policy

| Data | Retention | Rationale |
| --- | --- | --- |
| `point_ledger`, `bonus_ledger` | **Retain (append-only, never deleted)** | Financial record; corrections are reversal/adjustment entries only. Statutory period applies — legal-review. |
| `audit_logs` + comp-access logs | **Retain (append-only, never deleted)** | Legal/forensic evidence; masked comp payloads (AD3). Statutory period — legal-review. |
| Bonus snapshots / allocations | Retain with the period | Immutable basis for payout/explainability; deleting breaks right-to-explanation. |
| `compensation_records` | Retain while employment + statutory tail | Comp history; superseded rows kept, not hard-deleted. |
| Tasks / reviews | Retain per bonus period, then archivable | Feed scoring; needed for dispute window + explainability. |
| Notifications | Purgeable after a TTL (e.g. 90 days) | Delivery sink; not a source of truth (no audit trigger). |
| `support_access_grants` | Time-bound (expire; D4) | Least-privilege; expired grants are inert, retained for audit. |

Retention periods above are **placeholders pending legal sign-off**. Ledgers and audit are the hard
constraint: they are append-only by design (CLAUDE.md) and cannot be trimmed by routine jobs.

## 3. Soft-delete vs hard-delete

- **Soft-delete is the default.** Members are deactivated (`memberships.status = 'deactivated'`);
  orgs would be marked inactive. This preserves referential integrity, financial records, and the
  audit trail. Deactivated identities stop having access (RLS/authz) but their historical financial
  rows remain.
- **Hard-delete / anonymization** is reserved for a **verified erasure request** (KVKK right to
  erasure) and only after legal review. Key tension: financial and audit records may be **legally
  required to retain** even under an erasure request → the resolution is usually **anonymization**
  (detach the person's identity) rather than deletion of the financial rows. This is a legal decision,
  not an engineering default.
- Ledgers and `audit_logs` are **never** casually hard-deleted (immutable).

## 4. Tenant data export

Data portability + a pre-deletion safeguard. Export must be **logged** (ADR-016 export logging /
auditability).

- **Today (manual):** an RLS-scoped, per-org structured dump (e.g. `pg_dump` filtered to the org's
  rows, or per-table `select` scoped by `organization_id`), produced by an operator, logged in
  `audit_logs`.
- **Future (coded):** an `export_organization_data` RPC (server-only, audited) — out of scope this
  slice.

## 5. Organization / account deletion workflow (procedure)

Run as a deliberate, reviewed procedure — not a one-click action.

1. **Request** received (tenant admin or legal).
2. **Legal / HR / finance sign-off** — confirm no statutory retention blocks deletion; decide
   delete-vs-anonymize per data class.
3. **Export** the tenant's data (§4) and deliver/retain it; log the export.
4. **Financial safety check** — no open bonus periods, no un-exported/un-paid payouts, no open
   disputes with financial impact. Reconciliation (ENGINEERING-05) clean for the tenant.
5. **Soft-delete + grace period** — mark the org inactive; revoke access; hold for the grace window
   (recoverable).
6. **Hard-delete / anonymize** the legally-deletable classes after the grace window; retain/anonymize
   the classes under statutory retention (ledgers, audit).
7. **Deletion verification** (§6) + write an audit entry recording the deletion decision and scope.

## 6. Deletion verification (checklist)

After a deletion/anonymization is executed, confirm:

- [ ] Identity rows for the tenant are removed or anonymized (no recoverable personal data beyond
      what is legally retained).
- [ ] Access is fully revoked — no membership, no support grant, no session resolves to the org.
- [ ] Retained financial/audit rows are **anonymized** where required (no direct identifier), but the
      financial totals still reconcile.
- [ ] Cross-tenant isolation intact — no other tenant's data touched (RLS).
- [ ] An `audit_logs` entry records the deletion (actor, scope, legal-approval reference).
- [ ] The export from §4 exists and is retrievable.

**ENGINEERING-12 is not "done" for data lifecycle until a deletion-verification dry-run has been
executed on staging and recorded, and the retention periods have legal sign-off.**

## 7. Deletion drill evidence

Records each run of `scripts/deletion-dry-run.sh` (the staging-only retention/erasure drill). The
script previews by default (no DB changes) and prints a paste-ready row; `--apply` runs the batch as
a single transaction. It **never** deletes the append-only classes (point/bonus ledger, `audit_logs`,
snapshots, `*_events`) — those are counted + retained, and the DB `prevent_mutation` triggers enforce
it independently.

```bash
STAGING_CONFIRMED=1 TARGET_DB_URL=<staging url> bash scripts/deletion-dry-run.sh            # preview only
STAGING_CONFIRMED=1 TARGET_DB_URL=<staging url> bash scripts/deletion-dry-run.sh --apply    # execute (txn)
```

> **Legal/HR/Finance sign-off is required before any `--apply` run against a non-dev DB. See the
> sign-off checklist below (§8).**

| Date | Operator | DB target | Mode | Steps run | Row counts | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |

## 8. Legal/HR/Finance sign-off checklist

Complete **before** any `--apply` deletion run against a non-dev database. **Consult legal counsel
before running `--apply` on any non-dev database — this document does not constitute legal advice.**

- [ ] Retention periods reviewed by legal counsel (KVKK compliance)
- [ ] Point/bonus ledger hard-delete exception documented + approved by legal
- [ ] Audit log minimum retention floor confirmed with HR/Finance
- [ ] Employee PII deletion scope reviewed against Turkish employment law
- [ ] Estimated/vested prim distinction confirmed in deletion scope
      (CLAUDE.md: "Prim 'takdiri/koşullu' çerçevelenir")
- [ ] Sign-off: Legal ____ | HR ____ | Finance ____
- [ ] Date of sign-off: ____
