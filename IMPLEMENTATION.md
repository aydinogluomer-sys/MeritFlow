# MeritFlow — Implementation Status & TODO

> **Yaşayan durum/todo takip dosyası.** Detaylı "neden/nasıl" için kaynak: `docs/planning/` (00–18),
> `docs/adr/` (ADR-001…020), `CLAUDE.md`. Çelişki olursa `docs/planning/00_DECISION_LOCK.md` kazanır.
> Bu dosya **kod değildir**; yalnızca nerede olduğumuzu ve ne yapacağımızı izler.
> Son güncelleme: 2026-08-10 (Phase 7-E dispute bonus re-run orchestration verified + committed + docs sync).

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
| Phase 3 exports | `exports` (payout export record/container — generation engine YOK; Finance INSERT via existing `payout.export`, actor integrity `exported_by = auth.uid()`; snapshot_id NOT NULL — SI-3; AD6/SI-15 gate via SECURITY DEFINER trigger checks `snapshot.calculation_run_id → bonus_allocations` for pending_missing_cap_basis by status OR cap_applied; `exports.bonus_period_id` = snapshot period; append-only client posture — no authenticated UPDATE/DELETE; prevent_delete retention; audit on INSERT; RLS Finance + Auditor SELECT, HR/Manager/Employee/Support excluded; no new permission — catalog stays 20) | `migrations/0018`, `tests/0012` | ✅ verified | commit `b66350d`; 2026-07-31 |
| Phase 4 task/review core | `tasks` + `task_events` + `task_reviews` (status machine draft→…→approved/rejected, DELETE forbidden; task_events auto-written append-only history — AD4; task_reviews append-only decisions; **review-driven transition** — task_reviews INSERT applies the task status via SECURITY DEFINER trigger; direct client approve/reject/needs_revision blocked; **self-approval hard block** — AD4; D3 approve⇒quality≠poor; complexity/impact/quality/timeliness enums from doc 04; same-org composite FKs; RLS assignee/creator/reviewer/team-manager/HR/Auditor/support-grant, **Finance excluded**; no new permission — catalog 20) | `migrations/0019`, `tests/0013` | ✅ verified | commit `148667e`; 2026-08-01 |
| Phase 5 scoring engine | `point_ledger` +`task_id`/`task_approved` + SI-1 idempotency; `tasks.final_points`→numeric (approve→`point_ledger task_approved` earning row + `final_points` cache + breakdown in `metadata`; SECURITY DEFINER BEFORE UPDATE trigger on the approved transition; doc-04 formula from published `scoring_policy_versions` multipliers/`revision_penalty_rule`; raw numeric no rounding; timeliness from the approving review — AD4; collaboration non-scoring — AD5; D3/AD7 guards; trusted direct-approve without review skips; Finance excluded; no new permission — catalog 20; no bonus changes) | `migrations/0020`, `tests/0014` | ✅ **verified** | commit `aa47e40`; 2026-08-01 |
| Phase 6 bonus engine | `run_bonus_calculation()` SECURITY DEFINER server-only: locked period+pool (AD10); approved points from `point_ledger task_approved` × `tasks.approved_at` in period; Safe Pro-Rata W_individual=1.0 (D1/D2); cap from `compensation_records`×cap_rate×proration (AD6 `pending_missing_cap_basis`, no unlimited cap); T_org+AD8 top-up; largest-remainder kuruş (tie-break employee_id); writes `bonus_allocations` + immutable snapshot; run completed + period locked→calculated; idempotent `(org,key)`; Σfinal+undistributed=pool_ref (SI-13); accrual → **Phase 6-b** (`a65013d`); Finance raw-excluded (SI-12); catalog 20 | `migrations/0021`, `tests/0015` | ✅ **verified** | commit `0c54fba`; 2026-08-09 |
| Phase 6-b bonus_ledger accrual | `post_bonus_accrual()` SECURITY DEFINER server-only: approved period (ADR-006 snapshot-approval boundary — period calculated→approved via `period.manage`) → tek balanced accrual (debit pool=Σfinal / credit accrual per employee) from the completed run's snapshot; idempotent per snapshot; **AD6 gate** (pending_missing_cap_basis → blok); **BL-2** deferred trigger Σaccrual≤pool_ref (AD8-aware); BL-3 → **Phase 6-c done**; snapshot immutable (approval period-level); no new permission — catalog 20; Finance raw-excluded (SI-12) | `migrations/0022`, `seed` (Org C auditor), `tests/0016` | ✅ **verified** | commit `a65013d`; 2026-08-09 |
| Phase 6-c payout/export engine | `produce_payout_export()` SECURITY DEFINER server-only (Finance/trusted server): approved period (AD6 gate 0018 trigger — pending_missing_cap_basis → blok) → `exports` record + period **`approved→exported`**. `mark_payout_paid()` SECURITY DEFINER server-only: exported period → per-employee balanced `payout_marked_paid` (debit accrual / credit payout — doc-06 §2) + **BL-3** DEFERRABLE INITIALLY DEFERRED trigger `enforce_bonus_ledger_payout_cap()` (payout ≤ net accrual, reversal-aware) + period **`exported→closed`**; idempotency guard **BEFORE period gate** (D2 safe). `bonus_ledger`: `payout_marked_paid` unlocked (`export_id NOT NULL` CHECK); `payout_exported` + `clawback_*` hâlâ bloklu. `exports` → `unique(id, organization_id)` kısıtı; `bonus_ledger` → `export_id` same-org composite FK → exports (0026 precedent). Finance views: `v_finance_payout` + `v_finance_period_totals` (security_invoker — raw points/quality/cap_basis/comp **yok** — SI-12). No new permission — catalog 20. 0020 test-only fix: paid-guard fixture `payout_marked_paid`→`payout_exported` (yeni `bonus_ledger_payout_export_chk` CHECK gerektirdi — `payout_exported` yine validate_bonus_ledger_event ile 23514; guard aynı). 20 pgTAP assertion (4 bölüm: A happy-path / B AD6 gate / C ledger guards / D authz+view+cross-tenant) | `migrations/0027`, `tests/0021` (+ `tests/0020` amended) | ✅ **verified** | commit `77615e3`; 2026-08-10 |
| Phase 6-d bonus engine authz hardening | `run_bonus_calculation()` + `post_bonus_accrual()` giriş-authz'ı `CREATE OR REPLACE` ile düzeltildi: `current_user not in ('authenticated','anon')` → **`auth.uid() is null`** (SECURITY DEFINER'da `current_user`=owner olduğundan eski kontrol etkisizdi; `period.manage` fiilen zorlanmıyordu). AD1 uyum; **gövde/mantık/imza/grant değişmedi** (aynı OID → grant+comment korundu); no new permission — catalog 20; regresyon yok (0015/0016 trusted bağlamda geçer) | `migrations/0024`, `tests/0018` | ✅ **verified** | commit `0b8b34a`; 2026-08-09 |
| Phase 7-A anti-gaming detection engine | `run_anti_gaming_scan()` SECURITY DEFINER server-only orkestratör + 4 `detect_*` fonksiyonu (duplicate_task, tiny_task_splitting, same_reviewer_concentration, period_end_spike); `anti_gaming_flags`'a FK-less `bonus_period_id` kolonu + **dual idempotency** partial unique index (OQ-2: task-scoped `related_task_id` / period-scoped `bonus_period_id`); **D5 izolasyon** — yalnız flag yazar, ledger/bonus/comp'a dokunmaz (scan finansal yan-etkisiz); authz `has_role('hr') OR auth.uid() IS NULL`; hardcoded eşikler (OQ-1); no new permission — catalog 20 | `docs/planning/19`, `migrations/0023`, `tests/0017` | ✅ **verified** | commit `ffdea06`; 2026-08-09 |
| Phase 7-B dispute point adjustment | `apply_dispute_point_adjustment()` SECURITY DEFINER server-only: resolved+accepted dispute → mevcut `point_ledger`'a **tek `dispute_adjustment` delta** (employee=complainant); fail-closed 23514 (accepted değilse); idempotent per dispute (partial unique index); non-zero delta (OQ-7B-5); `point_ledger`'a FK-less olmayan `dispute_id` + **same-org composite FK → disputes** (SI-7); event_type CHECK DROP+ADD (aynı isim, 0020 precedent); audit WHEN clause genişletildi (`dispute_adjustment` eklendi, `task_approved` hariç); authz `has_permission('dispute.resolve') OR auth.uid() IS NULL`; D2/D9 ihlali yok; no new permission — catalog 20 | `migrations/0025`, `tests/0019` | ✅ **verified** | commit `70ba400`; 2026-08-09 |
| Phase 7-C dispute bonus recalculation | `recalculate_bonus_after_dispute()` SECURITY DEFINER server-only: completed run → **superseded** (0013 machine); period **`approved→calculated`** (re-approval required — `validate_bonus_period_transition` CREATE OR REPLACE ile bu geçiş eklendi); mevcut `bonus_ledger` accrual'ı **balanced reversal** (debit↔credit swap, yeni transaction_id, append-only); **paid-guard** — accrual satırı paid ise `23514` (D2 clawback-gated); **idempotent** (reversal varsa no-op); authz `has_permission('period.manage') OR auth.uid() IS NULL`; **C-c1 reduced scope** (yeni run/snapshot üretilmez — `run_bonus_calculation` approved period üzerinde çalışamıyor); `dispute_adjustment` → bonus bazına yansıma **Phase 7-D'de giderildi (`31c226f`)**; yeni permission yok — katalog 20; 16 pgTAP assertion | `migrations/0026`, `tests/0020` | ✅ **verified** | commit `8941089`; 2026-08-10 |
| Phase 7-D dispute_adjustment → bonus basis | `point_ledger` + nullable `bonus_period_id` + same-org composite FK → `bonus_periods` (SI-7) + `point_ledger_bonus_period_event_chk` CHECK (`dispute_adjustment ⇒ bonus_period_id NOT NULL`; diğer event'ler ⇒ NULL); `apply_dispute_point_adjustment()` **DROP+CREATE** (imza değişti: +`p_bonus_period_id uuid DEFAULT NULL`; grant re-issue); `run_bonus_calculation()` **CREATE OR REPLACE** (aynı imza → grant/OID korundu): gate `IN('locked','calculated')` (OQ-7D-3; 0015 mesajı birebir korundu); **NET `approved_points` = `task_approved` (tasks.approved_at) + `dispute_adjustment` (bonus_period_id = p_bonus_period_id)** (OQ-7D-1; NULL task_id artık JOIN'de kaybolmaz); net ≤ 0 → `adjusted_score ≤ 0` → dışlanır, 0 prim (OQ-7D-4; D2 malus değil); `bonus_allocations.factors` + `dispute_adjustment_points` kırılımı (OQ-7D-5). 0019 test-only fix (3 satır: #2 positive apply / #7 23505 backstop insert / #12 cross-tenant — yeni CHECK için bonus_period_id eklendi). 15 pgTAP assertion (Section A: basis+net≤0+SI-13+idempotency; B: period-atıf CHECK+FK; C: gate+katalog; D: authz) | `migrations/0028`, `tests/0022` (+ `tests/0019` amended) | ✅ **verified** | commit `31c226f`; 2026-08-10 |
| Phase 7-E dispute bonus re-run orchestration | `recalculate_bonus_after_dispute()` **CREATE OR REPLACE** (aynı 3-arg imza → grant/OID korundu): 7-C C-c1'i tam orkestrasyon'a yükseltir — reversal+supersede+`approved→calculated` (0026 gövdesi korundu) + **YENİ `run_bonus_calculation()` çağrısı** (pool DB'den `SELECT status='locked'`; bulunamazsa `23514`; idempotency key = `'disp-recalc-snap-'` + reversed snapshot id — deterministik, birden fazla dispute döngüsü güvenli); **YENİ snapshot id döner** (7-D engine ile `dispute_adjustment` bazda yansır). Period `'calculated'` **kalır** — HR ayrıca `approve` → `post_bonus_accrual()` (ADR-006 human re-approval korundu). **İdempotent**: reversal+run → yeni snap; reversal var/run yok → pool-fetch+run'a düşer; her ikisi varsa → yeni snap (no-op). 0020 test-only fix (3 assertion: `_b7c_snap` helper accrual-filtreli; `#6` supersede scope; `#10` yeni re-run snapshot). 14 pgTAP assertion (A: 8 full orchestration / B: 3 idempotency / C: re-accrual gated / D: pool guard / E: precondition / F: authz+katalog 20) | `migrations/0029`, `tests/0023` (+ `tests/0020` amended) | ✅ **verified** | commit `3efe95d`; 2026-08-10 |

**Runtime verification (2026-08-10, local dev stack, npx Supabase CLI 2.109.1):** `supabase db reset`
migrations **0001..0029** + seed temiz uyguladı; `supabase test db` → **Files=23, Tests=814, Result=PASS,
Failed=0** (`0001`..`0023` ok). `db reset`'teki geçici container flake'leri (`ENOTFOUND`/timeout/"exit 1" —
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
**server-only**; same-org composite FK'ler (pool/run/snapshot/employee); INSERT audit (BL-4). **BL-2**
`DEFERRABLE INITIALLY DEFERRED` trigger (0022 `enforce_bonus_ledger_balance`) Σaccrual≤pool_ref AD8-aware hard-enforce eder. **BL-3** `enforce_bonus_ledger_payout_cap()` DEFERRABLE trigger (payout ≤ net accrual, reversal-aware) **Phase 6-c (`0027`)'te eklendi**; `payout_marked_paid` artık yazılabilir (`export_id NOT NULL` kısıtı ile); `payout_exported` / `clawback_*` hâlâ guard'lı. **Clawback** (D2 gated) ve app/UI/API hâlâ hariç.

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
FK'sız; **`bonus_period_id` (FK'sız) Phase 7-A (`0023`)'te eklendi** (period-scoped idempotency; container
dilimde yoktu). RLS: subject-own + own-team Manager + HR + Auditor; **Finance/Support hariç**. DELETE yasak;
audit insert/update. **Hariç (container dilimi):** detection motoru → **Phase 7-A done (`ffdea06`)**;
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
**Finance + Auditor SELECT** — **HR/Manager/Employee/Support hariç**. **Phase 6-c (`77615e3`)'te eklendi:**
`produce_payout_export()` (period `approved→exported` + exports record); `mark_payout_paid()` (period
`exported→closed` + per-employee `payout_marked_paid` ledger); BL-3 deferred payout-cap trigger;
`v_finance_payout` + `v_finance_period_totals` (security_invoker). **Hâlâ hariç:** CSV/XLSX/storage dosya yazımı, checksum,
notifications, clawback (D2 gated), app/API/UI.

**Phase 4 task/review core invariant'ları (04/14/15/16; D3/AD4/AD5):** `tasks` **status machine**
(`draft→assigned→in_progress→submitted→needs_revision↺→approved|rejected`; cancelled/archived terminal) — yasak
geçişler (skip-state, `approved→in_progress`, mid-state insert); **DELETE yasak** (cancel/archive = status).
`task_events` **auto-written append-only history** (`log_task_event` trigger — AD4 kaynağı; UPDATE/DELETE yasak,
client write path yok). `task_reviews` **append-only karar** — **review-driven transition**: `task_reviews`
INSERT, SECURITY DEFINER `apply_review_to_task` trigger'ı ile task status'unu uygular; **doğrudan client
approve/reject/needs_revision reddedilir** (yalnız güvenilir sunucu/definer bağlamı bu state'lere geçebilir).
**Self-approval hard block (AD4):** `reviewer_id <> assignee` — review INSERT'te (SECURITY DEFINER, tasks okur) +
tasks CHECK + transition belt. **D3:** `approve ⇒ quality <> poor` (CHECK). **AD4 timing:** submit `submitted_at`
damgalar; `needs_revision` `revision_count++` ve `submitted_at`'i korur; resubmit tazeler — pgTAP kanıtlı.
`complexity/impact/quality/timeliness` enum'ları **doc 04**'ten. Same-org composite FK'ler
(team/assignee/creator/reviewer/policy-version; events/reviews→tasks; actor→memberships). **RLS:** assignee/
creator/reviewer/`manages_team`/HR/Auditor + **support-grant top-level OR** (support üyeliksiz, `current_org()`
null → ayrı OR dalı); events/reviews **task görünürlüğünü miras alır**; **Finance ham task/review/event
göremez** (SI-12). **Yeni permission/rol yok** — task.create/assign/submit/review mevcut (katalog 20). Phase 4
DB slice'ında approve ledger yazmazdı; **Phase 5 (0020) artık approve'da tek `task_approved` satırı yazar** (0013
bu doğruyu test eder). **Hariç (Phase 4):** `task_assignments`/`task_comments`/`task_attachments` (+storage),
projects/objectives, period-lock guard, notifications, app/UI/API.

**Phase 5 scoring engine invariant'ları (04; D3/AD4/AD5/AD7/SI-1/SI-11/SI-12):** görev `approved` olunca
**deterministik server-side scoring**. `point_ledger`'a `task_id` (nullable) + `task_approved` event eklendi;
`tasks.final_points` **numeric**'e ALTER'landı. **SECURITY DEFINER BEFORE UPDATE** trigger (`score_task_on_approve`,
`trg_tasks_validate`'ten sonra çalışır) approved geçişinde: kilitli **published** policy version'dan çarpanları +
`revision_penalty_rule`'u okur, `final_points = base·complexity·impact·quality·timeliness·(1−min(rev·0.05,0.25))`
hesaplar (doc 04), `NEW.final_points`'i set eder ve **tek** `task_approved` kazanç satırını yazar (points_delta
= final_points; breakdown `point_ledger.metadata`'da). **SI-1 idempotency:** partial unique index — task başına
tek `task_approved` satırı. **Raw numeric, DB yuvarlama yok.** **AD4:** timeliness onaylayan
`task_reviews.timeliness`'ten; geç onay cezalandırmaz. **AD5:** `collaboration_score` yalnız metadata; final'i
etkilemez. **D3:** approve+quality=poor scoring'den önce reddedilir. **AD7:** draft/yayınlanmamış version score
edemez (trigger raise). Güvenilir **direct-approve (review'suz) scoring'i atlar**; review-driven approve'lar score
eder. **Server-only** (SI-11 — client scoring yetkisi yok). Seed'de mevcut published `d2`/`b-d2` policy version
multipliers + penalty rule doc-04 değerleriyle **dolduruldu** (published-immutability UPDATE'i engellediğinden INSERT
değerinde). **Finance ham `point_ledger`'dan hariç** (SI-12). **Yeni permission/rol yok** (katalog 20). **bonus_ledger/
bonus değişikliği yok; app/UI/API değişikliği yok.** **Hariç (5-b/ertelenen):** manual override/adjustment
(`point.override` 2-step → `manual_adjustment`); timeliness'in submitted_at/due_date'ten türetimi (reviewer/app);
breakdown UI.

**Phase 6 bonus engine invariant'ları (05 §8; D1/D2/D6/D10/AD6/AD7/AD8/AD9/AD10/SI-13):** `run_bonus_calculation(org,
period, pool, idempotency_key, triggered_by)` **SECURITY DEFINER, server-only** motor — mevcut `0013`
container'larını doldurur, **yeni tablo/permission yok** (katalog 20). **Locked period + locked pool** guard (AD10;
değilse `23514`). Approved points = `point_ledger task_approved` × `tasks.approved_at` **period içi**. **Safe Pro-Rata**
`W_individual=1.0`, malus yok (D1/D2); role/quality/team faktör=1; eligibility/proration yalnız **cap**'e (D10). Cap =
`compensation_records.cap_basis_minor × cap_rate × proration`; **cap basis yoksa `pending_missing_cap_basis`** —
**unlimited cap yok** (AD6). **T_org + AD8:** T≤1 kesinti undistributed'a; **T=1.2 top-up'suz pool'u aşamaz**, top-up'la
1.2× (`pool_ref`). **Largest-remainder kuruş** (yalnız uncapped satırlar, tie-break `employee_id` asc; cap residual
**yeniden dağıtılmaz** — D6). Yazar: `bonus_allocations` (run 'running' iken) + **tek immutable**
`bonus_allocation_snapshot` (faktörler + `undistributed_remainder` — AD7/SI-14); run **completed** (0013 freeze) +
period **locked→calculated**. **Idempotent** `(org, idempotency_key)` (varsa snapshot döner). `Σfinal + undistributed =
pool_ref` (SI-13). **`bonus_ledger` accrual YOK** — Phase 6-b'ye ertelendi (accrual/snapshot-approval boundary).
**Finance raw-excluded** (SI-12). **Verified:** `09` §8 worked example birebir (3.177.630 / 3.177.629 / 953.289 /
2.691.452; Σ=pool; undistributed 0; tie-break Ali<Ayşe) + cap/D6 residual + AD8 yes/no + T_org=0 + Σadj=0 +
single-eligible + AD6 pending. Tek in-slice **test-only** fix: `s.top_up_applied` (ambiguous kolon). **Hariç:**
accrual posting + snapshot-approval → **Phase 6-b done (`a65013d`)**; payout/export wiring, recalculation, UI/API sonraki fazlar.

**Phase 6-b bonus_ledger accrual invariant'ları (ADR-006/017; D2/AD6/AD8; BL-1/BL-2; SI-3/SI-7/SI-12/SI-13):**
`post_bonus_accrual(org, period, triggered_by)` **SECURITY DEFINER, server-only** — mevcut `bonus_ledger` (0014)
container'ına yazar, **yeni tablo/permission yok** (katalog 20). **Snapshot-approval boundary (ADR-006):** approval =
`bonus_periods` **`calculated→approved`** (mevcut geçiş; HR/`period.manage`; validator değişmedi; audit'lenir). Snapshot
**tam immutable kaldı** (approval period-level; snapshot `approved_by/approved_at` kolonları forward-compat/kullanılmaz —
OQ-3 onay audit_logs ile). Engine: approved period + **tek completed run** (OQ-5 fail-closed) → **AD6 gate** (allocation
`pending_missing_cap_basis` ise blok — provisional accrual yok) → **tek balanced transaction** (`debit pool = Σfinal` /
`credit accrual` per employee; `bonus_accrual`). **Idempotent** per snapshot (varsa no-op). **BL-1** append-only (0014);
**Σdebit=Σcredit** (0014 deferred balance); **BL-2** yeni **`DEFERRABLE INITIALLY DEFERRED` trigger** `Σaccrual ≤ pool_ref`
(AD8-aware: snapshot `pool_ref_minor` / top-up bütçesi). **BL-3** (payout ≤ accrual) **Phase 6-c (`0027`)'te eklendi**
(6-b'de producer yoktu — OQ-2). **OQ-1:** approval + posting **iki ayrı adım**. **Finance+Auditor raw read; server-only** (SI-12).
**Verified:** worked example accrual birebir (credits 3.177.630 / 3.177.629 / 953.289 / 2.691.452; debit pool 10.000.000;
Σdebit=Σcredit) + approval gate + idempotency + BL-2 red + AD6 blok + append-only + RLS. İki in-slice **test-only** fix
(Section A query'lerini Org C'ye scope + `::bigint` cast); **migration/engine bug yok**. **Hariç (sonraki):** payout/export
engine + `payout_exported`/`payout_marked_paid` wiring + `v_finance_*`, clawback, dispute→reversal orchestration, UI/API.

**Phase 6-d bonus engine authz hardening invariant'ları (AD1):** `run_bonus_calculation` (0021) ve
`post_bonus_accrual` (0022) giriş-authz'ı `has_permission('period.manage') OR current_user not in
('authenticated','anon')` idi; **SECURITY DEFINER içinde `current_user` = fonksiyon sahibi** (postgres, çağıran
değil) → ikinci clause her zaman TRUE → `period.manage` fiilen hiç zorlanmıyordu (latent authz zayıflığı). `0024`
her iki fonksiyonu **`CREATE OR REPLACE` ile, gövde/mantık/formül/ledger/imza birebir korunarak** yeniden
tanımlar; **yalnızca** authz clause'u `current_user not in (...)` → **`auth.uid() IS NULL`** olur (0023'teki doğru
"trusted server/job = authenticated JWT identity yok" sinyali; authenticated kullanıcı her zaman JWT `sub` taşır).
İmza değişmediği için **mevcut GRANT'lar + COMMENT'ler korunur** (aynı OID); **yeni tablo/permission yok** (katalog
20); seed değişmez; **0023'e dokunulmaz**. Migration **idempotent** (`CREATE OR REPLACE`; `db reset` temiz
yeniden uygular). **Davranış değişikliği tek yönlü sıkılaştırma:** authenticated + `period.manage`'siz çağıran
artık `42501` alır (AD1 — authz DB'den, ambient session state'ten değil). **Runtime tüketici yok** (app/client bu
server-only fonksiyonları çağırmıyor) → hiçbir çağıran kırılmaz. **Regresyon yok:** 0015/0016 engine çağrılarının
hepsi **trusted (`auth.uid()` null) bağlamda** (RLS rol-switch'inden önce) koştuğu için yeni authz'ı geçer.
**Verified (`tests/0018`):** (a) authenticated Finance c4 (period.manage yok) → `42501`; (b) authenticated HR c3
(period.manage var) → authz geçer → `23503` (bogus period); (c) trusted context (`auth.uid()` null) → authz geçer →
`23503` — her ikisi için (`run_bonus_calculation` + `post_bonus_accrual`; authz her lookup'tan önce raise ettiğinden
bogus uuid yeterli). **Hariç:** fonksiyon mantığı, dispute 7-B/7-C, payout/export, app/UI.

**Phase 7-A anti-gaming detection engine invariant'ları (08; D5/OQ-1..OQ-3):** `run_anti_gaming_scan(org,
bonus_period_id?)` **SECURITY DEFINER, server-only** orkestratör mevcut `anti_gaming_flags` (0016) container'ına
flag üretir — **yeni tablo/permission yok** (katalog 20). Dört `detect_*` fonksiyonu: **duplicate_task** (aynı
assignee + normalize `lower(btrim(title))` 24h içinde → sonraki task'e flag), **tiny_task_splitting** (aynı
assignee ≥3 task `base_points<5` 1h içinde), **same_reviewer_concentration** (period içi bir reviewer payı >0.80
ve toplam ≥3 approval), **period_end_spike** (son-3-gün `task_approved` point gain > 3× period günlük ortalaması).
Eşikler **hardcoded** (OQ-1; `organization_settings` kolon V1'e ertelendi). **OQ-2 dual idempotency:**
`anti_gaming_flags`'a **FK-less `bonus_period_id`** kolonu (mevcut FK-less `related_task_id` gibi — D5 "bonus_*
tablolara FK yok" korunur) + **iki partial unique index** (task-scoped `(org, rule, subject, related_task_id)` /
period-scoped `(org, rule, subject, bonus_period_id)`); re-scan **flag eklemez**. **OQ-3:** detection yalnız
**explicit `run_anti_gaming_scan()`** çağrısıyla (HR/job); approve anında otomatik değil. **D5 izolasyon
korundu:** detect fonksiyonları `tasks`/`task_reviews`/`point_ledger`/`bonus_periods` **okur**, **yalnız
`anti_gaming_flags`'a yazar** — point_ledger/bonus_ledger/bonus_*/compensation'a **yazım/FK/trigger yok**; bir scan
**finansal yan-etki üretmez** (test: scan sonrası point_ledger/bonus_ledger satır sayısı değişmez). **Authz:**
`has_role('hr') OR auth.uid() IS NULL` (güvenilir sunucu/job bağlamı) — non-HR authenticated `42501` alır;
`detect_*` grant'ları yalnız `service_role` (authenticated'tan revoke). **Verified:** her kural pozitif/negatif +
idempotency (re-scan 0 yeni flag) + D5 no-side-effect + server-only (non-HR reddi, `detect_*` çağrılamaz, direct
flag INSERT reddi). Bir **in-slice migration fix:** `run_anti_gaming_scan` authz'ı ilk yazımda `current_user not
in ('authenticated','anon')` idi — SECURITY DEFINER'da `current_user` = fonksiyon **sahibi** (postgres) olduğundan
her zaman "trusted" oluyordu; `auth.uid() IS NULL`-tabanlı doğru kontrole çekildi (test #11 kırmızı→yeşil).
**Hariç (gated):** point_ledger/bonus_ledger yazımı, dispute wiring (**7-B done `70ba400`**; **7-C done `8941089`**),
`organization_settings` eşik kolonu, `self_approval_attempt` trail, app/UI/API.

**Phase 7-B dispute point adjustment invariant'ları (07 §62; D9/D2/ADR-005):** `apply_dispute_point_adjustment(
p_dispute_id, p_points_delta, p_reason, p_actor)` **SECURITY DEFINER, server-only** — resolved+accepted dispute'un
puan etkisini mevcut `point_ledger` (0009) container'ına yazar; **yeni tablo/permission yok** (katalog 20). Sıralı
kontroller: **authz** (`has_permission('dispute.resolve') OR auth.uid() IS NULL` — dispute'u çözen reviewer veya
güvenilir server/job; yoksa `42501`) → **non-zero delta** (OQ-7B-5; 0 → `23514`) → **dispute yükle** (org+employee
dispute satırından **türetilir** — cross-org param yok, SI-7) → **precondition fail-closed** (OQ-7B-3: `status in
('resolved','closed') AND resolution='accepted'` değilse `23514`, satır yazılmaz) → **idempotency** (dispute başına
mevcut `dispute_adjustment` varsa no-op, id döner) → **insert** (employee = `complainant_id` — OQ-7B-2; tek delta).
**Şema (additive, 0020 precedent):** `point_ledger`'a `dispute_id uuid` + **same-org composite FK `(dispute_id,
organization_id) → disputes`** (SI-7); event_type CHECK **DROP+ADD (aynı isim)** → `dispute_adjustment` (0003
regresyon korunur); `point_ledger_dispute_adjustment_chk` (dispute_id NOT NULL + reverses_entry_id NULL); **partial
unique index** `(dispute_id) where event_type='dispute_adjustment'` (idempotency backstop → 23505). **Audit:** INSERT
audit WHEN clause **DROP+CREATE** ile `dispute_adjustment` eklendi (spec §62 "+ audit"); **`task_approved` yine
audit'siz** (0020 davranışı korundu). **Append-only** korundu (prevent_mutation; UPDATE/DELETE → `23001`). **D2
ihlali yok** (puan düzeltmesi = para/prim clawback değil; para tarafı **7-C done `8941089`** — balanced bonus_ledger reversal); **D9** resolve adımında (0015)
enforce, 7-B yalnız accepted sonrası uygular. **Verified (`tests/0019`):** pozitif (tek satır/delta/employee) +
rejected/under_review/zero-delta `23514` + idempotency (no-op + 23505) + dispute_id'siz `23514` + invalid event_type
`23514` (0003 regresyon) + audit satırı + append-only `23001` + cross-tenant FK `23503` + employee `42501`. OQ-7B-1..5
kilitli. **Hariç:** dispute_type routing, app/UI/API. dispute_adjustment → bonus bazı **Phase 7-D'de giderildi (`31c226f`)**. (**7-C done `8941089`**: balanced bonus_ledger reversal + run superseded + period `approved→calculated`; C-c1 reduced scope.)

**Phase 7-D dispute_adjustment → bonus basis invariant'ları (05; 07 §63; D1/D2/OQ-7D-1..7):**
`run_bonus_calculation()` **CREATE OR REPLACE** (aynı imza → grant/OID korundu; 6-d `auth.uid() IS NULL` authz korundu).
**Üç yapısal değişiklik:** (1) `point_ledger` + nullable `bonus_period_id` + same-org **composite FK → `bonus_periods`**
(SI-7) + `point_ledger_bonus_period_event_chk` CHECK — `dispute_adjustment ⇒ bonus_period_id NOT NULL`, diğer event'ler
⇒ NULL (0028 `ALTER`); (2) engine **period gate** `IN('locked','calculated')` (OQ-7D-3 — `calculated` period üzerinde
dispute-adjusted re-run çalışır; 0015 `23514` gate mesajı birebir korundu — regresyon yok); (3) `pts` CTE = **NET
`approved_points`**: `task_approved` (tasks.approved_at period içi) + `dispute_adjustment` (bonus_period_id =
p_bonus_period_id — NULL task_id artık JOIN'de kaybolmaz). Net ≤ 0 → `adjusted_score ≤ 0` → mevcut `>0` filtresiyle
**dışlanır, 0 prim** (OQ-7D-4; D2 malus değil). `bonus_allocations.factors` + **`dispute_adjustment_points`** alt-alanı
(OQ-7D-5; dispute yoksa 0, yine de mevcut — izlenebilirlik). `apply_dispute_point_adjustment()` **DROP+CREATE** (imza
değişti → 4-arg yerine 5-arg: +`p_bonus_period_id uuid DEFAULT NULL`; CREATE OR REPLACE olmaz, grant re-issue gerekli;
gövde 0025 birebir + INSERT'e `bonus_period_id` eklendi). **0019 test-only fix (3 satır):** yeni CHECK `dispute_adjustment
⇒ bonus_period_id NOT NULL` gerektirdiğinden #2 (positive apply) + #7 (23505 backstop direct insert) + #12 (cross-tenant)
satırlarına `p_bonus_period_id` eklendi — zorunlu minimum; migration/engine bug yok. Authz değişmedi; **katalog 20
korundu** (yeni permission yok). **Regresyon:** 0015 (engine gate mesajı birebir korundu) + 0016/0019/0021 yeşil.
**SI-13 korundu** (Σfinal + undistributed = pool_ref; 0022 Section A#7 kanıtlı). **Verified:** `db reset` 0001..0028 +
seed; `test db` → **Files=22, Tests=797, PASS, Failed=0**. D1/D2/OQ-7D-1..7 kilitli.

**✅ Güvenlik gözlemi ÇÖZÜLDÜ (Phase 6-d, commit `0b8b34a`):** `run_bonus_calculation` (0021) + `post_bonus_accrual`
(0022) SECURITY DEFINER'da etkisiz olan `current_user not in ('authenticated','anon')` authz'ı **`auth.uid() IS
NULL`**-tabanlı doğru kontrole çekildi (bkz. yukarıdaki Phase 6-d invariant'ları). Böylece 0021/0022/0023'ün üçü de
artık aynı doğru "trusted server/job = JWT identity yok" desenini kullanıyor; latent zayıflık kalmadı.

**App katmanı (Next.js/API/UI): ✅ foundation scaffold done** (commit `a8b05ac`, verified 2026-07-31).

**Phase 3.5 app foundation scaffold invariant'ları:** **Next.js 16.2.12 + React 19 + TypeScript strict + App
Router**. npm package stratejisi: mevcut **Supabase CLI devDependency korundu**, `package-lock` yeniden üretildi
(merge, replace değil). **Supabase clients:** browser anon (`client.ts`), server anon cookie client
(`server.ts` — RLS-enforced varsayılan yol), **guarded + unused service_role admin client** (`admin.ts`).
**service_role boundary (SI-11):** `import 'server-only'` ilk satır; **client/browser modülünden import yok**;
`SUPABASE_SERVICE_ROLE_KEY` yalnız throw-eden guard'da (env.ts) — **NEXT_PUBLIC ile sızıntı yok**. **Auth/session:**
`@supabase/ssr` + `auth.getUser()` (identity server-side doğrulanır). **Authorization DB/RLS kaynaklı** —
`role_permissions`; **JWT yalnız identity** (AD1). **Single active org** DB membership/cookie ile; multi-org
switcher ertelendi (Decision F). **Next 16:** `proxy.ts`, deprecated `middleware.ts`'in yerine (session refresh +
`/dashboard` guard). **`turbopack.root`/`outputFileTracingRoot`** proje köküne pinlendi (parent-lockfile
workspace-root uyarısı yok). **Tailwind (v3.4) + shadcn-uyumlu base UI primitives** (button/card/badge/skeleton).
**Zod Server Action validation wrapper** (`validatedAction`). **App shell rotaları:** login, auth callback,
guarded dashboard, unauthorized (403), health, error/not-found. **Vitest baseline** (env, service_role boundary,
validation wrapper, RBAC — 13 test) + **Playwright config** (E2E CI dışı). **CI:** `npm ci` + typecheck + lint +
unit; **E2E/pgTAP CI ertelendi** (Phase 9). **Sentry placeholder only** — env + `instrumentation.ts` no-op;
**`@sentry/nextjs` SDK ertelendi** (Next 16 uyumsuz, peer Next 15'e kadar). **Hariç:** Phase 4 domain logic,
scoring/bonus/export/notification engine'leri, production deploy. **Doğrulama:** `npm run typecheck → PASS`,
`npm run lint → PASS`, `npm run test → PASS (4 files, 13 tests)`, `npm run build → PASS` (workspace-root ve
deprecated-middleware uyarısı yok).

**✅ Doküman senkron güncel (2026-08-10):** `supabase/README.md`, `docs/planning/12`, `docs/planning/19`, bu dosya —
0001..0028 (3A/3B/comp/bonus-P/P/bonus-C/E/bonus-C/R/A/S/bonus-ledger/disputes/anti-gaming/notifications/exports,
**Phase 4 task/review core** `148667e`, **Phase 5 scoring engine** `aa47e40`, **Phase 6 bonus engine** `0c54fba`,
**Phase 6-b bonus_ledger accrual** `a65013d`, **Phase 6-c payout/export engine** `77615e3`,
**Phase 6-d bonus engine authz hardening** `0b8b34a`,
**Phase 7-A anti-gaming detection engine** `ffdea06`, **Phase 7-B dispute point adjustment** `70ba400`,
**Phase 7-C dispute bonus recalculation** `8941089`, **Phase 7-D dispute_adjustment → bonus basis** `31c226f`,
**Phase 7-E dispute bonus re-run orchestration** `3efe95d`) verified (**Files=23/Tests=814/PASS**), **Phase 3.5
app scaffold** (`a8b05ac`) durumunu yansıtıyor. **Phase 3 DB foundation + app scaffold + Phase 4 core + Phase 5
scoring + Phase 6 bonus calculation engine + Phase 6-b bonus_ledger accrual + Phase 6-c payout/export engine +
Phase 6-d authz hardening + Phase 7-A anti-gaming detection engine + Phase 7-B dispute point adjustment +
Phase 7-C dispute bonus recalculation + Phase 7-D dispute_adjustment → bonus basis + Phase 7-E dispute bonus
re-run orchestration tamamlandı; UI/API + Phase 5-b/8/9/10 gated.** `docs/planning/18`
Phase 3B DB planı olarak **korunur** (dokunulmadı); `docs/planning/19` Phase 7 planı (7-A + 7-B + 7-C + 7-D done;
migration numaraları 6-d sonrası **7-B→`0025` / 7-C→`0026` / 7-D→`0028`**). Ayrıca `docs/planning/14` idempotency + markdownlint
sync `dae4c6b`; `docs/adr/ADR-020` markdownlint `53d90de`; **docs hijyen (ADR-014 + Decision Lock) `17a964d`,
(ADR-006 + ADR-017) `98c0b59`, (doc-07 + doc-08) `91b6ce9`** ile tamamlandı.

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

- [x] **Phase 3 DB foundation tamamlandı** — `exports` (commit `b66350d`) son dilimdi; 12 migration (`0001..0018`) + 12 bloklayıcı pgTAP suite (`0001..0012`, Tests=523) verified. Yeni tablo dilimi kalmadı; **app scaffold done**, sıradaki **Phase 4** (aşağıda C/D).
- [ ] (Ops., ileride) **projects**, **objectives** — minimal; yalnız ilgili feature fazı gerektirdiğinde, ayrı yetkiyle.

### C. App foundation (feature fazlarının ön koşulu)  ✅ tamamlandı

- [x] **Next.js + TypeScript scaffold** ✅ (commit `a8b05ac`, verified 2026-07-31; Next.js 16.2.12 + React 19 + TS strict + App Router; Supabase CLI devDep korundu + package-lock regenerated; browser anon / server anon cookie / guarded+unused service_role admin clients; `proxy.ts` (Next 16); `turbopack.root`/`outputFileTracingRoot` pinlendi; Tailwind + shadcn base UI; Zod `validatedAction`; Vitest 13 test + Playwright config; CI typecheck/lint/unit; Sentry placeholder — SDK Next 16 uyumsuzluğu nedeniyle ertelendi; typecheck/lint/test/build PASS).
- [x] **Auth akışı** (Supabase Auth `@supabase/ssr` + `auth.getUser()`) + org bağlamı (single active org via membership/cookie) + **RBAC okuması DB'den** (`role_permissions`, JWT identity-only — AD1) ✅. (DB `current_org()` ile RLS'e bağlama Phase 4 entegrasyon adımı.)

### D. Feature fazları (roadmap 4–10)  ⛔ her faz ayrı yetki

- [x] **Phase 4 — Task & Review Core (DB çekirdeği)** ✅ (commit `148667e`, verified 2026-08-01; `tasks` + `task_events` + `task_reviews`; status machine + DELETE yasak; auto-written append-only history; review-driven transition trigger — direct approve/reject/needs_revision blocked; self-approval hard block AD4; D3 approve⇒quality≠poor; AD4 timing; Finance excluded; support-grant top-level OR; no new permission — catalog 20; approve point_ledger üretmez — Phase 5 sınırı). **Ertelenen (feature-fazı):** `task_assignments`/`task_comments`/`task_attachments`, submit/review **Server Actions + UI** (ayrı yetki).
- [x] **Phase 5 — Scoring Engine** ✅ (commit `aa47e40`, verified 2026-08-01; approve→`point_ledger task_approved` + `tasks.final_points` numeric cache + breakdown metadata; `point_ledger` +`task_id`/`task_approved` + **SI-1 partial unique idempotency**; SECURITY DEFINER BEFORE UPDATE scoring trigger; doc-04 formula from published policy multipliers/`revision_penalty_rule`; raw numeric no rounding; timeliness from approving review — AD4; collaboration non-scoring — AD5; D3/AD7 guards; direct-approve-without-review skips; Finance excluded; no new permission — catalog 20; no bonus changes). **Ertelenen (5-b):** manual override/adjustment (`point.override` 2-step → `manual_adjustment`); breakdown UI.
- [x] **Phase 6 — Bonus Engine (Safe Pro-Rata calculation)** ✅ (commit `0c54fba`, verified 2026-08-09; `run_bonus_calculation()` locked period+pool → allocations + immutable snapshot; approved points from `point_ledger task_approved` × period; cap/AD6 pending; T_org/AD8 top-up; largest-remainder kuruş; Σ invariant SI-13; period locked→calculated; idempotent; `09` §8 worked example birebir; Files=15/Tests=665). **`bonus_ledger` accrual → Phase 6-b done (`a65013d`).**
- [x] **Phase 6-b — Bonus Ledger Accrual** ✅ (commit `a65013d`, verified 2026-08-09; `post_bonus_accrual()` SECURITY DEFINER server-only; approved period (`period.manage` `calculated→approved`) → tek balanced accrual (debit pool=Σfinal / credit accrual per employee); idempotent per snapshot; AD6 gate (pending → blok); **BL-2** deferred trigger Σaccrual≤pool_ref (AD8-aware); BL-3 → **Phase 6-c done**; snapshot immutable; catalog 20; Finance raw-excluded; Files=16/Tests=690). **Ertelenen:** clawback (D2 gated), dispute→reversal. **Payout/export engine → Phase 6-c done (`77615e3`).**
- [x] **Phase 6-c — Payout/Export Engine** ✅ (commit `77615e3`, verified 2026-08-10; `produce_payout_export()` SECURITY DEFINER server-only: approved period + AD6 gate → `exports` record + period `approved→exported`; `mark_payout_paid()` SECURITY DEFINER server-only: exported period → per-employee balanced `payout_marked_paid` (debit accrual / credit payout; doc-06 §2); **BL-3** DEFERRABLE INITIALLY DEFERRED trigger (payout ≤ net accrual, reversal-aware); idempotency BEFORE period gate; `payout_marked_paid` unlocked (`export_id NOT NULL` CHECK); `payout_exported`+`clawback_*` still blocked; `exports unique(id,org)` + `bonus_ledger export_id` same-org composite FK; `v_finance_payout`+`v_finance_period_totals` (security_invoker, NO raw points/quality/cap_basis/comp — SI-12); catalog 20; Files=21/Tests=780/PASS). **Ertelenen:** CSV/XLSX/storage dosya yazımı, clawback (D2 gated), app/API/UI.
- [x] **Phase 6-d — Bonus Engine Authz Hardening** ✅ (commit `0b8b34a`, verified 2026-08-09; `run_bonus_calculation` + `post_bonus_accrual` giriş-authz'ı `current_user not in (...)` → **`auth.uid() IS NULL`** — SECURITY DEFINER'da `current_user`=owner olduğundan eski kontrol etkisizdi; AD1 uyum; `CREATE OR REPLACE`, gövde/mantık/imza/grant değişmedi, aynı OID; catalog 20; no seed; regresyon yok (0015/0016 trusted bağlamda geçer); Files=18/Tests=720). 0021/0022/0023 artık aynı doğru deseni kullanıyor.
- [x] **Phase 7 — Anti-Gaming & Disputes** ✅ (7-A + 7-B + 7-C done; 7-D gated):
  - [x] **Phase 7-A — Anti-Gaming Detection Engine** ✅ (commit `ffdea06`, verified 2026-08-09; `run_anti_gaming_scan()` SECURITY DEFINER server-only orkestratör + 4 `detect_*` kuralı (duplicate_task/tiny_task_splitting/same_reviewer_concentration/period_end_spike); FK-less `bonus_period_id` + dual idempotency partial unique index (OQ-2); D5 izolasyon — yalnız flag yazar, ledger'a dokunmaz, scan finansal yan-etkisiz; authz `has_role('hr') OR auth.uid() IS NULL`; hardcoded eşikler OQ-1; no auto-punish/no auto-dispute — human-in-loop; katalog 20; Files=17/Tests=712).
  - [x] **Phase 7-B — Dispute Point Adjustment** ✅ (commit `70ba400`, verified 2026-08-09; `apply_dispute_point_adjustment()` SECURITY DEFINER server-only; resolved+accepted dispute → tek `point_ledger dispute_adjustment` delta (employee=complainant); fail-closed 23514; idempotent per dispute (partial unique index + 23505 backstop); `dispute_id` + same-org composite FK → disputes (SI-7); event_type CHECK DROP+ADD; audit WHEN clause genişletildi (task_approved hariç); authz `dispute.resolve OR auth.uid() IS NULL`; D2/D9 ihlali yok; append-only korundu; katalog 20; Files=19/Tests=737).
  - [x] **Phase 7-C — Dispute Bonus Recalculation** ✅ (commit `8941089`, verified 2026-08-10; `recalculate_bonus_after_dispute()` SECURITY DEFINER server-only; run **superseded** + period **`approved→calculated`** + mevcut bonus_ledger accrual **balanced reversal** (debit↔credit swap, yeni txn_id; BL-1 append-only; Σdebit=Σcredit); **paid-guard** 23514 (OQ-4/D2); idempotent (reversal varsa no-op); authz `has_permission('period.manage') OR auth.uid() IS NULL`; **C-c1 reduced scope** — yeni run/snapshot üretilmez; dispute_adjustment → bonus bazı **Phase 7-D'de giderildi**; katalog 20; Files=20/Tests=753).
  - [x] **Phase 7-D — Dispute_adjustment → Bonus Basis** ✅ (commit `31c226f`, verified 2026-08-10; `point_ledger` + nullable `bonus_period_id` + same-org composite FK + `point_ledger_bonus_period_event_chk` CHECK; `apply_dispute_point_adjustment()` DROP+CREATE +`p_bonus_period_id`; `run_bonus_calculation()` CREATE OR REPLACE — gate `IN('locked','calculated')` + NET `approved_points` (task_approved + dispute_adjustment by bonus_period_id) + `dispute_adjustment_points` factors kırılımı; net≤0 dışlanır; 0019 test-only fix (3 satır); 15 assertion; katalog 20; Files=22/Tests=797/PASS).
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

## 5. Mevcut durum ve sıradaki adım

**Phase 7-E dispute bonus re-run orchestration verified + committed + synced** (commit `3efe95d`; db reset
0001..0029 + seed, test db **Files=23/Tests=814/PASS/Failed=0**). `recalculate_bonus_after_dispute()` CREATE OR REPLACE:
7-C C-c1 reversal/supersede/approved→calculated + YENİ `run_bonus_calculation()` çağrısı (pool DB'den; idempotency key =
'disp-recalc-snap-'+reversed_snap). Döner: yeni snapshot id (7-D engine ile dispute_adjustment bazda). Period
`'calculated'` kalır — ADR-006 human re-approval. 0020 test-only fix (3 satır). Tüm önceki dilimler korunur: Phase 3 DB
foundation + Phase 3.5 app scaffold (`a8b05ac`) + Phase 4 (`148667e`) + Phase 5 (`aa47e40`) + Phase 6 (`0c54fba`) +
Phase 6-b (`a65013d`) + Phase 6-c (`77615e3`) + Phase 6-d (`0b8b34a`) + Phase 7-A (`ffdea06`) + Phase 7-B (`70ba400`) +
Phase 7-C (`8941089`) + Phase 7-D (`31c226f`) + **Phase 7-E (`3efe95d`)** — hepsi tamam.

**Gated adaylar (her biri ayrı `implementation authorized` ve scope-lock ister — ADR-020):**

- **Phase 5-b** (manual override/adjustment): `point.override` 2-step → `manual_adjustment`; breakdown UI.
- **Phase 8** (Dashboards & UX), **Phase 9** (Testing & Security), **Phase 10** (Production Readiness).

**Henüz yetkili değil.** Başlatmak için (önce scope-lock önerilir) örnek yetki cümleleri:

`implementation authorized only for Phase 5-b — manual point override`
`implementation authorized only for Phase 8 — dashboards and UX`

> Bu cümle gelene kadar hiçbir kod/migration/test yazılmaz; sonraki her faz/dilim ayrı, faz-sınırlı yetki ister (ADR-020).
