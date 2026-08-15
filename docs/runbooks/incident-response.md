# Incident Response Runbook (ENGINEERING-12)

What to do when MeritFlow is down, degraded, leaking, or producing incorrect financial results.
MeritFlow currently runs with a small operator team; the steps below still apply with one person —
follow the checklist rather than improvising.

> Financial correctness incidents are the highest severity: bonus/payout data affects real
> compensation. **Never** "fix" a ledger by mutating rows — corrections are reversal/adjustment
> entries only (CLAUDE.md). Reconciliation detects, humans decide, ledger append-only holds.

## 1. Severity levels

| Sev | Definition | Examples | Response time |
| --- | --- | --- | --- |
| **SEV1** | Financial-integrity risk or full outage | reconciliation CRITICAL mismatch, payout export wrong, DB down, auth broken, secret leaked | Immediate |
| **SEV2** | Major degradation, no integrity risk | a core page failing, elevated error rate, slow queries breaching budget | < 1 business day |
| **SEV3** | Minor / cosmetic | single non-critical UI bug, transient warning | Scheduled |

If unsure between SEV1 and SEV2, treat as SEV1 until proven otherwise.

## 2. Response flow

1. **Detect** — alert fired (see [slo.md](slo.md)), `/api/health` failing, user report, or a
   reconciliation CRITICAL. Record the detection time.
2. **Declare** — set the severity; open an incident note (timeline doc, §5 template).
3. **Assess** — scope: which tenants/data, integrity vs availability, is it spreading?
4. **Mitigate** — stop the bleeding first:
   - Bad deploy → **Vercel instant rollback** to the previous deployment.
   - Bad migration → do **not** hand-edit prod; PITR restore per [disaster-recovery.md](disaster-recovery.md).
   - Suspected key compromise → rotate credentials (§4) **before** anything else.
   - Abuse/DoS → rate-limit / block at the edge (see [appsec.md](appsec.md)).
5. **Communicate** — status to stakeholders; for financial impact, notify HR/Finance (they own the
   comp relationship). Framing stays "estimated ≠ vested" (ADR-016).
6. **Resolve** — apply the fix via the normal gated pipeline (migrations + CI), not a hotfix to prod.
7. **Verify** — `/api/health` ok, reconciliation clean, affected golden path re-tested.
8. **Review** — post-incident review within 3 business days (§5).

## 3. Data-integrity incident (special path)

1. Run the reconciliation verifier (ENGINEERING-05) to enumerate the exact invariant(s) violated.
2. Do **not** auto-fix and **do not** mutate the ledger. Capture the mismatch (it is already
   audit-logged / captured).
3. Determine the correct state from the immutable snapshot + append-only ledger.
4. Correct via a **reversal or adjustment** entry (with reason + audit), or a period recalculation
   from the approved snapshot — never a silent update.
5. Re-run reconciliation until clean; record in the review.

## 4. Credential rotation drill

Rotate on suspected compromise, on operator offboarding, and on a scheduled cadence (≥ every 90 days).
Secrets are per-environment and server-only (SI-11: `SUPABASE_SERVICE_ROLE_KEY` never logged, never
committed, never in the client bundle).

| Credential | Where | Rotation |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project API settings | Regenerate → update Vercel + GitHub Actions secrets → redeploy → verify admin paths → invalidate old. |
| Database password | Supabase project DB settings | Reset → update `SUPABASE_DB_PASSWORD` (deploy workflow secret) + any pooled connection strings. |
| Anon key / JWT secret | Supabase project API settings | Rotating the JWT secret invalidates live sessions — schedule a low-traffic window; update `NEXT_PUBLIC_SUPABASE_ANON_KEY`. |
| `SUPABASE_ACCESS_TOKEN` (CLI/deploy) | Supabase account tokens | Revoke → mint new → update the `deploy` workflow secret. |
| Vercel deploy / project tokens | Vercel account | Revoke → re-issue. |

**Drill:** rotate one non-critical credential end-to-end in staging, confirm the app still works,
and record it. Rotation is not proven until a rotated key has been used successfully and the old one
confirmed dead.

## 5. Post-incident review template

```
Incident: <short title>            Severity: SEV<n>
Detected: <ts>   Mitigated: <ts>   Resolved: <ts>
Impact: <tenants / data / financial? / user-visible?>
Timeline:
  <ts> - <event>
Root cause: <the actual cause, not the symptom>
Why it wasn't caught earlier: <gap>
Corrective actions (with owner + due date):
  - [ ] <preventive change>
  - [ ] <detection/alert improvement>
Evidence: <links to logs, reconciliation output, drill records>
```

## 6. Drill evidence (fill in — required for DoD)

| Date | Type (rotation / integrity / outage sim) | Operator | Outcome | Notes |
| --- | --- | --- | --- | --- |
| _pending_ | | | | |

**ENGINEERING-12 is not "done" for incident readiness until a rotation drill row above is complete.**
