# 15 — RLS Policy Matrix (Pre-Migration)

> Migration öncesi RLS policy **intent** matrisi. **DDL/SQL/policy gövdesi içermez** — Phase 3'te
> yazılır ve `implementation authorized` bekler. Notasyon: `USING` = okunabilir satır filtresi;
> `WITH CHECK` = yazılabilir satır kısıtı. Decision Lock (AD1–AD10) bağlayıcıdır.

## Purpose

Her kritik tablo için rol bazlı SELECT/INSERT/UPDATE/DELETE + WITH CHECK intent'ini, yasak erişimleri,
gerekli helper fonksiyonu ve zorunlu negatif testi **migration'a hazır** kesinlikte tanımlamak.

## Scope

- Kapsam: MVP kritik tablolar; 9 erişim öznesi (aşağıda).
- Kapsam dışı: gerçek policy SQL, kolon-maskeleme implementasyonu (view + Phase 3).

## Erişim özneleri (roller)

`Owner`, `Admin`, `HR`, `Finance`, `Manager`, `Employee`, `Auditor`, `Support (aktif grant)`,
`Service role (server-only)`.

> **Genel kurallar (tüm tablolarda, tekrar yazılmaz):**
> - Her policy ilk koşul: `organization_id = current_org()` → **cross-tenant her zaman bloklu**.
> - Her tabloda RLS **ENABLED + FORCE** (owner bypass yok).
> - **Auditor** hiçbir tabloda write yapamaz (read-only; her INSERT/UPDATE/DELETE reddedilir).
> - **Support** yalnız aktif `has_support_grant(org)` ile **read**; write kapsam dışı; her erişim audit.
> - **Service role** RLS'i bypass eder ama yalnız trusted server context; authz uygulama katmanında
>   ayrıca doğrulanır; client'a **asla** sızdırılmaz (ADR-012/ADR-014).
> - Rol/izin **DB'den** okunur (AD1); JWT yalnız identity.

## Helper fonksiyonları (intent; `SECURITY DEFINER` + sabit search_path)

- `current_org() -> uuid` — aktif membership'in org_id'si.
- `has_role(key) -> bool` — current_org'da primary_role (DB lookup).
- `has_permission(key) -> bool` — role_permissions üzerinden (DB lookup).
- `manages_team(team_id) -> bool` — kullanıcı bu takımın manager'ı mı.
- `team_of(employee_id) -> uuid` — employee'nin primary_team'i; **`team_memberships.is_primary`'den** çözülür
  (canonical source; `memberships.primary_team_id` yoktur — AD9, bkz. doc 13 "Primary team model").
- `has_support_grant(org) -> bool` — aktif support grant var mı.
- `owns_review_decision(dispute_id) -> bool` — kullanıcı ihtilaf konusu kararın sahibi mi (D9 guard).

---

## Tablo bazlı policy intent

### memberships
- **SELECT:** Employee `profile_id = auth.uid()`; HR/Owner/Admin org; Manager kendi takım üyeleri; Auditor RO; Support(grant) RO.
- **INSERT/UPDATE:** WITH CHECK `has_permission('user.invite')` (Owner/Admin/HR); role değişimi audit.
- **DELETE:** yasak (deactivate = status update; iz korunur).
- **forbidden:** Employee başka membership'i değiştiremez; Finance yazamaz.
- **helper:** `current_org`, `has_permission`, `manages_team`. **negatif test:** employee başka kullanıcının rolünü değiştiremez; cross-tenant membership görünmez.

### roles / permissions / role_permissions
- **SELECT:** tüm roller read (authz helper okur). **INSERT/UPDATE/DELETE:** yalnız Owner/Admin (`role_permissions` change audit'li).
- **forbidden:** Employee/Manager/Finance write; client'tan değişiklik.
- **helper:** `has_permission('role.manage')`. **negatif test:** Manager izin eşlemesi değiştiremez; JWT claim ile yetki yükseltme reddedilir (AD1).

### tasks
- **SELECT:** `assignee_id = auth.uid()` OR `created_by` OR `reviewer_id` OR `manages_team(team_id)` OR
  HR/Admin/Owner/Auditor; Support(grant) RO. **Finance: SELECT YOK** (yalnız `v_finance_*`).
- **INSERT:** WITH CHECK `has_permission('task.create')` AND (`manages_team(team_id)` OR Admin).
- **UPDATE:** assignee yalnız kendi görevinde `submit` geçişi (status whitelist); reviewer yalnız
  `task.review` AND `reviewer_id = auth.uid()` AND `assignee_id <> auth.uid()` (**self-approval block**);
  period locked ise mutation reddedilir.
- **DELETE:** yasak (cancel/archive = status). **forbidden:** **Finance ham task göremez**; Employee başka görev göremez; manager başka takım göremez.
- **helper:** `manages_team`, `has_permission`, `has_role`. **negatif test:** **manager kendi görevini approve edemez**; manager başka takım görevini göremez; finance task SELECT reddedilir; cross-tenant task görünmez.

### task_assignments / task_comments / task_attachments
- **SELECT:** ilgili `tasks` SELECT'i görenler. **INSERT:** task katılımcıları (`task.create`/atama; comment author = auth.uid()).
- **UPDATE/DELETE:** comment/attachment soft-delete (Phase 4 OQ); assignments DELETE yasak (iz).
- **forbidden:** Finance ham içerik; başka task katılımcısı olmayan employee. **helper:** task SELECT helper'ları.
- **negatif test:** task'a erişimi olmayan employee comment/attachment göremez; cross-tenant blok.

### task_events
- **SELECT:** `tasks` görenler + Auditor. **INSERT:** trusted/server (durum geçişinde). **UPDATE/DELETE:** **yasak (append-only)**.
- **forbidden:** herkes için UPDATE/DELETE. **helper:** task SELECT helper'ları. **negatif test:** task_event UPDATE/DELETE reddedilir.

### task_reviews
- **SELECT:** ilgili task SELECT'i görenler. **INSERT:** WITH CHECK `has_permission('task.review')` AND
  `reviewer_id = auth.uid()` AND `task.assignee <> auth.uid()` AND (approve ⇒ quality <> poor).
- **UPDATE/DELETE:** yasak (yeni karar = yeni satır). **forbidden:** **self-review**; Finance; başka takım manager'ı.
- **helper:** `has_permission('task.review')`, `manages_team`. **negatif test:** reviewer = assignee reddi (self-approval); quality=poor approve reddi (D3).

### scoring_policies / scoring_policy_versions
- **SELECT:** org read. **INSERT/UPDATE:** HR/Admin (`policy.manage`); **published version immutable** (UPDATE yasak).
- **DELETE:** yasak. **forbidden:** Employee/Manager/Finance write; published version mutation.
- **helper:** `has_permission('policy.manage')`. **negatif test:** published version değiştirilemez; locked period'da version değişmez (AD7).

### point_ledger  *(append-only — ADR-005)*
- **SELECT:** `employee_id = auth.uid()` OR `manages_team(team_of(employee_id))` OR HR OR Auditor; Support(grant) RO.
  **Finance: SELECT YOK** (yalnız view). **Employee yalnız kendi satırı.**
- **INSERT:** trusted/server (scoring approve, manual_adjustment, dispute_adjustment, reversal); manual_adjustment WITH CHECK `point.override` + reason + audit.
- **UPDATE/DELETE:** **yasak (append-only — INV-2).** **forbidden:** **Employee başka çalışanın puanını göremez**; Finance ham puan göremez; herkes UPDATE/DELETE.
- **helper:** `manages_team`, `team_of`, `has_role`, `has_permission`. **negatif test:** **employee ≠ başka employee point satırı**; point_ledger UPDATE/DELETE reddedilir; finance ham point SELECT reddedilir.

### bonus_periods / bonus_pools / bonus_pool_components / bonus_pool_eligibility
- **SELECT:** HR/Finance/Auditor org; Employee yalnız kendi eligibility (pool/period özeti); Support(grant) RO.
  **Employee başka çalışan eligibility/pool detayını göremez.**
- **INSERT/UPDATE:** period → HR/Owner (`period.manage`); pool → Finance (`pool.create`); pool **locked sonrası
  amount UPDATE yasak** (new version — AD10). **DELETE:** yasak.
- **forbidden:** Manager/Employee pool düzenleme; locked pool silent mutation. **helper:** `has_permission('period.manage'|'pool.create')`.
- **negatif test:** **manager HR-approved bonus pool düzenleyemez**; locked pool amount değişmez (AD10); employee başka eligibility göremez.

### bonus_calculation_runs / bonus_allocations / bonus_allocation_snapshots
- **SELECT:** Employee yalnız kendi allocation (`employee_id = auth.uid()`); HR org; **Finance view-only
  (`v_finance_*`)**; Auditor RO snapshot. **Employee başka allocation göremez.**
- **INSERT:** yalnız calculation run (trusted/server). **UPDATE/DELETE:** allocation status geçişi trusted;
  **snapshot immutable (UPDATE/DELETE yasak — INV-6)**; run idempotent (idempotency_key).
- **forbidden:** **Employee başka çalışan bonus'u**; Finance ham allocation/snapshot (yalnız view); snapshot mutation.
- **helper:** `has_role`, `has_permission`. **negatif test:** **employee ≠ başka employee bonus/allocation**; snapshot UPDATE reddedilir; finance ham allocation SELECT reddedilir (view-only).

### bonus_ledger  *(double-entry — ADR-017)*
- **SELECT:** `has_role('Finance')` OR Auditor; Employee yalnız **özet** (view ile, ham satır değil); Support(grant) RO.
- **INSERT:** trusted (accrual/payout/clawback); accrual WITH CHECK `snapshot_id NOT NULL`.
- **UPDATE/DELETE:** **yasak (düzeltme = reversal).** **forbidden:** Employee ham money satırı; Manager; herkes UPDATE/DELETE.
- **helper:** `has_role('Finance')`. **negatif test:** employee ham bonus_ledger göremez (yalnız özet); ledger UPDATE/DELETE reddedilir.

### compensation_records  *(comp-sensitive — ADR-018, AD3/AD6)*
- **SELECT:** yalnız `has_permission('comp.read')` (HR/Finance min). **Employee/Manager YOK.** Auditor ham
  yalnız gerekçeli erişim + audit. Her SELECT erişimi audit'lenir.
- **INSERT/UPDATE:** WITH CHECK `has_permission('comp.read')` + audit zorunlu (change audit'li).
- **DELETE:** yasak (supersede; silme legal-review). **forbidden:** **Employee kendi/başka comp göremez**; Manager comp göremez; Finance ham maaşı view'da maskeli.
- **helper:** `has_permission('comp.read')`. **negatif test:** **employee comp_record SELECT reddedilir**; comp SELECT erişimi audit üretir (AD3); manager comp göremez; cross-tenant comp blok.

### disputes / dispute_events
- **SELECT:** `complainant_id = auth.uid()` OR `assigned_reviewer_id = auth.uid()` OR HR OR Auditor.
- **INSERT (open):** WITH CHECK `dispute.open` AND `complainant_id = auth.uid()`. **UPDATE (resolve):**
  `dispute.resolve` AND NOT `owns_review_decision(dispute_id)` (**manager kendi kararına final veremez — D9**).
- **DELETE:** yasak; dispute_events append-only. **forbidden:** ilgisiz employee; manager kendi kararına final.
- **helper:** `has_permission('dispute.open'|'dispute.resolve')`, `owns_review_decision`. **negatif test:** **manager kendi reddine final karar veremez**; ilgisiz employee dispute göremez.

### anti_gaming_flags
- **SELECT:** Manager (kendi takım) + HR + Auditor; `subject_employee_id = auth.uid()` (kendi flag'i, şeffaflık).
- **INSERT:** trusted/server (kural motoru). **UPDATE (confirm/dismiss):** Manager/HR (`flag.review`) + audit;
  **confirmed flag otomatik finansal etki üretmez.** **DELETE:** yasak.
- **forbidden:** başka çalışanın flag detayı (employee); otomatik ceza. **helper:** `manages_team`, `has_permission('flag.review')`.
- **negatif test:** confirmed flag tek başına ledger entry üretmez; employee başka flag göremez.

### notifications
- **SELECT/UPDATE:** yalnız `recipient_id = auth.uid()` (read/mark read). **INSERT:** trusted/server.
- **DELETE:** kendi (veya TTL). **forbidden:** başkasının bildirimi. **helper:** —. **negatif test:** employee başka recipient bildirimi göremez.

### audit_logs  *(append-only — ADR-006, AD3)*
- **SELECT:** `has_permission('audit.read')` — Owner/Admin/HR full; **Finance financial subset**; Auditor full RO;
  comp-ilişkili satırlar **masked summary**, raw before/after yalnız `comp.read` + gerekçe (AD3) — ve bu erişim **ayrıca audit**.
- **INSERT:** trusted/server. **UPDATE/DELETE:** **yasak (append-only).** **forbidden:** Employee audit; comp raw payload yetkisiz; herkes UPDATE/DELETE.
- **helper:** `has_permission('audit.read'|'comp.read')`. **negatif test:** **employee comp audit payload göremez**; raw comp audit yalnız yetki+gerekçe ile + erişim audit üretir (AD3); audit UPDATE/DELETE reddedilir.

### exports
- **SELECT:** Finance + Auditor. **INSERT:** Finance (`payout.export`) WITH CHECK `snapshot_id NOT NULL` AND
  ilgili allocation'larda `pending_missing_cap_basis` **yok** (AD6). **UPDATE/DELETE:** yasak.
- **forbidden:** **snapshot olmadan export**; `pending_missing_cap_basis` varken export; Employee.
- **helper:** `has_permission('payout.export')`. **negatif test:** snapshot'sız export reddi; cap basis eksikken export bloklanır (AD6).

### support_access_grants
- **SELECT:** Owner + Auditor. **INSERT:** `has_permission('support.grant')` (Owner). **UPDATE (revoke):** Owner.
- **DELETE:** yasak (iz). **forbidden:** Support kendine grant; Employee/Manager. **helper:** `has_permission('support.grant')`.
- **negatif test:** **support grant olmadan tenant verisine erişemez**; grant ile erişim audit üretir; süresi dolan grant erişim vermez.

### organizations / organization_settings
- **SELECT:** üye olunan org (membership). **UPDATE settings:** Owner/Admin (`org.settings.write`) + audit.
- **DELETE:** yasak (MVP). **forbidden:** Employee org settings write; cross-tenant org. **helper:** `has_permission('org.settings.write')`.
- **negatif test:** employee org settings değiştiremez; cross-tenant org görünmez.

### teams / team_memberships
- **SELECT:** org görür (kendi takım vurgulu). **INSERT/UPDATE:** `team.manage` (Owner/Admin; Manager kendi takım).
- **DELETE:** yasak (soft). **forbidden:** Employee takım yönetimi. **helper:** `has_permission('team.manage')`, `manages_team`.
- **negatif test:** employee takım yönetemez; manager başka takımı yönetemez.

---

## Finance view stratejisi (kolon gizliliği — RLS satır filtreler, kolon değil)

- Finance'a `tasks`/`task_reviews`/`point_ledger`/`compensation_records` **doğrudan SELECT yok**.
- Dedicated view'lar (`security_invoker`, alttaki RLS'e tabi): `v_finance_allocation_summary`,
  `v_finance_payout`, `v_finance_period_totals`. İçerik: employee_id, display_name/rumuz, period,
  final_amount, status, paid_at, cap_applied (yes|no|`pending_missing_cap_basis`). **İçermez:** raw points,
  task içerik, quality detayı, ham maaş.
- **negatif test:** Finance view yalnız izin verilen kolonları döndürür; ham puan/maaş kolonları yok.

## Kritik risk kapanışı (özet — her biri zorunlu negatif test)

| Risk | Kapanış | Zorunlu negatif test |
| --- | --- | --- |
| Employee başka çalışan bonus'u | allocation/snapshot SELECT `employee_id = auth.uid()` | employee ≠ başka allocation |
| Employee başka comp | comp SELECT yalnız `comp.read`; employee yok | employee comp SELECT reddi |
| Finance görev detayı | Finance'a task/point SELECT yok; yalnız `v_finance_*` | finance task/point SELECT reddi |
| Manager kendi görevini approve | review WITH CHECK `assignee <> reviewer` | reviewer=assignee reddi |
| Manager yalnız kendi takım | task SELECT `manages_team` | manager ≠ başka takım |
| Auditor read-only | hiçbir write policy | auditor write reddi |
| Support grant yoksa erişim yok | read policy'ler `has_support_grant` ister | grant'sız erişim reddi |
| Service role client sızıntısı | env secret; client bundle taraması | bundle'da secret yok |
| Cross-tenant | her policy `organization_id = current_org()` | A org → B org reddi (her tablo) |

## Acceptance criteria

- Her kritik tablo için SELECT/INSERT/UPDATE/DELETE + WITH CHECK intent tanımlı.
- Append-only tablolar (point_ledger, bonus_ledger, audit_logs, *_events, snapshots) UPDATE/DELETE yasaklı.
- Yukarıdaki 9 kritik risk her biri policy + zorunlu negatif teste bağlı.
- Finance view-only; comp employee/Manager'a kapalı; comp erişimi audit'li (AD3).

## Test implications

- RLS negatif suite (bloklayıcı): yukarıdaki risk tablosu + cross-tenant her tablo.
- AD1: JWT claim manipülasyonu yetki kazandırmaz (authz DB'den).
- AD3: comp audit payload employee'ye kapalı; raw yetki+gerekçe + erişim audit.
- AD6: `pending_missing_cap_basis`/snapshot'sız export bloğu.
- Append-only: ledger/audit/snapshot UPDATE/DELETE reddi.

## Open questions

- OQ-RLS-2: comp erişim audit'i (SELECT dahil) DB trigger ile mi server-only mı (AD3 zorunlu; mekanizma Phase 3).
- OQ-RLS-4: `v_finance_*` view'larında rumuz mu display_name mı varsayılan (privacy; öneri: rumuz, org ayarı).
- OQ-RLS-5: Support read kapsamı tablo-bazlı whitelist mi tüm-read mi (öneri: whitelist; Phase 3).
