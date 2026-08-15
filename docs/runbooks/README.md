# MeritFlow Operational Runbooks

Operational documentation for running MeritFlow safely in production. These runbooks are the
in-repo half of production-readiness; the other half is **evidence from real drills**, which only an
operator can produce in a live environment (see the checklist below).

## Index

| Runbook | Covers | Slice |
| --- | --- | --- |
| [appsec.md](appsec.md) | SAST/CodeQL, secret scanning, dependency audit, secure headers | ENGINEERING-08 |
| [migration-safety.md](migration-safety.md) | Migration standard, expand–contract, prod DDL rules, CI gates | ENGINEERING-07 |
| [performance.md](performance.md) | ICP perf profiles, hot-query budgets, seq-scan guard | ENGINEERING-10 |
| [outbox.md](outbox.md) | Transactional outbox + drain worker (idempotency, backoff, dead-letter) | ENGINEERING-09 |
| [environments-and-deploy.md](environments-and-deploy.md) | Env ladder, secret isolation, gated migration release, rollback | ENGINEERING-12 |
| [disaster-recovery.md](disaster-recovery.md) | RPO/RTO, backups/PITR, restore drill, evidence | ENGINEERING-12 |
| [incident-response.md](incident-response.md) | Severity, triage, integrity path, credential rotation | ENGINEERING-12 |
| [data-lifecycle.md](data-lifecycle.md) | Retention, soft/hard delete, export, deletion (KVKK) | ENGINEERING-12 |
| [slo.md](slo.md) | SLIs/SLOs, error budget, alerting plan | ENGINEERING-12 |

## Production tooling

- [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) — manual, environment-gated
  production migration release (dry-run by default; real push behind `apply=true` + required reviewers).
- [`scripts/restore-drill.sh`](../../scripts/restore-drill.sh) — local restore-drill proxy
  (restore → migration parity → reconciliation → pgTAP integrity).

## ENGINEERING-12 Definition of Done — evidence checklist

Code + docs alone do **not** complete ENGINEERING-12. The roadmap is explicit: *"Backup configured"
is not done — evidence = real restore → boot → reconciliation → integrity.* Each item below is
**operator/environment work**; record the evidence, then check it off.

- [ ] **Environment parity** — staging + production are separate Supabase projects with isolated
      secrets/Sentry; the same migrations applied to both. (environments-and-deploy)
- [ ] **Gated prod migration** — the `deploy` workflow's `production` environment + required reviewers
      + secrets are configured, and one migration has shipped through it (dry-run reviewed). (environments-and-deploy)
- [ ] **Backup + PITR enabled** on production, and a **restore drill executed** with RTO/RPO measured
      and reconciliation + pgTAP integrity green. (disaster-recovery §6)
- [ ] **Credential rotation drill** executed end-to-end (rotated key used, old key confirmed dead).
      (incident-response §6)
- [ ] **Alerting live** — an uptime monitor + error reporting + reconciliation-CRITICAL alert, with at
      least one alert **actually fired and verified**. (slo §6)
- [ ] **SLO dashboard active** with availability / latency / error-rate / last-reconciliation / last
      backup-drill. (slo)
- [ ] **Deletion-verification dry-run** on staging + retention periods have legal/HR/finance sign-off.
      (data-lifecycle §6)
- [ ] **Post-incident review** template adopted; incident + DR runbooks linked from the on-call setup.

Until these are evidenced, ENGINEERING-12 is "enabled in-repo, pending operational proof" — not done.
