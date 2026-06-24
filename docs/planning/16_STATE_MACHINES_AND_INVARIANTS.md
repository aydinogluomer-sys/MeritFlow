# 16 — State Machines & Invariants (Pre-Migration)

> Phase 2 finalizasyon. Durum makinelerini ve sistem invariant'larını **migration'a hazır** kesinlikte
> sabitler. **DDL/SQL içermez.** Decision Lock (D1–D12 + AD1–AD10) bağlayıcıdır. State machine'ler
> `02_DOMAIN_MODEL` ile tutarlıdır; bu doküman onları aktör/audit/ledger/notification/test boyutlarıyla
> kesinleştirir.

## Purpose

9 kritik state machine'i (task, review, bonus period, calculation run, allocation, dispute, anti-gaming
flag, export, support grant) ve sistem invariant'larını; izin verilen/yasak geçiş, zorunlu aktör, audit,
ledger etkisi, notification etkisi, edge case ve test boyutlarıyla tanımlamak.

## Scope

- Kapsam: MVP state machine'leri + invariant'lar.
- Kapsam dışı: implementasyon (trigger/guard kodu — Phase 3), engine matematiği (`04`/`05`).

## Konvansiyon

- "required actor" = geçişi tetikleyebilen rol/özne. "audit" = geçiş `audit_logs` üretir mi.
- "ledger impact" = point/bonus ledger etkisi. "notification" = kime bildirim.
- Tanımsız geçişler **örtük yasaktır**; "forbidden" yalnız kritik olanları vurgular.

---

## 1. Task status machine

- **states:** `draft, assigned, in_progress, submitted, needs_revision, approved, rejected, cancelled, archived`.
- **allowed transitions:**
  - `draft → assigned` (Manager atar)
  - `assigned → in_progress` (Employee başlar)
  - `in_progress → submitted` (Employee submit; `submitted_at` set — AD4 referansı)
  - `submitted → needs_revision → in_progress` (reviewer revizyon ister; revision_count++, `last_valid_submitted_at` korunur)
  - `submitted → approved` (reviewer; **yalnız quality ≥ acceptable**, D3)
  - `submitted → rejected` (reviewer)
  - `assigned|in_progress → cancelled`
  - `approved|rejected|cancelled → archived`
- **forbidden transitions:** `submitted → approved` reviewer = assignee iken (**self-approval block**);
  `→ approved` quality = poor iken (D3); period `locked` iken herhangi mutation; `approved → in_progress`
  (geri alma yok — düzeltme dispute/reversal ile); skip-state (örn. `draft → approved`).
- **required actor:** atama/review = Manager (kendi takım, `task.review`); submit = Employee (kendi görevi).
- **audit:** `approved`/`rejected`/override → **evet** (`task.approve`/`task.reject`/`point.manual_adjustment`).
- **ledger impact:** `approved` → **point_ledger `task_approved`** (idempotent, tek satır — INV-1); diğer geçiş ledger yazmaz.
- **notification:** atama → assignee; needs_revision/approved/rejected → assignee; submit → reviewer.
- **edge cases:** ikinci approve denemesi idempotent (ikinci entry yok); `due_date null` → timeliness `on_time`
  varsayım; needs_revision sonrası tekrar submit → timeliness son geçerli submission'dan (AD4); reviewer
  takımdan ayrılır → reassign (OQ-DM-1).
- **tests:** submitted→puan yok; approved→tek ledger entry; self-approval reddi; quality=poor approve reddi;
  locked period mutation reddi; çift approve idempotency.

## 2. Task review machine

- **states (decision):** `pending → (approve | needs_revision | reject)`.
- **allowed transitions:** reviewer queue'dan görür → bir karar verir; needs_revision döngüde tekrar review üretir.
- **forbidden transitions:** `reviewer_id = assignee_id` (self-review/approval — hard block); `approve` with quality=poor (D3);
  başka takım manager'ının review'i; period locked sonrası yeni review.
- **required actor:** reviewer = `task.review` izni + kendi takım (`manages_team`) + ≠ assignee.
- **audit:** her karar → **evet**. **ledger impact:** approve → scoring engine → point_ledger; reject/needs_revision → yok.
- **notification:** karar → assignee (breakdown ile approve'ta).
- **edge cases:** manual timeliness override → reason + audit; collaboration_score girilir ama **puanı etkilemez** (AD5).
- **tests:** self-approval reddi; quality=poor approve reddi; collaboration farkı aynı final_points (AD5); geç onay timeliness düşürmez (AD4).

## 3. Bonus period machine

- **states:** `open, locked, calculated, approved, exported, closed`.
- **allowed transitions:**
  - `open → locked` (HR; **pool önceden locked olmalı** — AD10; pending task/dispute kontrolü)
  - `locked → calculated` (calculation run + snapshot üretildi)
  - `calculated → approved` (HR snapshot approve)
  - `approved → exported` (Finance payout export)
  - `exported → closed` (dönem kapanır)
  - `locked → open` (yalnız HR + audit; pending iş/dispute varsa geri açma)
- **forbidden transitions:** pool locked değilken `open → locked` (AD10); `closed → *` (kapalı dönem mutasyonu);
  skip (örn. `open → calculated`); silent policy/factor değişimi sonrası recalculation'sız ilerleme (AD7).
- **required actor:** lock/unlock/approve = HR (`period.manage`); export = Finance.
- **audit:** lock/unlock/calculation/approve/export → **evet**. **ledger impact:** `period_locked` event (point_ledger iz);
  approve → bonus_ledger accrual başlar (AD6 hariç `pending_missing_cap_basis`).
- **notification:** lock → org (dönem kapanış banner); calculated/approved → HR/Finance; export → Finance.
- **edge cases:** locked period'da yeni kazanç ledger entry yasak (yalnız dispute → yeni run — INV-3); unlock onaylı
  snapshot'ı geçersiz kılmaz, yeni run gerektirir.
- **tests:** pool locked değilken period lock reddi (AD10); locked sonrası policy/factor değişimi new version + recalculation ister (AD7);
  period_locked → o döneme yeni kazanç entry reddi.

## 4. Bonus calculation run machine

- **states:** `running, completed, superseded`.
- **allowed transitions:** `running → completed` (snapshot üretildi); `completed → superseded` (dispute/yeni run sonrası).
- **forbidden transitions:** aynı `idempotency_key` ile ikinci `running` (yeni snapshot üretmez); `superseded → running`;
  `locked` olmayan period'da run başlatma (AD10).
- **required actor:** HR trigger / trusted server; service role hesaplama (authz uygulama katmanında ayrıca doğrulanır).
- **audit:** run başlatma/tamamlama → **evet** (`calculation.run`). **ledger impact:** run kendisi para yazmaz;
  approve sonrası accrual (3. makine). **notification:** completed → HR (inceleme).
- **edge cases:** çift tetik → idempotency key → yeni snapshot yok; dispute accepted → yeni run, eski snapshot korunur (superseded link).
- **tests:** çift run → tek snapshot; idempotency key tekilliği; locked-olmayan period'da run reddi.

## 5. Bonus allocation machine

- **states:** `draft, calculated, pending_missing_cap_basis, approved, exported, paid`.
- **allowed transitions:**
  - `draft → calculated` (run hesapladı)
  - `calculated → pending_missing_cap_basis` (cap basis yok — AD6)
  - `pending_missing_cap_basis → calculated` (HR/Finance cap basis tamamladı → yeni run)
  - `calculated → approved` (HR snapshot approve)
  - `approved → exported` (Finance) → `exported → paid` (mark paid)
- **forbidden transitions:** `pending_missing_cap_basis → exported|paid` (**export bloklu** — AD6); unlimited cap ile ilerleme (AD6);
  `paid → *` (geri alma yok — clawback ayrı approval); cap aşan `final_amount` (INV-4).
- **required actor:** approve = HR; export/mark paid = Finance; cap basis tamamlama = HR/Finance (`comp.read`).
- **audit:** approve/export/mark paid/clawback → **evet**. **ledger impact:** approve → bonus_ledger `bonus_accrual`;
  mark paid → `payout_marked_paid`; clawback → reversal (approval workflow). **notification:** approved/exported → employee (final breakdown).
- **edge cases:** `pending_missing_cap_basis` çözülünce export açılır; `Σadj=0` → allocation yok, pool undistributed;
  herkes cap'e takılır → Σfinal < pool, residual undistributed (D6).
- **tests:** cap basis yok → `pending_missing_cap_basis`; export bloğu (AD6); cap aşımı reddi; Σfinal+remainder=pool.

## 6. Dispute machine

- **states:** `open, under_review, needs_info, resolved, closed` (resolution: accepted|rejected).
- **allowed transitions:** `open → under_review` (HR reviewer atar); `under_review → needs_info → under_review`;
  `under_review → resolved(accepted|rejected)`; `resolved → closed`.
- **forbidden transitions:** resolve eden reviewer ihtilaf konusu kararın **sahibi** ise (**manager kendi kararına final değil** — D9);
  resolved bir dispute aynı gerekçeyle reopen (yeni kanıt + HR ile yeni dispute); closed → *.
- **required actor:** open = Employee (`dispute.open`, complainant=self); assign = HR; resolve = `dispute.resolve` AND ≠ karar sahibi.
- **audit:** karar → **evet** (`dispute.decision`). **ledger impact:** accepted(puan) → point_ledger `dispute_adjustment`;
  accepted(prim) → yeni calculation run + snapshot (gerekirse bonus_ledger reversal + yeni accrual). **notification:** atama/karar → complainant + reviewer.
- **edge cases:** period kapanmış/exported iken dispute → yeni run + snapshot; ödenmişse clawback/ek ödeme (otomatik kesinti yok);
  reviewer ayrılır → HR yeniden atar; SLA aşımı (5 iş günü — D9) → eskalasyon.
- **tests:** manager kendi reddine final veremez; accepted-puan → ledger adjustment; accepted-prim → yeni snapshot (eski korunur); SLA due_at + eskalasyon.

## 7. Anti-gaming flag machine

- **states:** `open, reviewing, confirmed, dismissed`.
- **allowed transitions:** `open → reviewing` (Manager/HR inceler); `reviewing → confirmed|dismissed` (gerekçe + audit).
- **forbidden transitions:** `confirmed → otomatik ceza/kesinti` (**otomatik finansal etki yok** — D5; her etki ayrı insan kararı + ledger entry + dispute);
  self_approval = **engelleme** (flag değil, hard block).
- **required actor:** review = Manager (kendi takım) / HR (`flag.review`). **audit:** confirm/dismiss → **evet**.
- **ledger impact:** **yok** (confirmed tek başına ledger yazmaz); etki yalnız ayrı manual_adjustment/dispute ile.
- **notification:** flag/karar → subject employee (şeffaflık) + Manager/HR queue.
- **edge cases:** meşru yoğunluk → false positive (flag, ceza değil); küçük org same-reviewer doğal → eşik istisnası.
- **tests:** confirmed flag otomatik ledger entry üretmez; self-approval hard block; her kural pozitif/negatif.

## 8. Export machine

- **states:** `requested, generated, downloaded` (veya `failed`).
- **allowed transitions:** `requested → generated` (snapshot'tan üretildi); `generated → downloaded`.
- **forbidden transitions:** snapshot olmadan `generated` (**snapshot zorunlu** — INV-7); `pending_missing_cap_basis`
  allocation varken export (AD6); period `approved` değilken export.
- **required actor:** Finance (`payout.export`). **audit:** **evet** (`export.generation`).
- **ledger impact:** export `payout_exported` bonus_ledger event ile ilişkilenir; mark paid → `payout_marked_paid`.
- **notification:** generated → Finance; (ops.) employee "ödeme hazırlandı" (org tercihi).
- **edge cases:** cap basis sonradan tamamlanınca export açılır; export sonrası dispute → yeni run + (gerekirse) reversal.
- **tests:** snapshot'sız export reddi; cap basis eksikken export bloğu (AD6); approved olmayan period export reddi.

## 9. Support access grant machine

- **states:** `active, expired, revoked`.
- **allowed transitions:** `active → expired` (expires_at geçti — otomatik); `active → revoked` (Owner iptal).
- **forbidden transitions:** grant'sız tenant erişimi (**default no access** — D4); support kendine grant; `expired/revoked → active` (yeni grant gerekir).
- **required actor:** grant = Owner (`support.grant`); revoke = Owner. **audit:** grant/revoke **ve** her support erişimi → **evet** (`support.access`).
- **ledger impact:** yok. **notification:** grant/revoke → Owner + (ops.) Auditor.
- **edge cases:** süre dolmuş ama oturum açık → bir sonraki erişim kontrolünde reddedilir (grant DB'den okunur); scope dışı erişim reddi.
- **tests:** grant'sız erişim reddi; grant ile erişim audit üretir; süresi dolan grant erişim vermez.

---

## Sistem invariant'ları (bağlayıcı)

| # | Invariant | Kaynak | Nerede zorlanır |
| --- | --- | --- | --- |
| SI-1 | Puan yalnız `approved` task sonrası point_ledger'a yazılır (idempotent, tek satır) | D3, INV-1 | scoring approve guard + unique(`task_id`,`task_approved`) |
| SI-2 | point_ledger UPDATE/DELETE yapılmaz (append-only); düzeltme = reversal/adjustment | ADR-005, INV-2 | RLS: UPDATE/DELETE policy yok |
| SI-3 | Bonus snapshot olmadan payout/export yok | ADR-006, INV-7 | export WITH CHECK `snapshot_id NOT NULL` |
| SI-4 | Period lock sonrası silent mutation yok (policy/factor/pool değişimi = new version + audit + recalculation) | AD7/AD10 | period/pool guard + version |
| SI-5 | Compensation-sensitive data employee'ye görünmez (audit payload dahil) | D7/AD3 | comp RLS + audit maskeleme |
| SI-6 | RLS'siz tablo yok (ENABLED + FORCE, `organization_id = current_org()`) | ADR-003/004 | her tablo RLS |
| SI-7 | Cross-tenant read/write yok | ADR-003 | her policy org filtresi + negatif test |
| SI-8 | Manual adjustment reason + audit ister (ayrı entry) | D-scoring, §8 | point.override guard + audit |
| SI-9 | Dispute adjustment ledger entry ister (puan) / yeni snapshot (prim) | D9 | dispute resolve → ledger/run |
| SI-10 | Clawback otomatik kesinti değil; approval workflow (reversal entry) | D2 | clawback_pending → approval → reversal |
| SI-11 | Service role client'a sızdırılmaz (env secret; loglanmaz) | ADR-012/014 | bundle taraması + secret yönetimi |
| SI-12 | Finance görev detayını değil, yalnız gerekli payout/export view'larını görür | ADR-018 | Finance SELECT yok + `v_finance_*` |
| SI-13 | Σ(allocations) + undistributed_remainder = pool (kuruş) | D6, INV-4 | snapshot invariant + rounding |
| SI-14 | Calculation snapshot tüm faktörleri kaydeder ve immutable'dır | AD7, INV-6 | snapshot UPDATE/DELETE yasak |
| SI-15 | `pending_missing_cap_basis` çözülmeden export yok; unlimited cap yok | AD6 | allocation/export guard |
| SI-16 | Authorization server-side + RLS; client/JWT claim source of truth değil | AD1 | DB-driven helper + server check |

## Edge cases (çapraz)

- Boş dönem (onaylı görev yok) → Σadj=0 → dağıtım yok; period yine `calculated→approved` (boş snapshot) olabilir.
- Çoklu-org kullanıcı → her state machine org bağlamında izole çalışır.
- Period unlock sonrası recalculation → yeni run; eski snapshot superseded, silinmez.
- Dispute, kapanmış/exported dönemi etkiler → yeni run + (gerekirse) reversal; otomatik kesinti yok.

## Acceptance criteria

- 9 state machine için allowed/forbidden geçiş + aktör + audit + ledger + notification tanımlı.
- SI-1..SI-16 invariant'ları bir state machine veya RLS/guard'a bağlı.
- Her forbidden geçiş için en az bir negatif test öngörülmüş.

## Test implications

- Her state machine: pozitif geçiş + en az bir forbidden geçiş reddi testi.
- SI-1..SI-16 her biri ≥1 business-logic/RLS testine bağlanır (`10_TEST_STRATEGY`).
- Bloklayıcı: self-approval (SI-1/review), cross-tenant (SI-7), append-only (SI-2), export-without-snapshot (SI-3),
  comp visibility (SI-5), cap basis export bloğu (SI-15).

## Open questions

- OQ-SM-1: Task `cancelled` sonrası dispute açılabilir mi? (Öneri: arşiv kaydı üzerinden evet.) — Phase 4.
- OQ-SM-2: Period `unlock` koşulları (hangi pending durum geri açmayı zorunlu kılar)? — Phase 6 netleşir.
- OQ-DP-1: "iş günü" tanımı (org tatil takvimi) SLA hesabında — V1.
