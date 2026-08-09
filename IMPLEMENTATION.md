# MeritFlow — Implementation Status & TODO

> **Yaşayan durum/todo takip dosyası.** Detaylı "neden/nasıl" için kaynak: `docs/planning/` (00–18),
> `docs/adr/` (ADR-001…020), `CLAUDE.md`. Çelişki olursa `docs/planning/00_DECISION_LOCK.md` kazanır.
> Bu dosya **kod değildir**; yalnızca nerede olduğumuzu ve ne yapacağımızı izler.
> Son güncelleme: 2026-08-09 (Phase 7-A anti-gaming detection engine verified + committed + docs sync).

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
| Phase 6-b bonus_ledger accrual | `post_bonus_accrual()` SECURITY DEFINER server-only: approved period (ADR-006 snapshot-approval boundary — period calculated→approved via `period.manage`) → tek balanced accrual (debit pool=Σfinal / credit accrual per employee) from the completed run's snapshot; idempotent per snapshot; **AD6 gate** (pending_missing_cap_basis → blok); **BL-2** deferred trigger Σaccrual≤pool_ref (AD8-aware); BL-3 payout fazına ertelendi; snapshot immutable (approval period-level); no new permission — catalog 20; Finance raw-excluded (SI-12) | `migrations/0022`, `seed` (Org C auditor), `tests/0016` | ✅ **verified** | commit `a65013d`; 2026-08-09 |
| Phase 7-A anti-gaming detection engine | `run_anti_gaming_scan()` SECURITY DEFINER server-only orkestratör + 4 `detect_*` fonksiyonu (duplicate_task, tiny_task_splitting, same_reviewer_concentration, period_end_spike); `anti_gaming_flags`'a FK-less `bonus_period_id` kolonu + **dual idempotency** partial unique index (OQ-2: task-scoped `related_task_id` / period-scoped `bonus_period_id`); **D5 izolasyon** — yalnız flag yazar, ledger/bonus/comp'a dokunmaz (scan finansal yan-etkisiz); authz `has_role('hr') OR auth.uid() IS NULL`; hardcoded eşikler (OQ-1); no new permission — catalog 20 | `docs/planning/19`, `migrations/0023`, `tests/0017` | ✅ **verified** | commit `ffdea06`; 2026-08-09 |

**Runtime verification (2026-08-09, local dev stack, npx Supabase CLI 2.109.1):** `supabase db reset`
migrations **0001..0023** + seed temiz uyguladı; `supabase test db` → **Files=17, Tests=712, Result=PASS,
Failed=0** (`0001`..`0017` ok). `db reset`'teki geçici container flake'leri (`ENOTFOUND`/timeout/"exit 1" —
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
**Finance + Auditor SELECT** — **HR/Manager/Employee/Support hariç**. **Hariç:** export generation motoru,
CSV/XLSX/storage yazımı, checksum hesabı, status progression motoru, **period=`approved` gate** (export
engine'e ertelendi), bonus_ledger `payout_exported`/`payout_marked_paid` wiring, mark-paid, Finance aggregate
`v_finance_*` view'ları, notifications, app/API/UI.

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
(AD8-aware: snapshot `pool_ref_minor` / top-up bütçesi). **BL-3** (payout ≤ accrual) **payout fazına ertelendi** (6-b'de
producer yok — OQ-2). **OQ-1:** approval + posting **iki ayrı adım**. **Finance+Auditor raw read; server-only** (SI-12).
**Verified:** worked example accrual birebir (credits 3.177.630 / 3.177.629 / 953.289 / 2.691.452; debit pool 10.000.000;
Σdebit=Σcredit) + approval gate + idempotency + BL-2 red + AD6 blok + append-only + RLS. İki in-slice **test-only** fix
(Section A query'lerini Org C'ye scope + `::bigint` cast); **migration/engine bug yok**. **Hariç (sonraki):** payout/export
engine + `payout_exported`/`payout_marked_paid` wiring + `v_finance_*`, clawback, dispute→reversal orchestration, UI/API.

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
**Hariç (gated):** point_ledger/bonus_ledger yazımı, dispute wiring (7-B/7-C), `organization_settings` eşik kolonu,
`self_approval_attempt` trail, app/UI/API.

**⚠️ Güvenlik gözlemi (7-A kapsamı dışı — committed, hardening bekliyor):** `run_bonus_calculation` (0021) +
`post_bonus_accrual` (0022) **aynı latent authz zayıflığını** taşır — `current_user not in ('authenticated','anon')`
kontrolü SECURITY DEFINER içinde etkisizdir (`current_user` = fonksiyon sahibi), dolayısıyla `period.manage`
gerçekte authenticated çağrı için zorlanmıyor. Şu an **app/client bu fonksiyonları çağırmıyor** (server-only, UI
yok) → **istismar yüzeyi yok**. 0021/0022 committed + 7-A kapsamı dışı olduğu için **bu dilimde dokunulmadı**;
**ayrı bir hardening dilimi**nde `auth.uid() IS NULL`-tabanlı authz'a çekilmesi önerilir.

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

**✅ Doküman senkron güncel (2026-08-09):** `supabase/README.md`, `docs/planning/12`, bu dosya —
0001..0023 (3A/3B/comp/bonus-P/P/bonus-C/E/bonus-C/R/A/S/bonus-ledger/disputes/anti-gaming/notifications/exports,
**Phase 4 task/review core** `148667e`, **Phase 5 scoring engine** `aa47e40`, **Phase 6 bonus engine** `0c54fba`,
**Phase 6-b bonus_ledger accrual** `a65013d`, **Phase 7-A anti-gaming detection engine** `ffdea06`) verified
(**Files=17/Tests=712/PASS**), **Phase 3.5 app scaffold** (`a8b05ac`) durumunu yansıtıyor. **Phase 3 DB foundation +
app scaffold + Phase 4 core + Phase 5 scoring + Phase 6 bonus calculation engine + Phase 6-b bonus_ledger accrual +
Phase 7-A anti-gaming detection engine tamamlandı; dispute post-decision (7-B/7-C) + payout/export engine gated.**
`docs/planning/18` Phase 3B DB planı olarak **korunur** (dokunulmadı); `docs/planning/19` Phase 7 planı (7-A done,
7-B/7-C gated). Ayrıca `docs/planning/14` idempotency + markdownlint sync `dae4c6b`; `docs/adr/ADR-020` markdownlint
`53d90de`; **docs hijyen (ADR-014 + Decision Lock) `17a964d`, (ADR-006 + ADR-017) `98c0b59`, (doc-07 + doc-08)
`91b6ce9`** ile tamamlandı.

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
- [x] **Phase 6-b — Bonus Ledger Accrual** ✅ (commit `a65013d`, verified 2026-08-09; `post_bonus_accrual()` SECURITY DEFINER server-only; approved period (`period.manage` `calculated→approved`) → tek balanced accrual (debit pool=Σfinal / credit accrual per employee); idempotent per snapshot; AD6 gate (pending → blok); **BL-2** deferred trigger Σaccrual≤pool_ref (AD8-aware); BL-3 payout fazına ertelendi; snapshot immutable; catalog 20; Finance raw-excluded; Files=16/Tests=690). **Ertelenen (Phase 7+):** payout/export engine, clawback, dispute→reversal.
- [~] **Phase 7 — Anti-Gaming & Disputes** (partial — 7-A done; 7-B/7-C gated):
  - [x] **Phase 7-A — Anti-Gaming Detection Engine** ✅ (commit `ffdea06`, verified 2026-08-09; `run_anti_gaming_scan()` SECURITY DEFINER server-only orkestratör + 4 `detect_*` kuralı (duplicate_task/tiny_task_splitting/same_reviewer_concentration/period_end_spike); FK-less `bonus_period_id` + dual idempotency partial unique index (OQ-2); D5 izolasyon — yalnız flag yazar, ledger'a dokunmaz, scan finansal yan-etkisiz; authz `has_role('hr') OR auth.uid() IS NULL`; hardcoded eşikler OQ-1; no auto-punish/no auto-dispute — human-in-loop; katalog 20; Files=17/Tests=712).
  - [ ] **Phase 7-B — Dispute Point Adjustment** ⛔ gated (`0024`: point_ledger `dispute_adjustment` — resolved+accepted dispute → tek delta satırı; append-only korunur; audit).
  - [ ] **Phase 7-C — Dispute Bonus Recalculation** ⛔ gated (`0025`: superseded old run + period `approved→calculated` re-approval + yeni run/snapshot + paid-accrual guard (OQ-4/D2) → bonus_ledger reversal + yeni accrual).
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

Phase 7-A anti-gaming detection engine **verified + committed + synced** (commit `ffdea06`; db reset 0001..0023 + seed,
test db **Files=17/Tests=712/PASS/Failed=0**). `run_anti_gaming_scan()` SECURITY DEFINER server-only orkestratör + 4
`detect_*` kuralı (duplicate_task/tiny_task_splitting/same_reviewer_concentration/period_end_spike) mevcut
`anti_gaming_flags` (0016) container'ına **idempotent flag** üretir (OQ-2 dual key: FK-less `bonus_period_id` +
task/period-scoped iki partial unique index); **D5 izolasyon** — yalnız flag yazar, hiçbir ledger/bonus/comp tablosuna
dokunmaz (scan finansal yan-etkisiz); authz `has_role('hr') OR auth.uid() IS NULL`; hardcoded eşikler (OQ-1); no
auto-punish / no auto-dispute (human-in-loop); yeni permission yok (katalog 20). Önceki durum korunur: Phase 3 DB
foundation, Phase 3.5 app scaffold (`a8b05ac`), Phase 4 (`148667e`), Phase 5 (`aa47e40`), Phase 6 (`0c54fba`),
Phase 6-b (`a65013d`) — hepsi tamam.

**Sıradaki adım = Phase 7-B — Dispute Point Adjustment** (`0024`: point_ledger `dispute_adjustment` — resolved+accepted
dispute → tek delta earning/adjustment satırı; append-only korunur; audit; sonra **7-C** recalculation + bonus_ledger
reversal — ADR-006/017, D2/OQ-4 paid-accrual guard). **Alternatif öncelikli ara-dilim: 0021/0022 authz hardening** —
`run_bonus_calculation` + `post_bonus_accrual` içindeki etkisiz `current_user`-tabanlı authz'ı `auth.uid() IS NULL`
kontrolüne çekmek (7-A'da `run_anti_gaming_scan` için yapıldı; bu iki motorda latent kaldı — şu an app çağırmıyor,
istismar yüzeyi yok). Diğer ara-dilim: **payout/export engine** (`payout_exported`/`payout_marked_paid` +
`v_finance_*` + BL-3 hard-enforce). **Kod-yazmadan-önce scope-lock** önerilir; ayrı faz-sınırlı yetki gerektirir (ADR-020).
(Ops./ertelenen: **Phase 5-b** manual override/adjustment; submit/review **Server Actions + UI**.)

**Henüz yetkili değil.** Başlatmak için (önce scope-lock önerilir) yetki cümlesi (örnek):

`implementation authorized only for Phase 7-B — dispute point adjustment`
(veya hardening: `implementation authorized only for Phase 6-d — bonus engine authz hardening`)

> Bu cümle gelene kadar hiçbir kod/migration/test yazılmaz; sonraki her faz/dilim ayrı, faz-sınırlı yetki ister (ADR-020).
