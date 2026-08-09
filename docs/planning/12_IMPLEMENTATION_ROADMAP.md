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
  - **Phase 3 — bonus_ledger (double-entry money)** [VERIFIED/DONE]: append-only para defteri (motor YOK).
    `entry_type` debit/credit, `account` pool/accrual/payout/clawback; düzeltme = reversal (UPDATE/DELETE
    hard-block — BL-1); **deferred (DEFERRABLE INITIALLY DEFERRED) balance trigger** → `Σdebit=Σcredit` per
    `(organization_id, transaction_id)` hard-enforce; accrual **yalnız snapshot_id ile** (yapısal — SI-3;
    approved-gate Phase 6'ya ertelendi); idempotent accrual `unique(snapshot_id, employee_id, account)`; bu
    dilimde yalnız `bonus_accrual` + `reversal` yazılabilir (payout/clawback/approval event'leri guard'lı);
    raw SELECT **yalnız Finance + Auditor** (HR/Employee/Manager/**Support** hariç — SI-12); server-only
    writes; same-org composite FK'ler (pool/run/snapshot/employee); INSERT audit (BL-4). BL-2/BL-3 seed/test-verified.
    Kod: `migrations/0014_bonus_ledger.sql`, `tests/0008_phase3_bonus_ledger.test.sql` (commit `71e68f7`).
    **Verified 2026-07-26** (`db reset` 0001..0014 + seed; `test db` Files=8 Tests=328 PASS Failed=0).
    ADR-005/006/017/018, D2/AD6/BL-1..4/SI-3/SI-12 kanıtlı. (Ayrıca `docs/adr/ADR-020` markdownlint — commit `53d90de`.)
  - **Phase 3 — disputes + dispute_events** [VERIFIED/DONE]: itiraz yaşam döngüsü (container; motor YOK).
    `disputes` **mutable state machine** (open→under_review→needs_info→under_review→resolved→closed — doc 16 §6);
    yasak geçişler + open sonrası kimlik immutability; `dispute_events` **append-only** ve **SECURITY DEFINER
    trigger ile otomatik** yazılır (her INSERT/status-transition'da; `actor_id=auth.uid()`), authenticated
    doğrudan yazamaz. **D9:** stored `decision_owner_id` + `owns_review_decision()` + CHECK'ler
    (`reviewer ≠ owner`, `reviewer ≠ complainant`) + resolve RLS `NOT owns_review_decision`. **HR-only assign
    `has_role('hr')` ile** (yeni `dispute.assign` permission **eklenmedi** — test 0001 permission-katalog sayımı
    korunacak, 0001..0008 değiştirilemez). `due_at` stored + sanity CHECK (iş-günü hesabı ertelendi — OQ-DP-1).
    RLS: complainant + assigned reviewer + HR + Auditor; **Finance/Support hariç**. `target_id` polymorphic (FK
    yok). Kod: `migrations/0015_disputes.sql`, `tests/0009_phase3_disputes.test.sql` (commit `1bf63fe`).
    **Verified 2026-07-26** (`db reset` 0001..0015 + seed; `test db` Files=9 Tests=388 PASS Failed=0).
    D9/SI-6/SI-7 ve ADR-006 kanıtlı.
  - **Phase 3 — anti_gaming_flags** [VERIFIED/DONE]: 5 deterministik kural flag'i (container; DETECTION motoru
    YOK). `anti_gaming_flags` **mutable review lifecycle** (open→reviewing→confirmed|dismissed — doc 16 §7);
    yasak geçişler (skip/reviewing→open/terminal) + oluşturma sonrası kimlik immutability; review-consistency +
    `reviewed_by ≠ subject`. **D5 "otomatik ceza yok" yapıyla:** tablo tüm ledger'lardan izole — point_ledger/
    bonus_ledger/bonus_*/compensation'a FK/trigger/yazım **yok**; `confirmed` yan-etkisiz (test: ledger satır
    sayısı değişmez). **INSERT server-only**; review = `has_role('hr') OR manages_team(team_of(subject))`
    (**`flag.review` permission eklenmedi** — test 0001 permissions=20 korunacak, 0001..0009 değiştirilemez);
    `related_task_id` FK'sız; **`bonus_period_id` (FK'sız) Phase 7-A (`0023`)'te eklendi** (period-scoped
    idempotency). RLS: subject-own + own-team Manager + HR + Auditor;
    **Finance/Support hariç**. Kod: `migrations/0016_anti_gaming_flags.sql`, `tests/0010_phase3_anti_gaming_flags.test.sql`
    (commit `0c813e9`). **Verified 2026-07-31** (`db reset` 0001..0016 + seed; `test db` Files=10 Tests=427 PASS
    Failed=0). D5/SI-6/SI-7 ve ADR-006 kanıtlı.
  - **Phase 3 — notifications** [VERIFIED/DONE]: kullanıcı bildirim kutusu (delivery sink; DELIVERY motoru YOK).
    `notifications` **recipient-only** — tek-yön `unread→read` yaşam döngüsü (`read` terminal, `read→unread`
    reddedilir); recipient **kendi** bildirimini read yapar, `read_at` **server-stamp**; oluşturma sonrası kimlik
    (org/recipient/type/payload/link/created_at) immutable. **INSERT server-only** (service_role); **client DELETE
    yok ve `prevent_delete` yok** — kişisel-veri, **retention/TTL V1'e ertelendi** (OQ-DD-3). **Audit trigger yok**
    (§429). **Yeni permission/rol yok** (permission-katalog 20 korunur). **type enum yok** (non-empty CHECK);
    `payload` JSON object; read-consistency CHECK; same-org composite FK `(organization_id, recipient_id) →
    memberships`. RLS: **recipient-only SELECT/UPDATE** — **HR/Auditor/Manager/Finance/Support hariç**. Kod:
    `migrations/0017_notifications.sql`, `tests/0011_phase3_notifications.test.sql` (commit `fe1b81e`).
    **Verified 2026-07-31** (`db reset` 0001..0017 + seed; `test db` Files=11 Tests=475 PASS Failed=0).
    **Hariç:** email/push/realtime delivery motoru, notification preferences, retention job, app/UI/API.
  - **Phase 3 — exports** [VERIFIED/DONE]: payout export kaydı/container (GENERATION motoru YOK). `exports`
    **Finance INSERT** mevcut `payout.export` izniyle (yeni izin yok — katalog 20), **actor integrity
    `exported_by = auth.uid()`** (spoofing yok). **`snapshot_id` NOT NULL** (SI-3/INV-7). **AD6/SI-15 gate:**
    SECURITY DEFINER trigger `snapshot.calculation_run_id → bonus_allocations` üzerinde
    `pending_missing_cap_basis` (status **veya** cap_applied) varsa export'u bloklar — yalnız snapshot satırına
    bakmaz. **E:** `exports.bonus_period_id` = snapshot period. **Append-only client posture** (authenticated
    UPDATE/DELETE yok) + **`prevent_delete`** retention; **audit on INSERT**. RLS: **Finance + Auditor SELECT** —
    **HR/Manager/Employee/Support hariç**. Kod: `migrations/0018_exports.sql`, `tests/0012_phase3_exports.test.sql`
    (commit `b66350d`). **Verified 2026-07-31** (`db reset` 0001..0018 + seed; `test db` Files=12 Tests=523 PASS
    Failed=0). **Hariç:** export generation motoru, CSV/XLSX/storage, checksum hesabı, status progression motoru,
    period=`approved` gate (export engine'e ertelendi), bonus_ledger `payout_exported`/`payout_marked_paid`,
    mark-paid, Finance aggregate `v_finance_*`, notifications, app/API/UI.
  - **Phase 3 DB foundation TAMAMLANDI** ✅: 12 migration (`0001..0018`) + 12 bloklayıcı pgTAP suite
    (`0001..0012`, Tests=523) verified/committed. Yeni tablo dilimi kalmadı.
  - **Phase 3.5 — App foundation scaffold** [VERIFIED/DONE] (commit `a8b05ac`, 2026-07-31): Next.js 16.2.12 +
    React 19 + TS strict + App Router. Supabase CLI devDep korundu, `package-lock` regenerated (merge).
    Supabase clients: browser anon, server anon cookie (RLS-enforced), **guarded+unused service_role admin**
    (`import 'server-only'`; client import yok; NEXT_PUBLIC sızıntı yok — SI-11). Auth `@supabase/ssr` +
    `auth.getUser()`; **authz DB/RLS kaynaklı, JWT identity-only** (AD1); single active org (membership/cookie,
    switcher ertelendi). `proxy.ts` (Next 16, deprecated `middleware.ts` yerine); `turbopack.root`/
    `outputFileTracingRoot` proje köküne pinlendi. Tailwind + shadcn base UI; Zod `validatedAction`; shell
    rotaları (login/auth callback/guarded dashboard/unauthorized/health/error/not-found). Vitest 13 test +
    Playwright config; CI `npm ci`+typecheck+lint+unit (**E2E/pgTAP CI ertelendi**). **Sentry placeholder only** —
    env + `instrumentation.ts` no-op; **`@sentry/nextjs` SDK Next 16 uyumsuzluğu nedeniyle ertelendi**.
    **Doğrulama:** typecheck → PASS, lint → PASS, test → PASS (4 files, 13 tests), build → PASS (workspace-root +
    deprecated-middleware uyarısı yok). **Hariç:** Phase 4 domain logic, scoring/bonus/export/notification
    engine'leri, production deploy.
  - **Phase 4 — Task & Review Core (DB çekirdeği)** [VERIFIED/DONE] (commit `148667e`, 2026-08-01): `tasks` +
    `task_events` + `task_reviews`. `tasks` **status machine** (draft→…→approved|rejected; cancelled/archived) —
    yasak geçişler (skip-state/`approved→in_progress`/mid-state insert) + **DELETE yasak**. `task_events`
    **auto-written append-only history** (`log_task_event`; AD4; UPDATE/DELETE yasak). `task_reviews`
    **append-only karar** — **review-driven transition**: task_reviews INSERT, SECURITY DEFINER
    `apply_review_to_task` ile task status'unu uygular; **doğrudan client approve/reject/needs_revision
    reddedilir**. **Self-approval hard block (AD4):** reviewer_id<>assignee (review INSERT + tasks CHECK + belt).
    **D3:** approve⇒quality<>poor (CHECK). **AD4 timing** (submitted_at/`revision_count`) test-kanıtlı.
    `complexity/impact/quality/timeliness` enum'ları doc 04'ten. Same-org composite FK'ler
    (team/assignee/creator/reviewer/policy-version; events/reviews→tasks; actor→memberships). RLS: assignee/
    creator/reviewer/`manages_team`/HR/Auditor + **support-grant top-level OR** (support üyeliksiz → ayrı OR);
    events/reviews task görünürlüğünü miras alır; **Finance ham task/review/event göremez** (SI-12). **Yeni
    permission yok** (task.create/assign/submit/review; katalog 20). Phase 4'te approve ledger yazmazdı; **Phase 5
    (0020) artık approve'da tek `task_approved` satırı yazar** (0013 bu doğruyu test eder). Kod:
    `migrations/0019_tasks_events_reviews.sql`, `tests/0013_phase4_tasks_reviews.test.sql`. **Verified 2026-08-01**
    (`db reset` 0001..0019 + seed; `test db` Files=13 Tests=591 PASS Failed=0). **Ertelenen:**
    `task_assignments`/`task_comments`/`task_attachments` (+storage), submit/review **Server Actions + UI** (ayrı yetki).
  - **Phase 5 — Scoring Engine** [VERIFIED/DONE] (commit `aa47e40`, 2026-08-01): görev `approved` olunca
    **deterministik server-side scoring**. `point_ledger`'a `task_id` (nullable) + `task_approved` event;
    `tasks.final_points`→**numeric**. **SECURITY DEFINER BEFORE UPDATE** trigger (`score_task_on_approve`,
    validate'ten sonra) approved geçişinde kilitli **published** policy version multipliers + `revision_penalty_rule`'dan
    `final_points = base·complexity·impact·quality·timeliness·(1−min(rev·0.05,0.25))` hesaplar (doc 04),
    `NEW.final_points`'i set eder, tek `task_approved` kazanç satırını yazar (breakdown `metadata`'da). **SI-1:**
    partial unique index — task başına tek satır. **Raw numeric, yuvarlama yok.** **AD4:** timeliness onaylayan
    review'dan (geç onay cezalandırmaz). **AD5:** collaboration yalnız metadata. **D3:** approve+poor scoring'den
    önce reddedilir. **AD7:** draft version score edemez. Güvenilir direct-approve (review'suz) **atlar**;
    review-driven approve'lar score eder. Seed'de published `d2`/`b-d2` multipliers + penalty rule doc-04
    değerleriyle dolduruldu (INSERT'te; published-immutability UPDATE'i engeller). **Finance ham point_ledger'dan
    hariç** (SI-12); **server-only** (SI-11); **yeni permission yok** (katalog 20); **bonus değişikliği yok**. Kod:
    `migrations/0020_scoring_engine.sql`, `tests/0014_phase5_scoring.test.sql`. **Verified 2026-08-01** (`db reset`
    0001..0020 + seed; `test db` Files=14 Tests=626 PASS Failed=0). **Ertelenen (5-b):** manual override/adjustment
    (`point.override` 2-step → `manual_adjustment`); breakdown UI.
  - **Phase 6 — Bonus Engine (Safe Pro-Rata calculation)** [VERIFIED/DONE] (commit `0c54fba`, 2026-08-09):
    `run_bonus_calculation()` SECURITY DEFINER server-only motoru mevcut `0013` container'larını doldurur.
    Locked period + locked pool (AD10); approved point'ler `point_ledger task_approved` × `tasks.approved_at`
    period içi; Safe Pro-Rata (`W_individual=1.0`, malus yok — D1/D2); cap = `compensation_records.cap_basis` ×
    `cap_rate` × proration (eksik → `pending_missing_cap_basis`, unlimited cap yok — AD6); T_org + AD8 top-up;
    largest-remainder kuruş (tie-break `employee_id`); `bonus_allocations` + **immutable** snapshot yazar; run
    completed (freeze) + period **locked→calculated**; idempotent `(org, key)`; `Σfinal+undistributed=pool_ref`
    (SI-13). **`bonus_ledger` accrual → Phase 6-b** (`a65013d`); yeni permission yok (katalog 20); Finance
    raw-excluded (SI-12). Kod: `migrations/0021_bonus_engine.sql`, `tests/0015_phase6_bonus_engine.test.sql`.
    **Verified 2026-08-09** (`db reset` 0001..0021 + seed; `test db` **Files=15 Tests=665 PASS Failed=0**;
    `09` §8 worked example birebir). Tek in-slice **test-only** fix: `s.top_up_applied` (ambiguous kolon).
  - **Phase 6-b — Bonus Ledger Accrual** [VERIFIED/DONE] (commit `a65013d`, 2026-08-09):
    `post_bonus_accrual()` SECURITY DEFINER server-only, mevcut `bonus_ledger` (0014) container'ına yazar (yeni
    tablo/permission yok — katalog 20). **Snapshot-approval boundary (ADR-006):** approval = `bonus_periods`
    **`calculated→approved`** (mevcut geçiş; HR/`period.manage`; validator değişmedi; audit'li). Snapshot **tam
    immutable kaldı** (approval period-level). Engine: approved period + **tek completed run** (OQ-5 fail-closed) →
    **AD6 gate** (allocation `pending_missing_cap_basis` → blok) → **tek balanced accrual** (`debit pool = Σfinal` /
    `credit accrual` per employee); idempotent per snapshot. **BL-1** append-only; **Σdebit=Σcredit** (0014); **BL-2**
    yeni deferred trigger `Σaccrual ≤ pool_ref` (AD8-aware); **BL-3** payout fazına ertelendi (OQ-2). OQ-1 approval+
    posting iki adım; OQ-3 onay audit_logs ile. Finance+Auditor raw read; server-only (SI-12). Kod:
    `migrations/0022_bonus_ledger_accrual.sql`, `seed` (Org C auditor), `tests/0016_phase6b_bonus_ledger_accrual.test.sql`.
    **Verified 2026-08-09** (`db reset` 0001..0022 + seed; `test db` **Files=16 Tests=690 PASS Failed=0**; worked
    example accrual birebir). İki in-slice **test-only** fix (Section A org-scope + `::bigint` cast).
    (Ayrıca docs hijyen: `17a964d` (ADR-014+Decision Lock), `98c0b59` (ADR-006+017) — repo temizliği.)
  - **Phase 6-d — Bonus Engine Authz Hardening** [VERIFIED/DONE] (commit `0b8b34a`, 2026-08-09):
    `run_bonus_calculation` (0021) + `post_bonus_accrual` (0022) giriş-authz'ı
    `has_permission('period.manage') OR current_user not in ('authenticated','anon')` idi; **SECURITY DEFINER
    içinde `current_user` = fonksiyon sahibi** (postgres, çağıran değil) → ikinci clause her zaman TRUE →
    `period.manage` **fiilen hiç zorlanmıyordu** (latent authz zayıflığı). `0024_authz_hardening.sql` her iki
    fonksiyonu **`CREATE OR REPLACE` ile, gövde/mantık/formül/ledger/imza birebir korunarak** yeniden tanımlar;
    **yalnızca** authz clause'u `current_user not in (...)` → **`auth.uid() IS NULL`** olur (0023'teki doğru
    "trusted server/job = authenticated JWT identity yok" sinyali). İmza aynı → **mevcut GRANT + COMMENT korunur**
    (aynı OID); **yeni tablo/permission yok** (katalog 20); seed değişmez; **0023'e dokunulmaz**; migration
    **idempotent** (`CREATE OR REPLACE`). Davranış = tek yönlü sıkılaştırma (authenticated + `period.manage`'siz →
    `42501`); app/client çağırmıyor → çağıran kırılmaz; **AD1** ile daha uyumlu. Kod:
    `migrations/0024_authz_hardening.sql`, `tests/0018_phase6d_authz_hardening.test.sql`. **Verified 2026-08-09**
    (`db reset` 0001..0024 + seed; `test db` **Files=18 Tests=720 PASS Failed=0**; **regresyon yok** — 0015/0016
    engine çağrıları trusted (`auth.uid()` null) bağlamda geçer). Test: (a) Finance c4 → `42501`; (b) HR c3 →
    authz geçer, `23503`; (c) trusted context → authz geçer, `23503` (her iki fonksiyon). AD1 kanıtlı.
  - **Phase 7-A — Anti-Gaming Detection Engine** [VERIFIED/DONE] (commit `ffdea06`, 2026-08-09; plan
    `docs/planning/19`): `run_anti_gaming_scan(org, bonus_period_id?)` **SECURITY DEFINER, server-only**
    orkestratör, mevcut `anti_gaming_flags` (0016) container'ına flag üretir (yeni tablo/permission yok —
    katalog 20). Dört `detect_*` **deterministik kural**: **duplicate_task** (aynı assignee + normalize
    `lower(btrim(title))` 24h → sonraki task'e flag); **tiny_task_splitting** (aynı assignee ≥3 task
    `base_points<5` 1h); **same_reviewer_concentration** (period içi bir reviewer payı >0.80 ve toplam ≥3
    approval); **period_end_spike** (son-3-gün `task_approved` point gain > 3× period günlük ortalaması).
    Eşikler **hardcoded** (OQ-1; `organization_settings` kolon V1). **OQ-2 dual idempotency:** `anti_gaming_flags`'a
    **FK-less `bonus_period_id`** kolonu + **iki partial unique index** (task-scoped `(org, rule, subject,
    related_task_id)` / period-scoped `(org, rule, subject, bonus_period_id)`); re-scan flag eklemez. **OQ-3:**
    detection yalnız explicit `run_anti_gaming_scan()` çağrısıyla (HR/job); approve anında otomatik değil.
    **D5 izolasyon (BY CONSTRUCTION):** detect fonksiyonları `tasks`/`task_reviews`/`point_ledger`/`bonus_periods`
    **okur**, **yalnız `anti_gaming_flags`'a yazar** — point_ledger/bonus_ledger/bonus_*/compensation'a
    yazım/FK/trigger **yok**; bir scan **finansal yan-etki üretmez** (test-kanıtlı: ledger satır sayısı değişmez);
    no auto-punish / no auto-dispute (human-in-loop). **Authz:** `has_role('hr') OR auth.uid() IS NULL` (güvenilir
    sunucu/job); non-HR authenticated `42501`; `detect_*` grant yalnız service_role. Kod:
    `migrations/0023_anti_gaming_detection.sql`, `tests/0017_phase7a_anti_gaming_detection.test.sql`.
    **Verified 2026-08-09** (`db reset` 0001..0023 + seed; `test db` **Files=17 Tests=712 PASS Failed=0**;
    her kural pozitif/negatif + idempotency + D5 no-side-effect + server-only). Bir in-slice **migration fix:**
    authz `current_user`-tabanlıydı — SECURITY DEFINER'da `current_user`=owner olduğundan etkisizdi;
    `auth.uid() IS NULL`-tabanlı kontrole çekildi. D5/OQ-1..OQ-3 kanıtlı. **Not:** `run_bonus_calculation` (0021) +
    `post_bonus_accrual` (0022) aynı latent `current_user` authz zayıflığını taşıyordu → **Phase 6-d (`0b8b34a`)'te
    çözüldü** (yukarı bkz.); artık 0021/0022/0023'ün üçü de aynı doğru deseni kullanıyor.
  - **Phase 7 (kalan) — dispute post-decision** [GATED]: **7-B** dispute→point_ledger `dispute_adjustment`
    (`0025`/`tests/0019`); **7-C** recalculation (superseded old run + period `approved→calculated` re-approval +
    yeni run/snapshot + paid-accrual guard OQ-4/D2 → bonus_ledger reversal + yeni accrual) (`0026`/`tests/0020`).
    *(Phase 6-d `0024`'ü aldığından dispute migration numaraları `0024`/`0025` → `0025`/`0026` kaydı; doc-19 §9.)*
    Ara-dilim **0021/0022 authz hardening** → **Phase 6-d'de yapıldı (`0b8b34a`)**. Kalan ara-dilim: **payout/export
    engine** (`payout_exported`/`payout_marked_paid` + `v_finance_*` + BL-3 hard-enforce) + UI/API. Her dilim/faz
    ayrı `implementation authorized` ister. **Kod-yazmadan-önce scope-lock** önerilir (ADR-020). **Henüz yetkili değil.**

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
- Status: **7-A Anti-Gaming Detection Engine ✅ VERIFIED/DONE** (commit `ffdea06`, 2026-08-09;
  `run_anti_gaming_scan()` + 4 detect_* kuralı; D5 izolasyon — flag yazar, ledger'a dokunmaz; dual idempotency
  OQ-2; Files=17/Tests=712/PASS).
  **Kalan gated:** 7-B dispute point adjustment (`0025`) + 7-C bonus recalculation (`0026`). Ara-dilim
  0021/0022 authz hardening **Phase 6-d'de yapıldı** (`0b8b34a`). Her dilim ayrı `implementation authorized` ister.

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
