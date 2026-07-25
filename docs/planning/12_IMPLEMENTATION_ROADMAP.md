# 12 — Implementation Roadmap

## Purpose

Planlama dokümanlarını, kodlama başladığında izlenecek fazlı bir yol haritasına bağlamak. Bu doküman
**kod içermez**; her fazın hedefini, çıktısını, kabul/test kriterini ve bağımlılığını tanımlar.

## Scope

- Kapsam: Phase 0–10, faz başına goal/deliverable/acceptance/test/risk/dependency/difficulty.
- Kapsam dışı: kod, migration, gerçek tahminleme (gün/efor) — implementation authorize sonrası netleşir.

## Assumptions

- `Assumption:` Tek ekip, modular monolith, Supabase + Next.js (context stack).
- Implementation yalnız kullanıcı `implementation authorized` dedikten sonra başlar; izin **faz-sınırlı** kabul edilir (ADR-020).

## Non-negotiable rules

- Hiçbir faz, bağımlı olduğu güvenlik temeli (RLS, ledger) tamamlanmadan ileri taşınmaz.
- Her faz kendi acceptance + test kriterini geçmeden "done" sayılmaz.
- Phase 3 (DB/RLS/Ledger) güvenlik temeli; sonraki fazların ön koşulu.

## Detailed specification

### Phase 0 — Source & Prompt Audit  [TAMAMLANDI]

- Goal: çelişki/karar netleştirme.
- Deliverable: planlama paketi + Decision Lock (D1–D12) + Phase-Gate OQ Resolution (AD1–AD10).
- Acceptance: 22 karar kilitli; faz-gate OQ'lar kapatıldı; çelişkiler çözülmüş.
- Status: ✅ (PDF kullanılmıyor; context pack tek source of truth).

### Phase 1 — Product & Risk Framing  [DOKÜMAN AŞAMASI — TAMAMLANDI]

- Goal: PRD + legal/ethical risk haritası + tam ADR gövdeleri.
- Deliverable: `01_PRD` (kesin), `/docs/adr/ADR-001…020` tam metin, `CLAUDE.md`.
- Acceptance: non-negotiable'lar net; legal-review item listesi hazır; 20 ADR Accepted/Proposed.
- Status: ✅ ADR'ler + CLAUDE.md üretildi. Test: yok (doküman). Risk: hukuki belirsizlik. Dep: Phase 0. Difficulty: M.

### Phase 2 — Domain Model & Permissions

- Goal: entity finalizasyonu + RBAC (primary_role, AD2) + RLS stratejisi somutlanması (DB authz, AD1).
- Deliverable: `02_DOMAIN_MODEL` + `03_PERMISSION_RLS_STRATEGY` (policy intent → uygulanabilir tasarım).
- Acceptance: her tablo için RLS policy intent + Finance view + comp audit (AD3) onaylı.
- Test: RLS test planı. Risk: recursive RLS, primary_role. Dep: Phase 1. Difficulty: M.

### Phase 3 — Database & Ledger Foundation  [GÜVENLİK TEMELİ]

- Goal: schema + RLS + point/bonus ledger + audit + comp records + seed.
- Deliverable: tablolar, RLS policy'leri, ledger yapıları, comp audit maskeleme, test tenant seed.
- Acceptance: RLS negatif suite yeşil; ledger append-only; audit yazıyor (comp maskeli); AD1/AD3 testleri geçer.
- Test: cross-tenant, append-only, audit coverage, JWT-bypass. Risk: ledger doğruluğu. Dep: Phase 2. Difficulty: L.
- **Dilimler:**
  - **Phase 3A — Database Foundation & RBAC** [VERIFIED/DONE — `implementation authorized only for Phase 3A`]:
    11 temel/RBAC tablosu (organizations, organization_settings, profiles, roles, permissions,
    role_permissions, memberships, teams, team_memberships, support_access_grants, audit_logs iskeleti),
    RLS helper'ları (recursive-safe — §7A), RLS ENABLED+FORCE + policy'ler, constraint'ler, test tenant seed,
    bloklayıcı pgTAP suite. Kod: `supabase/` (plan: `17_PHASE_3A_...`). Apply/test: yalnız dev/staging.
    **Durum: Phase 3A verified/done** (2026-06-24, lokal dev stack). Kanıt: `db reset` passed,
    `test db` passed, **38/38 pgTAP testi geçti**. Doğrulama sırasında tek kod/test değişikliği
    `supabase/tests/0001_phase3a_rls.test.sql` oldu (pgTAP `throws_ok` assertion formu 3-arg→4-arg düzeltildi);
    **migration/seed/RLS/schema bug bulunmadı**.
    **Karar:** primary team canonical source = `team_memberships.is_primary` (memberships `primary_team_id`
    taşımaz; AD9 — bkz. doc 13/14, ADR-019 not).
    **Phase 3B+ hâlâ gated**; her dilim ayrı, birebir authorization ister (ADR-020).
  - **Phase 3B-A — Scoring Policy foundation** [VERIFIED/DONE]: `scoring_policies` +
    `scoring_policy_versions` (published immutable — AD7), `policy.manage`, RLS + pgTAP.
    Kod: `migrations/0008_scoring_policies.sql`, `tests/0002_phase3b_scoring_policies.test.sql`
    (commit `dd9b861`). **Verified 2026-07-24** (npx CLI 2.109.1; `db reset` 0001..0009 + seed clean;
    `test db` Files=3 Tests=97 PASS Failed=0).
  - **Phase 3B-B — Point Ledger foundation** [VERIFIED/DONE]: `point_ledger` (append-only, server-only
    writes, Finance excluded), `team_of()` helper, RLS + pgTAP. Kod: `migrations/0009_point_ledger.sql`,
    `tests/0003_phase3b_point_ledger.test.sql` (commit `f46ab49`). **Verified 2026-07-24** (aynı koşu;
    97/97 yeşil, iki temiz koşuda tekrar-üretildi). Non-fatal storage-readiness uyarısı bloklayıcı değil.
  - **Phase 3 — compensation_records** [VERIFIED/DONE]: `compensation_records` (comp-sensitive cap/salary;
    **direct raw SELECT closed**, comp.read INSERT/UPDATE, DELETE blocked, masked write/access audit,
    justified `read_compensation_record`). Kod: `migrations/0010_compensation_records.sql`,
    `tests/0004_phase3_compensation.test.sql` (commit `c9cd0f2`). **Verified 2026-07-24** (`db reset`
    0001..0010 + seed; `test db` Files=4 Tests=139 PASS Failed=0). AD3/D7/SI-5 kanıtlı.
  - **Phase 3 — bonus_periods + bonus_pools** [VERIFIED/DONE]: period lifecycle state machine + pool
    (one active/period); AD10 pool-lock-before-period-lock; locked pool needs `t_org`+`locked_at`+`locked_by`
    (amount/t_org immutable); locked/non-open period identity immutable (SI-4); period.manage/pool.create
    ayrımı. Kod: `migrations/0011_bonus_periods_pools.sql`, `tests/0005_phase3_bonus_periods_pools.test.sql`
    (commit `d04b954`). **Verified 2026-07-24** (`db reset` 0001..0011 + seed; `test db` Files=5 Tests=194
    PASS Failed=0). AD10/SI-4 kanıtlı.
  - **Phase 3 — bonus_pool_components + bonus_pool_eligibility** [VERIFIED/DONE]: MVP Safe Pro-Rata component
    model (`individual`=1.0 only — D1); component/eligibility → `bonus_pools` same-org composite FK; eligibility
    employee **aynı org üyesi** (`(org, employee)` → `memberships` composite FK; cross-tenant employee yapısal
    olarak imkânsız); `primary_team_id` same-org + AD9 `team_memberships.is_primary` doğrulaması; 15-gün +
    proration (D10); eligibility yazımı server-only; parent pool draft'tan çıkınca hem component hem eligibility
    **immutable** (SI-4). Kod: `migrations/0012_bonus_components_eligibility.sql`,
    `tests/0006_phase3_bonus_components_eligibility.test.sql` (commit `8f74e8d`). **Verified 2026-07-24**
    (`db reset` 0001..0012 + seed; `test db` Files=6 Tests=238 PASS Failed=0). D1/D10/AD9/AD10/SI-4 kanıtlı.
  - **Phase 3 — bonus_calculation_runs + bonus_allocations + bonus_allocation_snapshots** [VERIFIED/DONE]:
    hesaplama iskeleti (motor YOK). Run state machine `running→completed→superseded`; AD10 **çift guard**
    (run yalnız locked period + locked pool üzerinde başlar); idempotency `unique(organization_id, idempotency_key)`;
    run completed olunca allocation'lar **blanket freeze** (SI-4/SI-14); **ince** snapshot append-only immutable
    (UPDATE/DELETE hard-block; per-employee detay kopyalanmaz — INV-6); allocation cap-not-exceeded +
    `cap_applied`(pending_missing_cap_basis — AD6); approved/exported/paid yazımı bloklu; same-org composite FK'ler
    (period/pool/policy_version/run/employee/team); server-only writes; `Σfinal+remainder=pool` yalnız
    seed/test-verified (SI-13/INV-4, hard trigger yok). Kod: `migrations/0013_bonus_calc_runs_allocations_snapshots.sql`,
    `tests/0007_phase3_bonus_calc_runs_allocations_snapshots.test.sql` (commit `e3bd1a3`). **Verified 2026-07-25**
    (`db reset` 0001..0013 + seed; `test db` Files=7 Tests=299 PASS Failed=0). D1/D6/AD6/AD7/AD9/AD10/SI-4/SI-12/SI-13/SI-14 kanıtlı.
    (Ayrıca `docs/planning/14` idempotency+markdownlint sync — commit `dae4c6b`.)
  - **Phase 3 (kalan) — Ledger & sensitive data** [GATED]: scoring **engine** (final_points math +
    approve→ledger + `task_approved`/`task_id`), tasks/task_reviews, `bonus_ledger`, disputes, anti-gaming,
    notifications, exports, UI/API. Her dilim ayrı `implementation authorized` ister (faz-sınırlı — ADR-020).
    **Sıradaki önerilen DB dilimi:** **bonus_ledger + approve→accrual foundation** (double-entry money;
    Σdebit=Σcredit; accrual yalnız approved snapshot'tan — `snapshot_id NOT NULL`, AD6/SI-3; append-only;
    accrual idempotency `unique(snapshot_id, employee_id, account)` — ADR-017; gerçek approve/payout orkestrasyon Phase 6+).
    **Henüz yetkili değil.**

### Phase 4 — Task & Review Core

- Goal: task CRUD → assign → submit → review.
- Deliverable: task akışı + state machine + self-approval block + submission/revision history (AD4).
- Acceptance: state machine doğru; self-approval blocked; period-lock guard.
- Test: state geçişleri, self-approval. Risk: status bug. Dep: Phase 3. Difficulty: M.

### Phase 5 — Scoring Engine

- Goal: `04` motorunun uygulanması.
- Deliverable: policy versioning (AD7) + multipliers + timeliness(submitted_at, AD4) + collaboration-no-effect (AD5) + approve→ledger + breakdown.
- Acceptance: determinizm; quality=poor approve etmez; geç onay cezalandırmaz; idempotent approve.
- Test: scoring suite (`10` #1, #5). Risk: yanlış puan. Dep: Phase 4. Difficulty: M.

### Phase 6 — Bonus Engine

- Goal: `05` motorunun uygulanması.
- Deliverable: period/pool(lock, AD10)/eligibility/proration/T_org(+top-up, AD8)/cap basis(AD6)/calculation run/snapshot(faktörler, AD7).
- Acceptance: Σ invariant; worked example reproduce; cap basis yoksa pending+export bloğu; T_org=1.2 top-up'suz pool aşmaz; idempotent run; snapshot immutable.
- Test: bonus calculation suite (`10` #4). Risk: finansal hata. Dep: Phase 5. Difficulty: L.

### Phase 7 — Anti-Gaming & Disputes

- Goal: 5 flag + dispute workflow.
- Deliverable: `08` kuralları + `07` dispute akışı (HR atama, 5 iş günü, manager final değil) + recalculation.
- Acceptance: flag→review (no auto-punish); dispute→adjustment/snapshot; manager final değil.
- Test: anti-gaming + dispute suite. Risk: false positive. Dep: Phase 6. Difficulty: M.

### Phase 8 — Dashboards & UX

- Goal: 5 rol ekranları + 2 leaderboard görünümü.
- Deliverable: `09` IA'ya göre ekranlar + breakdown'lar (cap basis/T_org top-up notları dahil).
- Acceptance: her puan/prim açıklanabilir; estimated/final ayrımı; privacy-first leaderboard.
- Test: E2E + erişim + temel a11y. Risk: UX altitude. Dep: Phase 5–7. Difficulty: L.

### Phase 9 — Testing & Security

- Goal: tam test suite + güvenlik incelemesi.
- Deliverable: business/RLS/permission/anti-gaming/E2E/security testleri.
- Acceptance: cross-tenant + self-approval bloklayıcı yeşil; audit coverage tam; AD1–AD10 testleri geçer.
- Test: tüm suite. Risk: kapsam boşluğu. Dep: Phase 3–8. Difficulty: L.

### Phase 10 — Production Readiness

- Goal: monitoring, error handling, audit export, docs, deploy checklist, support access.
- Deliverable: gözlemlenebilirlik + deploy checklist + support workflow.
- Acceptance: audit export çalışır; deploy checklist geçer; support access audit'li.
- Test: smoke + export. Risk: ops. Dep: Phase 9. Difficulty: M.

## Edge cases

- Phase atlanması: güvenlik temeli (Phase 3) atlanamaz.
- Paralel çalışma: Phase 4–5 ardışık (scoring task'a bağlı); Phase 8 erken prototiplenebilir ama gerçek veri Phase 6 sonrası.

## Acceptance criteria

- Her faz ölçülebilir acceptance + test kriterine sahip.
- Güvenlik temeli (RLS/ledger) sonraki fazların ön koşulu olarak işaretli.
- Roadmap Decision Lock (D + AD) + tüm spec'lerle tutarlı.

## Test implications

- Faz başına "done" tanımı `10_TEST_STRATEGY` ilgili bölümüne bağlanır.

## Open questions

- OQ-RM-1: Efor tahminleri implementation authorize sonrası mı netleştirilir? (Öneri: evet.)
- OQ-RM-2: Phase 8 (UX) için erken prototip (mock veri) Phase 6 öncesi başlasın mı? (Öneri: opsiyonel, paralel.)
