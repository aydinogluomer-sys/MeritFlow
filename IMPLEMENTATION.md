# MeritFlow — Implementation Status & TODO

> **Yaşayan durum/todo takip dosyası.** Detaylı "neden/nasıl" için kaynak: `docs/planning/` (00–18),
> `docs/adr/` (ADR-001…020), `CLAUDE.md`. Çelişki olursa `docs/planning/00_DECISION_LOCK.md` kazanır.
> Bu dosya **kod değildir**; yalnızca nerede olduğumuzu ve ne yapacağımızı izler.
> Son güncelleme: 2026-07-31 (exports foundation runtime verified + committed + docs sync — **Phase 3 DB foundation tamamlandı**).

## 0. Yönetişim kuralı (her şeyden önce)

- **Kod yalnız kullanıcı tam cümleyle yetki verince yazılır** (ADR-020): `implementation authorized only for Phase X — <slice>`.
- **İzin faz/dilim-sınırlıdır** — bir dilimin onayı sonrakini kapsamaz.
- Her tenant tablosu **aynı dilimde** RLS ENABLE+FORCE + policy + bloklayıcı pgTAP ile gelir ("tablo şimdi, RLS sonra" yasak — doc 18 §11).
- DB komutları yalnız **local dev/staging**; production'a asla (ADR-014).

Durum işaretleri: ✅ done/verified · 🟡 committed (verify bekliyor) · ⛔ gated (henüz yetki yok) · ⬜ başlanmadı.

---

## 1. Nerede olduğumuz (özet)

**Planlama:** ✅ Tamamlandı. Phase 0–2 kapalı; 19 planning dokümanı (00–18), 20 ADR, `CLAUDE.md`.
Decision Lock = D1–D12 + AD1–AD10 (22 karar).

**Implementation (DB foundation, dilim-dilim yetkiyle):**

| Dilim | İçerik | Dosyalar | Durum | Kanıt |
| --- | --- | --- | --- | --- |
| Phase 3A | 11 foundation/RBAC tablosu + RLS helper + RLS + audit + seed | `migrations/0001–0007`, `seed`, `tests/0001` | ✅ verified | 38/38 pgTAP (2026-06-24) |
| Phase 3B-A | `scoring_policies` + `scoring_policy_versions` (published immutable AD7) + RLS + `policy.manage` | `migrations/0008`, `tests/0002` | ✅ verified | commit `dd9b861`; 2026-07-24 |
| Phase 3B-B | `point_ledger` (append-only, server-only, Finance excluded) + `team_of()` + RLS | `migrations/0009`, `tests/0003` | ✅ verified | commit `f46ab49`; 2026-07-24 |
| Phase 3 comp | `compensation_records` (raw SELECT closed, comp.read writes, DELETE blocked, masked write/access audit, justified `read_compensation_record`) | `migrations/0010`, `tests/0004` | ✅ verified | commit `c9cd0f2`; 2026-07-24 |
| Phase 3 bonus P/P | `bonus_periods` + `bonus_pools` (state machine, AD10 pool-lock-before-period-lock, locked t_org+metadata required, locked immutability, period identity immutability, period.manage/pool.create) | `migrations/0011`, `tests/0005` | ✅ verified | commit `d04b954`; 2026-07-24 |
| Phase 3 bonus C/E | `bonus_pool_components` + `bonus_pool_eligibility` (MVP Safe Pro-Rata individual=1.0; same-org employee via memberships composite FK; AD9 primary_team is_primary; server-only eligibility writes; inputs immutable once parent pool leaves draft) | `migrations/0012`, `tests/0006` | ✅ verified | commit `8f74e8d`; 2026-07-24 |
| Phase 3 bonus C/R/A/S | `bonus_calculation_runs` + `bonus_allocations` + `bonus_allocation_snapshots` (run state machine running/completed/superseded; AD10 locked-period+locked-pool double guard; idempotency `unique(org, idempotency_key)`; completed-run allocation freeze; thin snapshot append-only; cap-not-exceeded + pending_missing_cap_basis; approved/exported/paid blocked; server-only writes) | `migrations/0013`, `tests/0007` | ✅ verified | commit `e3bd1a3`; 2026-07-25 |
| Phase 3 bonus ledger | `bonus_ledger` (append-only double-entry money; deferred `Σdebit=Σcredit` per (org, transaction_id) balance trigger; accrual ⇒ snapshot_id; idempotent accrual; only bonus_accrual+reversal writable; Finance/Auditor raw read only, server-only writes) | `migrations/0014`, `tests/0008` | ✅ verified | commit `71e68f7`; 2026-07-26 |
| Phase 3 disputes | `disputes` + `dispute_events` (mutable state machine open→under_review→needs_info→resolved→closed; append-only auto-history trigger; D9 stored decision_owner_id + owns_review_decision; HR-only assign via has_role('hr'); due_at stored + sanity; server-only auto events; Finance/Support excluded) | `migrations/0015`, `tests/0009` | ✅ verified | commit `1bf63fe`; 2026-07-26 |
| Phase 3 anti-gaming | `anti_gaming_flags` (mutable review lifecycle open→reviewing→confirmed/dismissed; D5 no-auto-punish — isolated from all ledgers, no FK/write to point_ledger/bonus_ledger/bonus_*/compensation; review consistency + reviewer≠subject; server-only INSERT; review via has_role('hr') OR manages_team(team_of(subject)); Finance/Support excluded) | `migrations/0016`, `tests/0010` | ✅ verified | commit `0c813e9`; 2026-07-31 |
| Phase 3 notifications | `notifications` (recipient-only delivery sink; unread→read one-way lifecycle, recipient marks own read + read_at server-stamped; INSERT server-only; no client DELETE and no prevent_delete — retention/TTL V1; no audit trigger; no new permission/role; no type enum — type non-empty only; payload JSON object; same-org composite FK `(organization_id, recipient_id)→memberships`; RLS recipient-only SELECT/UPDATE — HR/Auditor/Manager/Finance/Support excluded) | `migrations/0017`, `tests/0011` | ✅ verified | commit `fe1b81e`; 2026-07-31 |
| Phase 3 exports | `exports` (payout export record/container — generation engine YOK; Finance INSERT via existing `payout.export`, actor integrity `exported_by = auth.uid()`; snapshot_id NOT NULL — SI-3; AD6/SI-15 gate via SECURITY DEFINER trigger checks `snapshot.calculation_run_id → bonus_allocations` for pending_missing_cap_basis by status OR cap_applied; `exports.bonus_period_id` = snapshot period; append-only client posture — no authenticated UPDATE/DELETE; prevent_delete retention; audit on INSERT; RLS Finance + Auditor SELECT, HR/Manager/Employee/Support excluded; no new permission — catalog stays 20) | `migrations/0018`, `tests/0012` | ✅ **verified** | commit `b66350d`; 2026-07-31 |

**Runtime verification (2026-07-31, local dev stack, npx Supabase CLI 2.109.1):** `supabase db reset`
migrations **0001..0018** + seed temiz uyguladı; `supabase test db` → **Files=12, Tests=523, Result=PASS,
Failed=0** (`0001`..`0012` ok). `db reset`'teki geçici container flake'leri (`ENOTFOUND`/timeout/"exit 1" —
vector/analytics/storage unhealthy) `supabase stop/start` (gerekirse aux servisleri `-x` ile hariç bırakıp
yalnız Postgres) + retry ile temiz geçti; kod/şema sorunu değil.

**compensation_records güvenlik özelliği (AD3/D7/SI-5):** doğrudan **raw SELECT kapalı** (SELECT policy yok;
maaş kolonları selectable değil); ham okuma **yalnız** `read_compensation_record(employee, reason)` ile
(comp.read/auditor + boş olmayan reason); **write + access audit maskeli** → ham maaş/cap `audit_logs`'a
asla düşmez.

**bonus_periods + bonus_pools invariant'ları (AD10/SI-4):** period **pool locked olmadan lock edilemez**
(AD10); locked pool **t_org + locked_at + locked_by** ister; locked pool amount/t_org **immutable** (new
version); locked/non-open period identity (dates/type/org) **immutable** (SI-4); RLS ENABLE+FORCE +
**görev ayrımı** (period.manage=owner/hr vs pool.create=finance); DELETE bloklu.

**bonus_pool_components + bonus_pool_eligibility invariant'ları (D1/D10/AD9/AD10/SI-4):** component MVP
**Safe Pro-Rata** = yalnız `individual` + weight `1.0` (D1); component/eligibility → `bonus_pools` **same-org
composite FK**; eligibility employee **aynı org üyesi olmak zorunda** (`(org, employee)` → `memberships`
composite FK → cross-tenant employee **yapısal olarak imkânsız**); `primary_team_id` same-org (teams composite
FK) + **AD9** `team_memberships.is_primary` trigger doğrulaması; 15-gün eligibility + proration cap üzerinde
(D10); eligibility yazımı **server-only** (employee-own + HR/Finance/Auditor read); component yazımı
`pool.create`; parent pool **draft'tan çıkınca** hem component hem eligibility satırları **immutable** (SI-4);
DELETE bloklu.

**bonus_calculation_runs + bonus_allocations + bonus_allocation_snapshots invariant'ları
(D1/D6/AD6/AD7/AD9/AD10/SI-4/SI-12/SI-13/SI-14):** run **yalnız locked period + locked pool** üzerinde başlar
(AD10 çift guard — referans verilen pool draft/superseded ise blok); state machine `running→completed→superseded`;
idempotency `unique(organization_id, idempotency_key)`; run **completed olunca allocation'lar blanket freeze**
(amount/status/cap/team/policy/run bağları dahil — SI-4/SI-14); snapshot **ince + append-only immutable**
(UPDATE/DELETE hard-block; per-employee detay kopyalanmaz); allocation **cap-not-exceeded** CHECK +
`cap_applied` enum (`pending_missing_cap_basis` dahil — AD6); **approved/exported/paid** yazımı bu dilimde
bloklu; tüm same-org composite FK'ler (period/pool/policy_version/run/employee/team) → cross-tenant yapısal
kapalı (SI-7); yazımlar **server-only** (employee-own allocation read; Finance raw hariç = view-only SI-12);
`Σ(final)+undistributed_remainder = pool` **hard trigger değil**, yalnız seed/test-verified (SI-13/INV-4).

**bonus_ledger invariant'ları (ADR-017/BL-1..4/SI-3/SI-12):** double-entry para defteri (`entry_type`
debit/credit, `account` pool/accrual/payout/clawback); **append-only** (UPDATE/DELETE hard-block; düzeltme =
reversal — BL-1); **deferred (DEFERRABLE INITIALLY DEFERRED) balance trigger** → `Σdebit = Σcredit` per
**(organization_id, transaction_id)** hard-enforce; accrual **yalnız snapshot_id ile** (yapısal — SI-3;
approved-gate Phase 6'ya ertelendi); idempotent accrual `unique(snapshot_id, employee_id, account)`; bu
dilimde **yalnız `bonus_accrual` + `reversal`** yazılabilir (payout/clawback/approval event'leri guard'lı);
raw SELECT **yalnız Finance + Auditor** (HR/Employee/Manager/**Support** hariç — SI-12); yazımlar
**server-only**; same-org composite FK'ler (pool/run/snapshot/employee); INSERT audit (BL-4). **Motor yok:**
posting engine / payout-export / clawback workflow yazılmadı; BL-2 (Σaccrual ≤ pool) / BL-3 (payout ≤ accrual)
yalnız seed/test-verified.

**disputes + dispute_events invariant'ları (D9/SI-6/SI-7 + ADR-006):** `disputes` **mutable state machine**
(`open→under_review→needs_info→under_review→resolved→closed`) — yasak geçişler + open sonrası kimlik
immutability (org/complainant/type/target/opened_at); `dispute_events` **append-only** ve **SECURITY DEFINER
trigger ile otomatik** yazılır (her INSERT/status-transition'da; `actor_id=auth.uid()`), authenticated
doğrudan yazamaz (UPDATE/DELETE hard-block). **D9:** stored `decision_owner_id` + `owns_review_decision()` +
CHECK'ler (`reviewer ≠ owner`, `reviewer ≠ complainant`) + resolve RLS `NOT owns_review_decision`. **HR-only
assign `has_role('hr')` ile** (yeni `dispute.assign` permission **eklenmedi** — test 0001 permission-katalog
sayımını korumak için, 0001..0008 değiştirilemez). `due_at` **stored** + `due_at > opened_at` sanity CHECK
(**iş-günü hesabı yok** — OQ-DP-1 ertelendi). RLS: complainant + assigned reviewer + HR + Auditor; **Finance/
Support hariç**. `target_id` polymorphic (FK yok). **Hariç:** point_ledger `dispute_adjustment`, recalculation
/ yeni calc run, bonus_ledger reversal/accrual, notification, reopen orkestrasyonu.

**anti_gaming_flags invariant'ları (D5/SI-6/SI-7 + ADR-006):** `anti_gaming_flags` **mutable review lifecycle**
(`open→reviewing→confirmed|dismissed`) — yasak geçişler (skip / `reviewing→open` / terminal) + oluşturma
sonrası kimlik immutability (org/rule/subject/related/evidence/created_at); review-consistency CHECK
(`confirmed|dismissed ⇒ reviewed_by+review_note`) + `reviewed_by ≠ subject`. **D5 "otomatik ceza yok"
yapıyla garanti:** tablo tüm ledger'lardan **izole** — point_ledger / bonus_ledger / bonus_* /
compensation'a **FK/trigger/yazım yok**; `confirmed` geçişi **yan-etkisiz** (test: confirm sonrası
point_ledger & bonus_ledger satır sayısı **değişmez**). **INSERT server-only** (kural motoru); review
(confirm/dismiss) = `has_role('hr') OR manages_team(team_of(subject))` (**`flag.review` permission
eklenmedi** — test 0001 permissions=20 korunacak); WITH CHECK `reviewed_by = auth.uid()`. `related_task_id`
FK'sız; **`bonus_period_id` yok** (context evidence jsonb'de). RLS: subject-own + own-team Manager + HR +
Auditor; **Finance/Support hariç**. DELETE yasak; audit insert/update. **Hariç:** detection motoru,
self-approval hard-block, anomaly_baselines/Z-score, ceza/ledger wiring, dispute/notification.

**notifications invariant'ları (14 §424-429 / 15 §139-142):** `notifications` **recipient-only delivery
sink** — kullanıcı bildirim kutusu; **tek-yön `unread→read` yaşam döngüsü** (`read` terminal, `read→unread`
reddedilir), recipient **kendi** bildirimini read yapar ve `read_at` **server-stamp**'lenir; oluşturma sonrası
kimlik (org/recipient/type/payload/link/created_at) **immutable**. **INSERT server-only** (service_role — event
üretimi motor/uygulama işi = hariç); **client DELETE yok ve `prevent_delete` yok** — bildirimler kişisel-veri,
**retention/TTL V1'e ertelendi** (OQ-DD-3), silme legal-retention yüzeyi değil (service_role ileride prune
edebilsin). **Audit trigger yok** (§429 audit: hayır). **Yeni permission/rol yok** — RLS yalnız
`current_org()` + `auth.uid()`; permission-katalog 20 korunur. **type enum yok** (yalnız non-empty CHECK);
`payload` JSON object CHECK; read-consistency CHECK. Same-org composite FK `(organization_id, recipient_id) →
memberships`. RLS: **recipient-only SELECT/UPDATE** — **HR/Auditor/Manager/Finance/Support hariç** (audit izi
`audit_logs`'ta, burada değil). **Hariç:** email/push/realtime delivery motoru, notification preferences,
retention job, app/UI/API.

**exports invariant'ları (14 §444-451 / 15 §149-152 / 16 §8; SI-3/AD6/SI-15):** `exports` **payout export
kaydı/container** — üretim (generation) motoru YOK. **Finance INSERT** mevcut `payout.export` izniyle (yeni izin
yok — katalog 20); **actor integrity: `exported_by = auth.uid()`** (Finance başka kullanıcıyı exporter olarak
kaydedemez). **`snapshot_id` NOT NULL** (SI-3/INV-7 — snapshot'sız export yok). **AD6/SI-15 gate:** SECURITY
DEFINER trigger `snapshot.calculation_run_id → bonus_allocations` üzerinde `pending_missing_cap_basis` var mı
diye bakar (status **veya** cap_applied) — yalnız snapshot satırına bakmaz; varsa export **bloklanır**. **E:**
`exports.bonus_period_id` = snapshot'ın period'u. **Append-only client posture:** authenticated **UPDATE/DELETE
yok**; **`prevent_delete`** retention (finansal iz, silinmez). **Audit on INSERT** (`exports.insert`). RLS:
**Finance + Auditor SELECT** — **HR/Manager/Employee/Support hariç**. **Hariç:** export generation motoru,
CSV/XLSX/storage yazımı, checksum hesabı, status progression motoru, **period=`approved` gate** (export
engine'e ertelendi), bonus_ledger `payout_exported`/`payout_marked_paid` wiring, mark-paid, Finance aggregate
`v_finance_*` view'ları, notifications, app/API/UI.

**App katmanı (Next.js/API/UI): ⬜ hiç başlanmadı** (repo'da `package.json` yok, sadece `supabase/`).

**✅ Doküman senkron güncel (2026-07-31):** `supabase/README.md`, `docs/planning/12`, `docs/planning/18`,
bu dosya — 0001..0018 + 3A/3B/comp/bonus-P/P/bonus-C/E/bonus-C/R/A/S/bonus-ledger/disputes/anti-gaming/
notifications/exports verified durumunu yansıtıyor. **Phase 3 DB foundation tamamlandı.** Ayrıca `docs/planning/14`
idempotency + markdownlint sync commit `dae4c6b`;
`docs/adr/ADR-020` markdownlint hijyeni commit `53d90de` ile tamamlandı.

---

## 2. Nereye gideceğiz (roadmap hatırlatma)

`docs/planning/12` fazları: **Phase 3 (DB/ledger foundation) → 4 (task/review) → 5 (scoring engine)
→ 6 (bonus engine) → 7 (anti-gaming+dispute) → 8 (dashboards/UX) → 9 (test/security) → 10 (prod)**.
Kural: güvenlik temeli (RLS/ledger) bitmeden feature fazı ilerlemez.

---

## 3. Ne yapmalıyız (todolist)

### A. Phase 3 DB foundation — tamamlanan dilimler  ✅

- [x] **3A — Foundation & RBAC** ✅ (verified 2026-06-24).
- [x] **3B-A — Scoring policy** ✅ (commit `dd9b861`, verified 2026-07-24).
- [x] **3B-B — Point ledger + `team_of` + append-only** ✅ (commit `f46ab49`, verified 2026-07-24).
- [x] **compensation_records + comp audit masking** ✅ (commit `c9cd0f2`, verified 2026-07-24; raw SELECT closed, justified read, masked audit).
- [x] **bonus_periods + bonus_pools** ✅ (commit `d04b954`, verified 2026-07-24; state machine, AD10 pool-lock, locked t_org+immutability, period identity immutability).
- [x] **bonus_pool_components + bonus_pool_eligibility** ✅ (commit `8f74e8d`, verified 2026-07-24; MVP individual=1.0 — D1; same-org employee via memberships composite FK; AD9 is_primary; server-only eligibility writes; inputs immutable once parent pool leaves draft — SI-4).
- [x] **bonus_calculation_runs + bonus_allocations + bonus_allocation_snapshots** ✅ (commit `e3bd1a3`, verified 2026-07-25; run machine + AD10 locked-period+locked-pool guard; idempotency `unique(org, key)`; completed-run allocation freeze; thin snapshot append-only; cap-not-exceeded + pending_missing_cap_basis; approved/exported/paid blocked; server-only).
- [x] **bonus_ledger (double-entry money)** ✅ (commit `71e68f7`, verified 2026-07-26; append-only; deferred `Σdebit=Σcredit` per (org, transaction_id) balance trigger; accrual ⇒ snapshot_id; idempotent accrual; only bonus_accrual+reversal writable; Finance/Auditor raw read only — HR/Employee/Manager/Support excluded; server-only; no posting engine / payout-export / clawback).
- [x] **disputes + dispute_events** ✅ (commit `1bf63fe`, verified 2026-07-26; mutable state machine + open sonrası identity immutability; append-only auto-history trigger; D9 stored decision_owner_id + owns_review_decision + reviewer≠owner/complainant CHECK; HR-only assign via has_role('hr') — no dispute.assign permission; due_at stored + sanity; Finance/Support excluded; no ledger/recalc/notification wiring).
- [x] **anti_gaming_flags** ✅ (commit `0c813e9`, verified 2026-07-31; mutable review lifecycle open→reviewing→confirmed/dismissed; D5 no-auto-punish — isolated from all ledgers, no FK/write to point_ledger/bonus_ledger/bonus_*/compensation, confirm inert & test-proven; review consistency + reviewer≠subject; server-only INSERT; review via has_role('hr') OR manages_team(team_of(subject)) — no flag.review permission; no bonus_period_id; related_task_id FK-less; Finance/Support excluded).
- [x] **notifications** ✅ (commit `fe1b81e`, verified 2026-07-31; recipient-only delivery sink; unread→read one-way lifecycle, recipient marks own read + read_at server-stamped; INSERT server-only; no client DELETE and no prevent_delete — retention/TTL V1; no audit trigger; no new permission/role; no type enum — type non-empty only; payload JSON object; same-org composite FK `(organization_id, recipient_id)→memberships`; RLS recipient-only SELECT/UPDATE — HR/Auditor/Manager/Finance/Support excluded).
- [x] **exports** ✅ (commit `b66350d`, verified 2026-07-31; payout export record/container — generation engine YOK; Finance INSERT via existing `payout.export`, actor integrity `exported_by = auth.uid()`; snapshot_id NOT NULL — SI-3; AD6/SI-15 gate via SECURITY DEFINER trigger on `snapshot.calculation_run_id → bonus_allocations` (pending_missing_cap_basis by status OR cap_applied); `exports.bonus_period_id` = snapshot period; append-only client posture — no authenticated UPDATE/DELETE; prevent_delete retention; audit on INSERT; RLS Finance + Auditor SELECT — HR/Manager/Employee/Support excluded; no new permission — catalog 20).
- [x] Docs/status sync (README + roadmap 12 + doc 18 + bu dosya). Ayrıca `docs/planning/14` idempotency+markdownlint sync (commit `dae4c6b`); `docs/adr/ADR-020` markdownlint (commit `53d90de`).

### B. Kalan Phase 3 DB-foundation dilimleri (SQL-only, app gerektirmez)  ✅ tamamlandı

> Her dilim = tablo(lar) + RLS ENABLE+FORCE + policy + bloklayıcı pgTAP + additive seed, **aynı dilimde**.

- [x] **Phase 3 DB foundation tamamlandı** — `exports` (commit `b66350d`) son dilimdi; 12 migration (`0001..0018`) + 12 bloklayıcı pgTAP suite (`0001..0012`, Tests=523) verified. Yeni tablo dilimi kalmadı; sıradaki büyük adım **app scaffold / Phase 4** (aşağıda C/D).
- [ ] (Ops., ileride) **projects**, **objectives** — minimal; yalnız ilgili feature fazı gerektirdiğinde, ayrı yetkiyle.

### C. App foundation (feature fazlarının ön koşulu)  ⛔/⬜

- [ ] **Next.js + TypeScript scaffold** — `package.json`, App Router, Server Actions, Zod, Tailwind + shadcn/ui, Supabase client (anon/server ayrımı, service-role env-only), Vitest + Playwright iskeleti, Sentry.
- [ ] Auth akışı (Supabase Auth) + org bağlamı (`current_org`) + RBAC okuması DB'den (AD1).

### D. Feature fazları (roadmap 4–10)  ⛔ her faz ayrı yetki

- [ ] **Phase 4 — Task & Review Core**: tasks ailesi tabloları (RLS'li) + submit→review + self-approval block + submission/revision history (AD4).
- [ ] **Phase 5 — Scoring Engine**: `04` motoru; approve→point_ledger (`task_approved` event + `task_id` + idempotency index bu fazda eklenir); timeliness=submitted_at (AD4); collaboration puanı etkilemez (AD5); breakdown.
- [ ] **Phase 6 — Bonus Engine**: `05` motoru; pro-rata + cap (compensation_records cap basis) + T_org(+top-up AD8) + kuruş/largest-remainder + Σ invariant + immutable snapshot; `09` worked example reproduce.
- [ ] **Phase 7 — Anti-Gaming & Disputes**: 5 deterministik kural (flag→review, no auto-punish) + dispute workflow (HR atama, 5 iş günü, manager final değil) + recalculation.
- [ ] **Phase 8 — Dashboards & UX**: 5 rol ekranı + 2 leaderboard görünümü; her puan/prim açıklanabilir; estimated/final ayrımı.
- [ ] **Phase 9 — Testing & Security**: tam suite; cross-tenant + self-approval bloklayıcı; AD1–AD10 testleri; audit coverage.
- [ ] **Phase 10 — Production Readiness**: monitoring, audit export, deploy checklist, support access workflow.

---

## 4. Kalıcı hatırlatmalar / riskler

- Puan client'tan gelmez; point ledger append-only; düzeltme = reversal (ADR-005).
- Bonus snapshot olmadan payout/export yok; snapshot immutable (ADR-006).
- Malus/clawback = approval workflow, otomatik kesinti yok (D2).
- `compensation_records`: doğrudan raw SELECT yok; ham okuma reason + masked access audit ister; employee'ye kapalı (D7/AD3).
- Bonus: period pool locked olmadan lock edilemez (AD10); locked pool/period sessizce mutate edilemez (SI-4).
- Primary team tek kaynak: `team_memberships.is_primary` — `memberships.primary_team_id` **eklenmez** (AD9).
- KVKK / Türkiye iş hukuku = legal-review item (uzman onayı; kesin hüküm verilmez).

---

## 5. Önerilen ilk adım

Phase 3 exports foundation **verified + committed + synced** (commit `b66350d`;
db reset 0001..0018 + seed, test db Files=12/Tests=523/PASS). Payout export record/container — generation
engine YOK; Finance INSERT via existing `payout.export` + actor integrity `exported_by = auth.uid()`;
snapshot_id NOT NULL; AD6/SI-15 gate via SECURITY DEFINER trigger on `snapshot.calculation_run_id →
bonus_allocations` (pending_missing_cap_basis by status OR cap_applied); `exports.bonus_period_id` = snapshot
period; append-only client posture (no authenticated UPDATE/DELETE) + prevent_delete retention; audit on INSERT;
RLS Finance + Auditor SELECT — HR/Manager/Employee/Support hariç. **Bununla Phase 3 DB foundation TAMAMLANDI**
(12 migration `0001..0018`, 12 pgTAP suite `0001..0012`, Tests=523).

**Sıradaki büyük adım = uygulama katmanı.** Yeni tablo dilimi kalmadı; doğal ilerleme:
**App foundation scaffold** (Next.js + TypeScript, App Router, Server Actions + Zod, Tailwind + shadcn/ui,
Supabase client anon/server ayrımı + service-role env-only, Vitest + Playwright iskeleti, Sentry) ve ardından
**Phase 4 — Task & Review Core**. Her ikisi de **kod-yazmadan-önce scope-lock** ister; app scaffold DB dilimi
değildir (yeni faz), bu yüzden ayrı, faz-sınırlı yetki gerekir (ADR-020).

**Henüz yetkili değil.** Başlatmak için (önce scope-lock önerilir) yetki cümlesi (örnek):

`implementation authorized only for Phase 3.5 — app foundation scaffold`  (veya)
`implementation authorized only for Phase 4 — task & review core`

> Bu cümle gelene kadar hiçbir kod/migration/test yazılmaz; sonraki her faz/dilim ayrı, faz-sınırlı yetki ister (ADR-020).
