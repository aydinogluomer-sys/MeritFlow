# 13 — Phase 2: Domain & Permissions (FINAL)

> Phase 2 finalizasyon dokümanı. Amaç: Phase 3 (Database & Ledger Foundation) başlamadan önce
> domain sınırlarını, permission modelini ve erişim sınırlarını **migration'a hazır** kesinliğe
> getirmek. **DDL/SQL/migration içermez.** Decision Lock (D1–D12 + AD1–AD10) bağlayıcıdır; çelişki
> olursa Decision Lock kazanır.

## Purpose

MVP domain boundary'lerini, entity envanterini (MVP vs V1/V2), organization/membership/role modelini,
rol bazlı erişim sınırlarını, support access ve Finance view stratejisini, compensation-sensitive veri
sınırını ve cross-tenant izolasyon stratejisini tek yerde **kesinleştirmek**. Bu doküman `14` (data
dictionary), `15` (RLS policy matrix) ve `16` (state machines) ile birlikte Phase 3 girdisidir.

## Scope

- Kapsam: MVP modülleri/entity'leri, RBAC + RLS modeli, erişim sınırları, support access, comp boundary.
- Kapsam dışı: DDL/migration (Phase 3), engine matematiği (`04`/`05`), UI implementation (`09`/Phase 8),
  Department Manager / Team Lead rolleri (V1), multi-role merge (V1, AD2), multi-team (V1, AD9).

## Assumptions

- `Assumption:` Auth = Supabase Auth; `auth.uid()` server-side erişilebilir; her oturum tek aktif org.
- `Assumption:` Tek org tek currency (TL default); çoklu currency V1+.
- `Assumption:` `projects` ve `objectives` MVP'de minimal/gizli (yalnız veri modeli; UI V1) — OQ-DM-2.
- Roller/izinler DB'den (`memberships` + `roles`/`permissions`/`role_permissions`) okunur; JWT yalnız
  identity (Decision Lock AD1).

## Non-negotiable rules

- Her tenant-veri tablosu `organization_id` taşır; RLS **ENABLED + FORCE**; RLS'siz tablo yok.
- Authorization server-side + RLS; client-side role / JWT claim **source of truth değildir** (AD1).
- Her membership tek `primary_role` (AD2); her employee her period tek `primary_team` (AD9).
- Employee başka çalışanın bonus/puan satırını ve **compensation** verisini göremez (D7/AD3/AD6).
- Finance ham task/point/comp **görmez**; yalnız dedicated `v_finance_*` view (kolon kısıtı).
- Support tenant verisine yalnız aktif `support_access_grant` ile erişir; her erişim audit'li (D4).
- Service role client'a sızdırılmaz; yalnız trusted server context.
- Cross-tenant negatif testleri **bloklayıcı** (geçmeden ilgili tablo "done" değil).

## Final MVP domain boundaries

Modular monolith; net domain klasör sınırları (ADR-013). MVP modülleri:

| Domain | Sorumluluk | Ana entity'ler |
| --- | --- | --- |
| `auth` | kimlik, oturum, org bağlamı | profiles (auth bağı) |
| `organizations` | tenant kök + ayarlar | organizations, organization_settings |
| `rbac` | rol/izin tanımı (DB authz, AD1) | roles, permissions, role_permissions, memberships |
| `users` | profil yönetimi | profiles, memberships |
| `teams` | takım yapısı | teams, team_memberships |
| `tasks` | performans girdisi + akış | tasks, task_assignments, task_comments, task_attachments, task_events |
| `reviews` | review kararı + kalite | task_reviews |
| `scoring` | policy version + puan üretimi | scoring_policies, scoring_policy_versions |
| `point-ledger` | append-only puan defteri | point_ledger |
| `bonus-periods` | dönem yaşam döngüsü | bonus_periods |
| `bonus-pools` | havuz + bileşen + eligibility | bonus_pools, bonus_pool_components, bonus_pool_eligibility |
| `bonus-calculation` | run + allocation + snapshot | bonus_calculation_runs, bonus_allocations, bonus_allocation_snapshots |
| `bonus-ledger` | double-entry money defteri | bonus_ledger |
| `compensation` | cap kaynağı (comp-sensitive) | compensation_records |
| `disputes` | itiraz akışı | disputes, dispute_events |
| `anti-gaming` | 5 deterministik flag | anti_gaming_flags |
| `audit` | append-only audit | audit_logs |
| `exports` | payout export kaydı | exports |
| `governance` | support access | support_access_grants |
| `notifications` | bildirim | notifications |

Sınır kuralları:
- `point-ledger` (puan) ile `bonus-ledger` (para) **kesin ayrı** (ADR-005/ADR-017); karıştırma yok.
- `compensation` en sıkı izole modül; yalnız `bonus-calculation` cap hesabı için ve Finance view dolaylı tüketir.
- `scoring` puanı yalnız `reviews` approve sinyaliyle üretir (approved-only).
- `bonus-calculation` yalnız locked period + locked policy/pool + locked T_org ile çalışır (AD7/AD10).

## MVP entity list

(Toplam 35 MVP tablosu; tam alan sözlüğü `14_DATA_DICTIONARY_PRE_MIGRATION.md`.)

Identity & RBAC: `organizations`, `organization_settings`, `profiles`, `memberships`, `roles`,
`permissions`, `role_permissions`.
Org yapısı: `teams`, `team_memberships`.
İş/Görev: `tasks`, `task_assignments`, `task_comments`, `task_attachments`, `task_events`, `task_reviews`.
Scoring: `scoring_policies`, `scoring_policy_versions`, `point_ledger`.
Bonus/Para: `bonus_periods`, `bonus_pools`, `bonus_pool_components`, `bonus_pool_eligibility`,
`bonus_calculation_runs`, `bonus_allocations`, `bonus_allocation_snapshots`, `bonus_ledger`,
`compensation_records`.
Yönetişim: `disputes`, `dispute_events`, `anti_gaming_flags`, `notifications`, `audit_logs`,
`exports`, `support_access_grants`.

> Not: `projects` ve `objectives` MVP'de **minimal** (veri modeli mevcut, UI gizli — OQ-DM-2); data
> dictionary'de MVP-minimal işaretli.

## Deferred V1/V2 entities

| Entity | Erteleme | Neden |
| --- | --- | --- |
| `anomaly_baselines` | V1 | Z-score/baseline anomaly (D5 ertelenen kısım) |
| `integrations` | V1+ | dış sistem/payroll adapter |
| `webhook_events` | V1+ | event dışa yayını |
| `bonus_pool_components` (aktif kullanım) | V1 | Hybrid model bileşenleri (D1; MVP'de W_individual=1.0, tablo iskelet) |
| multi-role / role merge yapıları | V1 | AD2 |
| multi-team weighted factor yapıları | V1 | AD9 |
| Department Manager / Team Lead rol satırları | V1 | D4 |
| Redis read-model projeksiyonları | V1 | ADR-009 |

> `bonus_pool_components`: MVP'de tablo **var** ama yalnız `individual` bileşeni (weight=1.0) ile;
> diğer bileşenler V1'de aktifleşir (forward-compatible iskelet).

## Organization / Membership / Role model

- `organizations` = tenant kök; tüm tenant-veri `organization_id` ile bağlanır.
- `memberships` = (organization_id, profile_id, primary_role, status) — **RLS anchor**. Bir profile aynı
  org'da **tek aktif membership** (tek primary_role). Aynı profile farklı org'larda ayrı membership
  (farklı primary_role) tutabilir.
- RBAC veri-driven: `roles` (Owner, Admin, HR, Finance, Manager, Employee, Auditor) → `role_permissions`
  → `permissions`. İzin kararı **DB lookup** ile verilir (`has_permission(key)`), JWT'den değil (AD1).
- Rol değişimi `memberships.primary_role` güncellemesi + audit; bir sonraki yetki kontrolünde anında etki
  (stale JWT yetki riski yok).

## Primary role model

- MVP'de her membership **tek `primary_role`** (AD2). Permission merge **yok**.
- İzinler rol → permission eşlemesinden türetilir; çok-rol birleştirme V1'e ertelenir.
- İleride multi-role gelirse (V1): **explicit deny / sensitive restriction allow'dan üstündür** (AD2);
  comp gibi sensitive erişimde en kısıtlayıcı yorum kazanır.
- Roller MVP'de sabit taksonomi (D4): Owner, Admin, HR, Finance, Manager, Employee, Auditor.
  Department Manager / Team Lead V1; Super Admin/Support yalnız grant ile (aşağıda).

## Primary team model (canonical source — Phase 3A kararı)

- Her employee her period/org için **tek primary team** ile değerlendirilir (AD9).
- **Tek source of truth = `team_memberships.is_primary`.** `memberships` tablosu **`primary_team_id`
  TAŞIMAZ**; ikinci bir kaynak eklenmez.
- **Gerekçe:** iki ayrı kaynak (memberships.primary_team_id + team_memberships.is_primary) drift riski
  doğururdu; tek kaynak bunu önler.
- **Constraint:** (`organization_id`, `profile_id`) başına en fazla bir `is_primary = true` (partial unique
  index) → AD9 ile birebir.
- **İleride:** task/scoring/bonus `team_factor` ve değerlendirme bu kaynaktan çözülür; bonus snapshot'larındaki
  `primary_team_id` bundan **türetilmiş** (derived) snapshot değeridir, ayrı kaynak değildir.
- **Kural:** Claude/herhangi bir ajan ileride `memberships.primary_team_id` **eklememelidir** (multi-team
  weighted V1; AD9). Bkz. ADR-019 implementation note.

## Employee / Manager / HR / Finance / Auditor access boundaries

| Rol | Görür | Yazar | Göremez (kritik) |
| --- | --- | --- | --- |
| **Employee** | kendi task/point/estimated bonus + breakdown; kendi dispute | kendi task `submit`; dispute `open` | başka çalışan bonus/puanı; **herhangi comp**; comp audit payload |
| **Manager** | kendi takımı task/review queue/team points; fairness flags | task create/assign (kendi takım); review (kendi değil) | başka takım; ham comp; kendi görevini approve **edemez** (self-approval block) |
| **HR** | org-seviyesi performans/dispute; policy/period; audit | period manage; calculation approve; dispute resolve | ham comp (yalnız `comp.read` min yetkiyle); görev teknik içeriğini değiştiremez |
| **Finance** | yalnız `v_finance_*` view (payout özeti); pool; export; clawback review | pool create; payout export/mark paid; clawback review | ham task/point/quality detayı; ham maaş (view'da maskeli); görev puanı değiştiremez |
| **Auditor** | full **read-only**: audit, snapshot, policy changes, export logs, support logs | — (hiçbir write) | hiçbir mutation; ham comp payload yalnız gerekçeli erişim + audit ile (AD3) |

Ortak kurallar:
- Manual point override: `point.override` + 2-step + reason + ayrı ledger entry + audit (Manager/Admin).
- Dispute: Manager kendi kararına **final veremez** (D9); bağımsız reviewer/HR.
- Owner/Admin: org yönetimi; Admin Finance payout onayı **veremez**; Owner support grant verebilir.

## Support access model

- Varsayılan: Super Admin / SaaS Support tenant verisine **erişemez** (D4).
- Owner bir `support_access_grant` oluşturur: `scope` + `expires_at` (süreli, sınırlı).
- Grant aktifken `has_support_grant(org)` true döner; ilgili **read** policy'leri support'a izin verir
  (yazma kapsam dışı — destek erişimi okuma odaklı).
- Her support erişimi server katmanında `audit_logs`'a (`action = support.access`) yazılır.
- Grant süresi dolunca erişim **otomatik** kapanır; uzatma yeni grant + audit ister.

## Finance view strategy

RLS yalnız **satır** filtreler; "Finance görev detayı görmesin, ödeme özeti görsün" gereksinimi **kolon**
kısıtı ister (ADR-018, `03 §4`):
- Finance'a `tasks` / `task_reviews` / `point_ledger` / `compensation_records` **doğrudan SELECT verilmez**.
- Dedicated read view'lar: `v_finance_allocation_summary`, `v_finance_payout`, `v_finance_period_totals`.
  İçerik: employee_id, display_name (veya rumuz), period, final_amount, status, paid_at,
  cap_applied (yes|no|`pending_missing_cap_basis`). **İçermez:** raw points, task içerik, quality detayı, ham maaş.
- View'lar `security_invoker` ile çalışır; alttaki tabloların RLS'ine tabidir.
- Maaş hiçbir Finance view'ında ham gösterilmez; cap yalnız "applied/pending" bilgisi olarak yansır (AD6).

## Compensation-sensitive data boundary

- `compensation_records` ayrı tablo, **compensation-sensitive** sınıf (ADR-018).
- Erişim: yalnız `comp.read` (HR/Finance **minimum** yetki). Employee/Manager **göremez**; Auditor ham
  payload'ı yalnız gerekçeli erişim + audit ile görebilir (AD3).
- Her SELECT/erişim ve her INSERT/UPDATE audit'lenir; **erişimin kendisi** ayrıca audit log üretir (AD3).
- Audit görünürlüğü: liste **masked summary** (action/actor/target/timestamp); raw before/after comp
  payload yalnız `comp.read` + gerekçeli erişim ile (AD3).
- Cap hesabı (`05 §5`): geçerli cap basis yoksa allocation `pending_missing_cap_basis`; **unlimited cap
  yok**; eksik tamamlanmadan payout export bloklanır (AD6).

## Cross-tenant isolation strategy

- Her tenant-veri tablosu `organization_id NOT NULL`; her RLS policy ilk koşul `organization_id = current_org()`.
- `current_org()` aktif membership'ten türetilir (SECURITY DEFINER + sabit search_path; recursive RLS
  kırılır).
- Helper'lar (`has_role`, `has_permission`, `manages_team`, `has_support_grant`) DB lookup; JWT'ye güvenilmez.
- Multi-org kullanıcı: her oturumda **tek aktif org**; org değişimi explicit + audit.
- Cross-tenant erişim için her tablo bazında **zorunlu negatif test** (`15` + `10`); geçmeden "done" değil.

## Domain invariants

(Tam liste + state machine etkisi `16_STATE_MACHINES_AND_INVARIANTS.md`.)
- INV-1: Puan yalnız `approved` task'tan ve yalnız bir kez ledger'a yazılır (idempotent).
- INV-2: `point_ledger` UPDATE/DELETE edilemez; düzeltme = reversal/adjustment entry.
- INV-3: Onaylı snapshot varken o döneme ait point ledger mutate edilemez (yalnız dispute → yeni run).
- INV-4: Σ(bonus allocations) ≤ pool; cap residual `undistributed_remainder` (D6).
- INV-5: Her sensitive mutation bir audit_log üretir.
- INV-6: Calculation snapshot tüm faktörleri kaydeder (role/team/eligibility/proration/cap basis/T_org — AD7).
- INV-7: Bonus snapshot olmadan payout/export yok; `pending_missing_cap_basis` export'u bloklar (AD6).
- INV-8: Her tenant-veri satırı tek bir `organization_id`'ye ait; cross-tenant read/write yok.

## Edge cases

- Aynı profile iki org'da: ayrı membership (her biri tek primary_role); RLS her sorguda org bağlamı uygular.
- Reviewer takımdan ayrılır: açık review'lar yeniden atanır (Manager/HR reassign — OQ-DM-1).
- Davet edilmiş ama katılmamış kullanıcı: membership `pending`; eligible değil (OQ-PRD-2; öneri: hayır).
- Employee birden çok takımda: period değerlendirmesi `primary_team` üzerinden (AD9).
- Org henüz scoring policy yayınlamadı: görev approve edilemez (policy version zorunlu).
- Support grant süresi dolmuş ama oturum açık: bir sonraki erişim kontrolünde reddedilir (grant DB'den okunur).

## Acceptance criteria

- Tüm MVP entity'leri bir domaine yerleşmiş; V1/V2 ertelenenler işaretli.
- Her rol için erişim sınırı tablo bazında netleştirilmiş (`15` ile birebir).
- Finance hiçbir yoldan ham task/point/comp'a ulaşamıyor (view-only).
- Employee başka çalışan bonus/point ve comp audit payload'ını göremiyor.
- Support yalnız aktif grant ile + audit; service role client'ta yok.
- Cross-tenant izolasyon her tablo için negatif teste bağlanmış.

## Test implications

- RLS negatif suite (her tablo, cross-tenant) — bloklayıcı.
- AD1: manipüle JWT claim yetki kazanmaz (authz DB'den).
- AD3: employee comp audit payload göremez; raw yalnız yetki+gerekçe; erişim audit üretir.
- Finance view kolon testi (yalnız izin verilen kolonlar).
- Self-approval block (reviewer ≠ assignee) testi.
- primary_role tekliği + primary_team tekliği testleri (AD2/AD9).

## Open questions

- OQ-DM-1: Reviewer ayrıldığında açık review reassign kuralı (öneri: Manager/HR). — **Phase 3'ü bloklamaz** (Phase 4).
- OQ-DM-2: `projects`/`objectives` MVP'de UI'da görünür mü (öneri: minimal/gizli). — V1.
- OQ-PRD-2: Davet edilmiş ama katılmamış kullanıcı eligible mi (öneri: hayır). — V1.
- OQ-RLS-2: comp erişim audit'i trigger vs server-only (AD3 zorunlu kılar; mekanizma Phase 3 detayı).

## Phase 3 readiness checklist

1. [x] MVP entity envanteri kesin (35 tablo) + V1/V2 ertelenenler işaretli.
2. [x] RBAC modeli (roles/permissions/role_permissions/memberships) DB-driven authz ile tanımlı (AD1).
3. [x] Her rol için tablo bazında erişim sınırı netleştirildi (`15`).
4. [x] Finance view stratejisi (`v_finance_*`, kolon kısıtı) tanımlı.
5. [x] Compensation boundary + cap basis eksikliği akışı (AD6) tanımlı.
6. [x] Cross-tenant izolasyon stratejisi + zorunlu negatif test kapsamı belirli.
7. [x] Domain invariants (INV-1..INV-8) + state machine'ler (`16`) tanımlı.
8. [x] Data dictionary (`14`) tüm alan/constraint/index/RLS/sensitivity ile hazır.
9. [ ] (Phase 3) DDL + RLS policy + ledger + audit + seed implementasyonu — **`implementation authorized` bekler**.
