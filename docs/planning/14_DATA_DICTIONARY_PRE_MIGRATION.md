# 14 — Data Dictionary (Pre-Migration)

> Migration öncesi tablo sözlüğü. **DDL/SQL/migration içermez** — bu Phase 3 işidir ve
> `implementation authorized` bekler. Alanlar "intent" düzeyinde tanımlıdır; tipler kavramsaldır.
> Decision Lock (D1–D12 + AD1–AD10) bağlayıcıdır.

## Purpose

Phase 3 schema/migration'ı için her tablonun amacını, alanlarını, ilişkilerini, kısıtlarını, index
ihtiyacını, audit/RLS gereksinimini, veri hassasiyetini ve retention notunu **migration'a hazır**
kesinlikte sabitlemek.

## Scope

- Kapsam: MVP tabloları (tam) + V1/V2 ertelenen tablolar (işaretli).
- Kapsam dışı: gerçek DDL, tip seçimleri (numeric precision vs.), trigger/function gövdeleri (Phase 3).

## Konvansiyonlar

- Her tenant-veri tablosunda: `id uuid PK`, `organization_id uuid FK→organizations` (NOT NULL),
  `created_at`, `updated_at` (immutable defterlerde `updated_at` yok). Bunlar tekrar yazılmaz; "required
  fields" bunları **varsayar**.
- Para: integer **minor unit (kuruş)** + `currency`. Puan: numeric.
- Sensitive data classes: `public/internal`, `confidential`, `personal-data`, `compensation-sensitive`,
  `audit-critical`, `financial-critical`.
- "RLS requirement" her tabloda ENABLED + FORCE varsayar; satırda erişim **özeti** verilir (tam matris `15`).
- "audit requirement" = bu tablodaki mutation `audit_logs` üretir mi.

---

## Identity & RBAC

### organizations
- **purpose:** tenant kök.
- **owner domain:** organizations. **status:** MVP. **sensitivity:** internal.
- **required:** `id`, `name`, `slug`, `currency` (default TRY), `status` (active|suspended), `created_at`.
- **optional:** `locale`, `logo_url`, `legal_name`, `tax_meta jsonb`.
- **FK:** — (kök). **unique:** `slug` global unique. **check:** `status ∈ {...}`.
- **indexes:** `slug` unique. **audit:** org settings/policy değişimi (ilgili tablolarda). **RLS:** üye olunan org görünür.
- **retention:** kalıcı (tenant yaşam döngüsü). **OQ:** org silme/anonimleştirme V1.

### organization_settings
- **purpose:** org-seviyesi default policy (cap_default, locale, bonus defaults, anti-gaming eşikleri).
- **owner:** organizations. **status:** MVP. **sensitivity:** confidential.
- **required:** `organization_id` (unique 1-1), `cap_rate_default` (0.50), `period_type` (monthly).
- **optional:** `anti_gaming_thresholds jsonb`, `leaderboard_visibility`, `winner_overlay_enabled` (false).
- **FK:** `organization_id`. **unique:** `organization_id` (1-1). **check:** `cap_rate_default ∈ [0,1]`.
- **indexes:** `organization_id`. **audit:** **evet** (policy change). **RLS:** Owner/Admin write; org read.
- **retention:** kalıcı. **OQ:** ayar versiyonlama gerekli mi (öneri: kritik ayarlar policy version'da).

### profiles
- **purpose:** kullanıcı profili (Supabase auth kimliğine bağlı).
- **owner:** users. **status:** MVP. **sensitivity:** personal-data.
- **required:** `id` (= auth uid veya bağlı), `display_name`, `created_at`.
- **optional:** `avatar_url`, `alias` (leaderboard rumuz), `locale`, `email` (auth'tan türevse opsiyonel).
- **FK:** auth.users (Supabase). **unique:** auth bağı. **check:** —.
- **indexes:** PK. **audit:** deactivation (membership üzerinden). **RLS:** kendi profili + aynı org görünür alanlar.
- **retention:** KVKK — hesap silme/anonimleştirme legal-review item. **OQ:** PII minimizasyon kapsamı (Privacy Center, V1).

### memberships
- **purpose:** (organization, profile, primary_role) — **RLS anchor**; tenant üyeliği.
- **owner:** rbac/users. **status:** MVP. **sensitivity:** confidential.
- **required:** `organization_id`, `profile_id`, `primary_role` (FK→roles veya enum), `status`
  (active|pending|deactivated), `joined_at`.
- **optional:** `invited_by`, `deactivated_at`.
  > **Phase 3A kararı:** memberships **`primary_team_id` TAŞIMAZ**. Primary team'in tek source of
  > truth'u **`team_memberships.is_primary`**'dir (drift/duplicate-source önlemek için). Gelecekte
  > `memberships.primary_team_id` **eklenmemelidir**. Bkz. [[meritflow-primary-team-canonical]] / ADR-019 not.
- **FK:** `organization_id`, `profile_id`, `primary_role`.
- **unique:** (`organization_id`, `profile_id`) — org başına tek aktif membership (tek primary_role, AD2).
- **check:** `status ∈ {...}`. **indexes:** (`organization_id`,`profile_id`) unique; `primary_role`.
- **audit:** **evet** (role/permission change, deactivation). **RLS:** kendi + `user.invite`/HR görür.
- **retention:** kalıcı (audit izi). **OQ:** çoklu aktif membership V1 (multi-role/multi-team).

### roles
- **purpose:** RBAC rol kataloğu (Owner, Admin, HR, Finance, Manager, Employee, Auditor — D4).
- **owner:** rbac. **status:** MVP. **sensitivity:** internal.
- **required:** `key` (owner|admin|hr|finance|manager|employee|auditor), `label`.
- **optional:** `description`, `is_system` (true MVP rolleri). **FK:** —.
- **unique:** `key` (org-scoped veya global system roles). **check:** —. **indexes:** `key`.
- **audit:** rol tanımı değişimi (V1 custom roles). **RLS:** org read; system roles ortak.
- **retention:** kalıcı. **OQ:** custom org-defined roles V1; Department Manager/Team Lead V1 (D4).

### permissions
- **purpose:** izin anahtarı kataloğu (`task.review`, `payout.export`, `comp.read`, `support.grant`, ...).
- **owner:** rbac. **status:** MVP. **sensitivity:** internal.
- **required:** `key`, `label`, `domain`. **optional:** `description`, `is_sensitive` (comp.read=true).
- **FK:** —. **unique:** `key`. **check:** —. **indexes:** `key`.
- **audit:** katalog değişimi (V1). **RLS:** read. **retention:** kalıcı.
- **OQ:** attribute-based (ABAC) izinler V1+.

### role_permissions
- **purpose:** rol → izin eşlemesi (server-side authorization kaynağı; `has_permission` buradan okur — AD1).
- **owner:** rbac. **status:** MVP. **sensitivity:** confidential.
- **required:** `role_key` (FK→roles), `permission_key` (FK→permissions).
- **optional:** `constraint jsonb` (örn. "own team", "2-step"). **FK:** `role_key`, `permission_key`.
- **unique:** (`role_key`,`permission_key`). **check:** —. **indexes:** (`role_key`,`permission_key`).
- **audit:** **evet** (permission change). **RLS:** read (authz helper); write Owner/Admin.
- **retention:** kalıcı. **OQ:** org-override eşlemeleri V1.

---

## Org yapısı

### teams
- **purpose:** takım birimi.
- **owner:** teams. **status:** MVP. **sensitivity:** internal.
- **required:** `organization_id`, `name`, `status`. **optional:** `manager_id` (FK→profiles), `parent_team_id` (V1 hiyerarşi), `team_factor` (varsayılan policy'den).
- **FK:** `organization_id`, `manager_id`, `parent_team_id`. **unique:** (`organization_id`,`name`).
- **check:** —. **indexes:** `organization_id`; `manager_id`. **audit:** team manage. **RLS:** org görür; yönetim `team.manage`.
- **retention:** kalıcı. **OQ:** departman hiyerarşisi (Department Manager) V1.

### team_memberships
- **purpose:** employee ↔ team ilişkisi.
- **owner:** teams. **status:** MVP. **sensitivity:** internal.
- **required:** `organization_id`, `team_id`, `profile_id`, `role_in_team` (member|lead-V1).
- **optional:** `is_primary` (primary_team işareti, AD9), `joined_at`.
  > **Canonical:** `is_primary` primary team için **tek source of truth**'tur (memberships'te ayrı kolon
  > yoktur). Sonraki fazlarda team_factor/değerlendirme bu kaynaktan çözülür; bonus tablolarındaki
  > `primary_team_id` alanları bundan **türetilmiş snapshot** değerleridir, ayrı kaynak değildir.
- **FK:** `organization_id`, `team_id`, `profile_id`. **unique:** (`team_id`,`profile_id`).
- **check:** (`organization_id`,`profile_id`) başına en fazla bir `is_primary=true` (partial unique index;
  period değerlendirmesi primary_team — AD9).
- **indexes:** (`team_id`,`profile_id`); partial unique (`organization_id`,`profile_id`) where is_primary. **audit:** team manage. **RLS:** kendi + manager (kendi takım) + HR.
- **retention:** kalıcı. **OQ:** multi-team weighted V1 (AD9).

### projects  *(MVP-minimal)*
- **purpose:** görev gruplama (opsiyonel). **owner:** tasks. **status:** MVP-minimal (UI gizli, OQ-DM-2).
- **sensitivity:** internal. **required:** `organization_id`, `name`, `status`. **optional:** `team_id`, `description`.
- **FK:** `organization_id`, `team_id`. **unique:** (`organization_id`,`name`). **indexes:** `organization_id`.
- **audit:** hayır. **RLS:** org/team görür. **retention:** kalıcı. **OQ:** UI görünürlüğü V1.

### objectives  *(MVP-minimal)*
- **purpose:** etiketleme/gruplama (minimal OKR). **owner:** tasks. **status:** MVP-minimal.
- **sensitivity:** internal. **required:** `organization_id`, `title`, `status`. **optional:** `team_id`, `period`.
- **FK:** `organization_id`, `team_id`. **unique:** —. **indexes:** `organization_id`. **audit:** hayır.
- **RLS:** org görür. **retention:** kalıcı. **OQ:** OKR derinliği V1+.

---

## İş / Görev

### tasks
- **purpose:** performans girdisi (basit todo değil).
- **owner:** tasks. **status:** MVP. **sensitivity:** internal (puan kaynağı; confidential alanlar review'da).
- **required:** `organization_id`, `team_id`, `title`, `status` (state machine, `16`), `created_by`,
  `assigned_to`, `complexity`, `impact`, `base_points`, `scoring_policy_version_id`, `created_at`.
- **optional:** `project_id`, `objective_id`, `description`, `task_type`, `priority`, `urgency`,
  `estimated_effort`, `due_date`, `reviewer_id`, `acceptance_criteria`, `evidence_required`,
  `submitted_at`, `approved_at`, `rejected_at`, `completed_at`, `revision_count`,
  `last_valid_submitted_at` (AD4), `final_points` (**türev cache**, source = ledger), `anomaly_status`,
  `reviewer_note`, `employee_note`.
- **FK:** `organization_id`, `team_id`, `project_id`, `objective_id`, `assigned_to`, `created_by`,
  `reviewer_id`, `scoring_policy_version_id`. **unique:** —.
- **check:** `status ∈ {...}`; `complexity/impact ∈ {...}`; `base_points ≥ 0`; `reviewer_id <> assigned_to`
  (self-approval guard, ayrıca review katmanında); `final_points` yalnız `approved`'da set.
- **indexes:** (`organization_id`,`status`,`assigned_to`); (`organization_id`,`reviewer_id`,`status`)
  review queue; `team_id`; `due_date`. **audit:** approval/rejection, override (point_ledger/audit'te).
- **RLS:** assignee/creator/reviewer/manages_team/HR/Admin/Owner/Auditor görür (`15`). **retention:** kalıcı (arşiv).
- **OQ:** `final_points` cache tutarlılık trigger'ı Phase 3 detayı.

### task_assignments
- **purpose:** atama geçmişi (yeniden atama izlenir). **owner:** tasks. **status:** MVP. **sensitivity:** internal.
- **required:** `organization_id`, `task_id`, `assignee_id`, `assigned_by`, `assigned_at`.
- **optional:** `unassigned_at`, `reason`. **FK:** `organization_id`,`task_id`,`assignee_id`,`assigned_by`.
- **unique:** aktif atama için (`task_id` where `unassigned_at is null`) tekil. **indexes:** `task_id`; `assignee_id`.
- **audit:** atama değişimi (opsiyonel audit). **RLS:** task görüntüleyenler. **retention:** kalıcı.

### task_comments
- **purpose:** görev tartışması. **owner:** tasks. **status:** MVP. **sensitivity:** personal-data (serbest metin).
- **required:** `organization_id`, `task_id`, `author_id`, `body`, `created_at`.
- **optional:** `parent_comment_id`. **FK:** `organization_id`,`task_id`,`author_id`. **unique:** —.
- **indexes:** `task_id`. **audit:** hayır. **RLS:** task görüntüleyenler. **retention:** task ile; **silme = soft** (iz).
- **OQ:** comment edit/delete soft-delete politikası Phase 4.

### task_attachments
- **purpose:** evidence/dosya referansı. **owner:** tasks. **status:** MVP. **sensitivity:** personal-data/confidential.
- **required:** `organization_id`, `task_id`, `uploaded_by`, `storage_path`, `created_at`.
- **optional:** `file_name`, `mime_type`, `size_bytes`. **FK:** `organization_id`,`task_id`,`uploaded_by`.
- **unique:** —. **indexes:** `task_id`. **audit:** hayır. **RLS:** task görüntüleyenler.
- **retention:** task ile; storage RLS Supabase Storage policy ile hizalı. **OQ:** dosya tarama/AV V1.

### task_events
- **purpose:** durum geçişi + submission/revision history (append-only; AD4 history kaynağı).
- **owner:** tasks. **status:** MVP. **sensitivity:** audit-critical.
- **required:** `organization_id`, `task_id`, `event_type` (status_change|submitted|revision_requested|...),
  `actor_id`, `from_status`, `to_status`, `created_at`.
- **optional:** `submitted_at_snapshot`, `metadata jsonb`. **FK:** `organization_id`,`task_id`,`actor_id`.
- **unique:** —. **check:** append-only (UPDATE/DELETE policy yok). **indexes:** (`task_id`,`created_at`).
- **audit:** kendisi iz; kritik geçiş ayrıca `audit_logs`. **RLS:** task görüntüleyenler + Auditor.
- **retention:** kalıcı (history). **OQ:** —.

### task_reviews
- **purpose:** reviewer kararı + quality/timeliness/collaboration skorları (collaboration puanı etkilemez — AD5).
- **owner:** reviews. **status:** MVP. **sensitivity:** confidential.
- **required:** `organization_id`, `task_id`, `reviewer_id`, `decision` (approve|needs_revision|reject),
  `quality` (acceptable|good|excellent — **poor approve edilemez**, D3), `timeliness`, `created_at`.
- **optional:** `collaboration_score` (kayıt/analitik; puanı etkilemez — AD5), `reviewer_note`,
  `timeliness_override_reason`. **FK:** `organization_id`,`task_id`,`reviewer_id`.
- **unique:** karar başına satır (revision döngüsünde çok satır olabilir). **check:** `reviewer_id <> task.assignee`
  (self-approval block); `decision=approve ⇒ quality <> poor` (D3).
- **indexes:** `task_id`; `reviewer_id`. **audit:** **evet** (approval/rejection). **RLS:** task görüntüleyenler.
- **retention:** kalıcı. **OQ:** —.

---

## Scoring

### scoring_policies
- **purpose:** mantıksal scoring politikası (1—* version). **owner:** scoring. **status:** MVP. **sensitivity:** confidential.
- **required:** `organization_id`, `name`, `status` (draft|active|archived), `created_by`.
- **optional:** `description`. **FK:** `organization_id`,`created_by`. **unique:** (`organization_id`,`name`).
- **indexes:** `organization_id`. **audit:** **evet** (scoring policy change). **RLS:** HR/Admin write; org read.
- **retention:** kalıcı. **OQ:** —.

### scoring_policy_versions
- **purpose:** immutable policy snapshot (çarpan tabloları, timeliness eşikleri; dönemde kilitli — AD7).
- **owner:** scoring. **status:** MVP. **sensitivity:** confidential, audit-critical.
- **required:** `organization_id`, `scoring_policy_id`, `version_no`, `status` (draft|published),
  `multipliers jsonb` (complexity/impact/quality/timeliness), `revision_penalty_rule jsonb`,
  `timeliness_thresholds jsonb`, `published_at`, `published_by`.
- **optional:** `notes`. **FK:** `organization_id`,`scoring_policy_id`,`published_by`.
- **unique:** (`scoring_policy_id`,`version_no`). **check:** published version **immutable** (UPDATE yasak);
  draft ile görev approve edilemez. **indexes:** (`scoring_policy_id`,`version_no`).
- **audit:** **evet** (yeni version publish). **RLS:** org read; HR/Admin publish. **retention:** kalıcı (immutable).
- **OQ:** OQ-SC-2/3 (eşikler org-configurable mı) — V1.

### point_ledger  *(append-only, single-entry — ADR-005)*
- **purpose:** puan defteri; çalışan toplamı satırlardan türetilir (mutable total yok).
- **owner:** point-ledger. **status:** MVP. **sensitivity:** audit-critical, financial-critical (puan→prim).
- **required:** `organization_id`, `employee_id`, `event_type` (task_approved|manual_adjustment|
  dispute_adjustment|reversal|anomaly_hold|anomaly_released|period_locked|...), `points_delta numeric`,
  `reason`, `created_by`, `created_at`.
- **optional:** `task_id`, `bonus_period_id`, `scoring_policy_version_id`, `metadata jsonb` (breakdown:
  base + her çarpan + baz submission zamanı — AD4). **FK:** `organization_id`,`employee_id`,`task_id`,
  `bonus_period_id`,`scoring_policy_version_id`,`created_by`.
- **unique:** `task_approved` için (`task_id`,`event_type`) tekil (idempotent approve — INV-1).
- **check:** **UPDATE/DELETE policy yok** (append-only — INV-2); düzeltme = reversal/adjustment.
- **indexes:** (`organization_id`,`employee_id`,`bonus_period_id`); (`employee_id`,`created_at`); `task_id`.
- **audit:** manual_adjustment/dispute_adjustment/reversal → **evet**. **RLS:** kendi + manager(team) + HR + Auditor.
- **retention:** **kalıcı, silinmez** (ledger). **OQ:** OQ-LA-2 partition (V1).

---

## Bonus / Para

### bonus_periods
- **purpose:** dönem yaşam döngüsü (monthly MVP — D11). **owner:** bonus-periods. **status:** MVP. **sensitivity:** financial-critical.
- **required:** `organization_id`, `period_type` (monthly), `starts_on`, `ends_on`, `status`
  (open|locked|calculated|approved|exported|closed — `16`), `created_by`.
- **optional:** `locked_at`, `locked_by`, `closed_at`. **FK:** `organization_id`,`created_by`,`locked_by`.
- **unique:** (`organization_id`,`starts_on`,`ends_on`) çakışmasız. **check:** `ends_on > starts_on`;
  geçiş yalnız tanımlı state machine. **indexes:** (`organization_id`,`status`); `ends_on`.
- **audit:** **evet** (period lock/unlock). **RLS:** HR/Owner manage; org read (kendi katılım). **retention:** kalıcı.
- **OQ:** weekly/quarterly/custom V1 (D11).

### bonus_pools
- **purpose:** dönem prim havuzu (calculation öncesi kilitli — AD10). **owner:** bonus-pools. **status:** MVP. **sensitivity:** financial-critical.
- **required:** `organization_id`, `bonus_period_id`, `amount_minor bigint`, `currency`, `status`
  (draft|locked|...), `created_by`.
- **optional:** `t_org` (Zero Factor; 0|0.5|0.75|1|1.2 — locked, snapshot'a yazılır), `top_up_approved` (bool/amount, AD8),
  `locked_at`, `locked_by`, `version_no` (lock sonrası değişiklik = new version — AD10).
- **FK:** `organization_id`,`bonus_period_id`,`created_by`,`locked_by`. **unique:** (`bonus_period_id`, aktif pool) tekil.
- **check:** `amount_minor ≥ 0`; `t_org ∈ {0,0.5,0.75,1,1.2}`; locked sonrası `amount_minor` normal UPDATE **yasak** (new version — AD10).
- **indexes:** `bonus_period_id`. **audit:** **evet** (pool creation/approval/lock; T_org/top-up değişimi).
- **RLS:** Finance create; HR/Finance/Auditor read; Employee göremez. **retention:** kalıcı. **OQ:** —.

### bonus_pool_components  *(MVP iskelet; aktif kullanım V1)*
- **purpose:** havuz bileşen ağırlıkları (Hybrid model — D1). MVP'de yalnız `individual` (weight=1.0).
- **owner:** bonus-pools. **status:** MVP-iskelet / V1-aktif. **sensitivity:** financial-critical.
- **required:** `organization_id`, `bonus_pool_id`, `component` (individual|team|quality|winner), `weight`.
- **optional:** —. **FK:** `organization_id`,`bonus_pool_id`. **unique:** (`bonus_pool_id`,`component`).
- **check:** Σweight = 1.0; **MVP'de yalnız `individual`=1.0** (D1). **indexes:** `bonus_pool_id`.
- **audit:** policy change. **RLS:** Finance/HR/Auditor. **retention:** kalıcı. **OQ:** Hybrid bileşenleri V1 (ADR-002).

### bonus_pool_eligibility
- **purpose:** dönem eligibility kaydı (15 gün + active membership — D10).
- **owner:** bonus-pools. **status:** MVP. **sensitivity:** confidential, financial-critical.
- **required:** `organization_id`, `bonus_pool_id`, `employee_id`, `eligible` (bool),
  `days_active`, `eligibility_factor` (0|1).
- **optional:** `proration_factor` (cap üzerinde — D10; snapshot'a yazılır), `primary_team_id` (AD9 — **`team_memberships.is_primary`'den türetilmiş** snapshot, ayrı kaynak değil), `reason`.
- **FK:** `organization_id`,`bonus_pool_id`,`employee_id`,`primary_team_id`. **unique:** (`bonus_pool_id`,`employee_id`).
- **check:** `eligible = (days_active ≥ 15 AND active_membership)`; `eligibility_factor ∈ {0,1}`.
- **indexes:** (`bonus_pool_id`,`employee_id`). **audit:** hesaplama girdisi (calculation run audit). **RLS:** HR/Finance/Auditor; employee yalnız kendi.
- **retention:** kalıcı. **OQ:** tenure/leave/part-time gelişmiş kuralları V1 (D10).

### bonus_calculation_runs
- **purpose:** hesaplama çalıştırması (idempotency key ile; aynı run yeni snapshot üretmez).
- **owner:** bonus-calculation. **status:** MVP. **sensitivity:** financial-critical, audit-critical.
- **required:** `organization_id`, `bonus_period_id`, `bonus_pool_id`, `status`
  (running|completed|superseded — `16`), `idempotency_key`, `triggered_by`, `created_at`.
- **optional:** `policy_version_id`, `t_org`, `top_up_applied`, `notes`, `superseded_by`.
- **FK:** `organization_id`,`bonus_period_id`,`bonus_pool_id`,`triggered_by`. **unique:** `idempotency_key`.
- **check:** yalnız `locked` period'da başlar (AD10). **indexes:** (`bonus_period_id`,`status`).
- **audit:** **evet** (calculation run). **RLS:** HR/Finance/Auditor read; trusted/HR trigger. **retention:** kalıcı.
- **OQ:** —.

### bonus_allocations
- **purpose:** çalışan başına hesaplanan tutar (status `pending_missing_cap_basis` dahil — AD6).
- **owner:** bonus-calculation. **status:** MVP. **sensitivity:** financial-critical.
- **required:** `organization_id`, `calculation_run_id`, `bonus_period_id`, `employee_id`,
  `adjusted_score numeric`, `raw_share_minor bigint`, `final_amount_minor bigint`, `status`
  (draft|calculated|pending_missing_cap_basis|approved|exported|paid — `16`).
- **optional:** `primary_team_id` (AD9 — **`team_memberships.is_primary`'den türetilmiş** snapshot), `cap_minor`, `cap_basis_minor`, `cap_applied`
  (yes|no|pending_missing_cap_basis), `rounding_adjustment_minor`, `factors jsonb` (role/quality/team/eligibility/proration).
- **FK:** `organization_id`,`calculation_run_id`,`bonus_period_id`,`employee_id`,`primary_team_id`.
- **unique:** (`calculation_run_id`,`employee_id`). **check:** `final_amount_minor ≤ cap_minor`
  (cap varsa); `pending_missing_cap_basis` ⇒ export yasak (AD6); Σfinal ≤ pool (run-level invariant INV-4).
- **indexes:** (`bonus_period_id`,`employee_id`); (`calculation_run_id`,`status`). **audit:** approval/export (ilgili event).
- **RLS:** employee yalnız kendi; HR org; Finance **view-only** (`v_finance_*`); Auditor read. **retention:** kalıcı.
- **OQ:** —.

### bonus_allocation_snapshots  *(immutable — ADR-006)*
- **purpose:** hesaplama sonucunun değiştirilemez kanıtı; tüm faktörleri kaydeder (AD7).
- **owner:** bonus-calculation. **status:** MVP. **sensitivity:** financial-critical, audit-critical.
- **required:** `organization_id`, `calculation_run_id`, `bonus_period_id`, `bonus_pool_id`,
  `policy_version_id`, `t_org`, `top_up_applied`, `allocations jsonb` (employee detayları: employee_id,
  primary_team_id, raw_points, adjusted_score, multipliers, role/team/eligibility/proration factors,
  cap_basis, cap_minor, cap_applied, raw_share_minor, final_amount_minor, rounding_adjustment_minor),
  `undistributed_remainder_minor`, `calculation_metadata jsonb`, `created_at`.
- **optional:** `approved_by`, `approved_at`. **FK:** `organization_id`,`calculation_run_id`,`bonus_period_id`,`bonus_pool_id`,`policy_version_id`.
- **unique:** `calculation_run_id` (run başına bir snapshot). **check:** **immutable** (UPDATE/DELETE yasak — INV-6);
  `Σfinal + undistributed_remainder = pool` (kuruş — INV-4). **indexes:** `bonus_period_id`; `calculation_run_id`.
- **audit:** **evet** (snapshot oluşturma/approval). **RLS:** HR/Finance/Auditor read; trusted write. **retention:** **kalıcı, silinmez**.
- **OQ:** —.

### bonus_ledger  *(double-entry, money — ADR-017)*
- **purpose:** para hareketi defteri; Σdebit=Σcredit; accrual yalnız approved snapshot'tan.
- **owner:** bonus-ledger. **status:** MVP. **sensitivity:** financial-critical, audit-critical.
- **required:** `organization_id`, `bonus_pool_id`, `entry_type` (debit|credit), `account`
  (pool|accrual|payout|clawback), `event_type` (bonus_accrual|bonus_approved|payout_exported|
  payout_marked_paid|clawback_pending|clawback_approved|reversal), `amount_minor bigint`, `currency`,
  `reason`, `created_by`, `created_at`.
- **optional:** `employee_id`, `calculation_run_id`, `snapshot_id`, `metadata jsonb`.
- **FK:** `organization_id`,`bonus_pool_id`,`employee_id`,`calculation_run_id`,`snapshot_id`,`created_by`.
- **unique:** accrual için (`snapshot_id`,`employee_id`,`account`) tekil (idempotent accrual).
- **check:** **UPDATE/DELETE yasak**; düzeltme = reversal; accrual ⇒ `snapshot_id NOT NULL`;
  payout ≤ accrual (BL-3); run bazında Σdebit=Σcredit. **indexes:** (`bonus_pool_id`,`account`); `employee_id`; `snapshot_id`.
- **audit:** **evet** (her money mutation — BL-4). **RLS:** Finance/Auditor; employee yalnız özet (view).
- **retention:** **kalıcı, silinmez**. **OQ:** OQ-LA-3 banka mutabakat raporu (V1).

### compensation_records  *(comp-sensitive — ADR-018)*
- **purpose:** cap basis kaynağı (maaş); en sıkı izole tablo.
- **owner:** compensation. **status:** MVP. **sensitivity:** **compensation-sensitive**, personal-data.
- **required:** `organization_id`, `employee_id`, `gross_salary_minor bigint`, `currency`,
  `effective_from`, `status` (active|superseded), `created_by`, `created_at`.
- **optional:** `effective_to`, `cap_basis_minor` (yoksa → `pending_missing_cap_basis` akışı — AD6), `notes`.
- **FK:** `organization_id`,`employee_id`,`created_by`. **unique:** (`employee_id`, aktif kayıt — `effective_to is null`).
- **check:** effective range çakışmasız; düzeltme = yeni kayıt + supersede (immutable tercih).
- **indexes:** (`organization_id`,`employee_id`,`effective_from`). **audit:** **evet** (comp access **ve** change — AD3; erişim de audit'li).
- **RLS:** yalnız `comp.read` (HR/Finance min); **employee/Manager göremez**; Auditor ham yalnız gerekçe+audit (AD3).
- **retention:** KVKK — saklama süresi legal-review item; **silme legal-review**. **OQ:** OQ-RLS-2 (audit mekanizması trigger vs server).

---

## Yönetişim

### disputes
- **purpose:** puan/prim itirazı (5 iş günü SLA, manager kendi kararına final değil — D9).
- **owner:** disputes. **status:** MVP. **sensitivity:** confidential, personal-data.
- **required:** `organization_id`, `complainant_id`, `dispute_type` (task_points_too_low|unfair_rejection|
  quality_score_dispute|missing_task_credit|bonus_calculation_dispute|manager_bias_report|
  anomaly_false_positive|system_error|clawback_dispute), `target_type`, `target_id`, `status`
  (open|under_review|needs_info|resolved|closed — `16`), `opened_at`.
- **optional:** `assigned_reviewer_id`, `due_at` (opened+5 iş günü), `resolution` (accepted|rejected),
  `decision_note`, `resolved_at`. **FK:** `organization_id`,`complainant_id`,`assigned_reviewer_id`.
- **unique:** —. **check:** `assigned_reviewer_id <> ihtilaf kararının sahibi` (D9; uygulama+kontrol).
- **indexes:** (`organization_id`,`status`,`assigned_reviewer_id`); `complainant_id`; `due_at`.
- **audit:** **evet** (dispute decision). **RLS:** complainant + assigned reviewer + HR + Auditor. **retention:** kalıcı.
- **OQ:** OQ-DP-1 "iş günü" tanımı (V1).

### dispute_events
- **purpose:** dispute durum/aksiyon geçmişi (append-only). **owner:** disputes. **status:** MVP. **sensitivity:** audit-critical.
- **required:** `organization_id`, `dispute_id`, `event_type`, `actor_id`, `from_status`, `to_status`, `created_at`.
- **optional:** `note`, `metadata jsonb`. **FK:** `organization_id`,`dispute_id`,`actor_id`. **unique:** —.
- **check:** append-only. **indexes:** (`dispute_id`,`created_at`). **audit:** kendisi iz. **RLS:** dispute görüntüleyenler + Auditor.
- **retention:** kalıcı. **OQ:** —.

### anti_gaming_flags
- **purpose:** 5 deterministik kural flag'i (otomatik ceza yok — D5). **owner:** anti-gaming. **status:** MVP. **sensitivity:** confidential.
- **required:** `organization_id`, `rule` (duplicate_task|tiny_task_splitting|same_reviewer_concentration|
  period_end_spike|self_approval_attempt), `subject_employee_id`, `status` (open|reviewing|confirmed|dismissed),
  `created_at`.
- **optional:** `related_task_id`, `related_reviewer_id`, `bonus_period_id`, `evidence jsonb`,
  `reviewed_by`, `review_note`. **FK:** `organization_id`,`subject_employee_id`,`related_task_id`,`related_reviewer_id`.
- **unique:** tekrar flag'i için (`rule`,`subject_employee_id`,`window`) (dedup, opsiyonel).
- **check:** confirmed flag **otomatik finansal etki üretmez** (insan kararı + ayrı ledger entry).
- **indexes:** (`organization_id`,`status`); `subject_employee_id`. **audit:** confirm/dismiss → **evet**.
- **RLS:** Manager (kendi takım) + HR + Auditor; subject employee kendi flag'ini görebilir (şeffaflık). **retention:** kalıcı.
- **OQ:** OQ-AG-1/2/3 eşik/kapsam (V1). `self_approval_attempt` = engelleme + iz (flag opsiyonel).

### notifications
- **purpose:** kullanıcı bildirimi. **owner:** notifications. **status:** MVP. **sensitivity:** personal-data.
- **required:** `organization_id`, `recipient_id`, `type`, `payload jsonb`, `status` (unread|read), `created_at`.
- **optional:** `read_at`, `link`. **FK:** `organization_id`,`recipient_id`. **unique:** —.
- **indexes:** (`recipient_id`,`status`). **audit:** hayır. **RLS:** yalnız recipient. **retention:** sınırlı (V1 TTL).
- **OQ:** retention süresi (V1).

### audit_logs  *(append-only — ADR-006)*
- **purpose:** yetkili aksiyonların değiştirilemez kaydı; comp maskeleme (AD3).
- **owner:** audit. **status:** MVP. **sensitivity:** audit-critical (+ comp payload compensation-sensitive).
- **required:** `organization_id`, `actor_id`, `action`, `target_type`, `target_id`, `created_at`.
- **optional:** `before jsonb`, `after jsonb` (comp ise **maskeli liste**, raw yetki+gerekçe ile — AD3),
  `reason`, `request_context jsonb` (ip/agent ops.), `is_sensitive` (comp erişimi). **FK:** `organization_id`,`actor_id`.
- **unique:** —. **check:** **UPDATE/DELETE yasak** (append-only). **indexes:** (`organization_id`,`action`,`created_at`); `target_id`.
- **audit:** kendisi audit; sensitive **raw** erişimi ayrıca audit üretir (AD3). **RLS:** `audit.read`
  (Owner/Admin/HR full; Finance financial subset; Auditor full RO); comp payload masked, raw yetki+gerekçe.
- **retention:** **kalıcı, silinmez**. **OQ:** OQ-RLS-2 (comp erişim audit mekanizması).

### exports
- **purpose:** payout export kaydı (snapshot olmadan üretilemez — AD6/INV-7). **owner:** exports. **status:** MVP. **sensitivity:** financial-critical.
- **required:** `organization_id`, `bonus_period_id`, `snapshot_id`, `exported_by`, `format`, `status`, `created_at`.
- **optional:** `file_path`, `row_count`, `checksum`. **FK:** `organization_id`,`bonus_period_id`,`snapshot_id`,`exported_by`.
- **unique:** —. **check:** `snapshot_id NOT NULL`; `pending_missing_cap_basis` varsa export **bloklanır** (AD6).
- **indexes:** (`organization_id`,`created_at`); `bonus_period_id`. **audit:** **evet** (export generation).
- **RLS:** Finance create/read; Auditor read; employee göremez. **retention:** kalıcı (finansal iz). **OQ:** —.

### support_access_grants
- **purpose:** süreli/sınırlı support erişimi (D4). **owner:** governance. **status:** MVP. **sensitivity:** audit-critical, confidential.
- **required:** `organization_id`, `grantee_id` (support actor), `scope`, `granted_by` (Owner),
  `expires_at`, `status` (active|expired|revoked), `created_at`.
- **optional:** `revoked_at`, `reason`. **FK:** `organization_id`,`grantee_id`,`granted_by`. **unique:** —.
- **check:** `expires_at > created_at`; süre dolunca `active` değil (uygulama+kontrol). **indexes:** (`organization_id`,`status`,`expires_at`).
- **audit:** **evet** (support access grant **ve** her support erişimi). **RLS:** Owner + Auditor.
- **retention:** kalıcı (iz). **OQ:** —.

---

## V1/V2 ertelenen tablolar (işaretli)

| Tablo | Status | Amaç (kısa) | Not |
| --- | --- | --- | --- |
| `anomaly_baselines` | V1 | role/team/task-type Z-score baseline | D5 ertelenen anomaly; MVP'de yok |
| `integrations` | V1+ | dış sistem/payroll adapter | secret audit'li (ADR-014) |
| `webhook_events` | V1+ | event dışa yayını | — |
| Hybrid `bonus_pool_components` aktif bileşenleri | V1 | team/quality/winner havuzları | MVP'de yalnız individual=1.0 (ADR-002) |
| multi-role / role-merge yapıları | V1 | AD2 | explicit deny > allow |
| multi-team weighted yapılar | V1 | AD9 | primary_team MVP |
| Redis read-model projeksiyonları | V1 | leaderboard/dashboard cache | finansal kaynak olamaz (ADR-009) |

## Genel index stratejisi (özet)

- Tenant filtreleri: her tabloda `organization_id` lider kolon.
- Task: (`organization_id`,`status`,`assigned_to`) + review queue (`organization_id`,`reviewer_id`,`status`).
- point_ledger: (`organization_id`,`employee_id`,`bonus_period_id`).
- bonus: (`bonus_period_id`,`employee_id`) allocation/eligibility; `snapshot_id` ledger.
- audit_logs: (`organization_id`,`action`,`created_at`). disputes: (`status`,`assigned_reviewer_id`).
- exports: (`organization_id`,`created_at`).

## Acceptance criteria

- Context `06_DATABASE_REQUIREMENTS` + master prompt §11 tüm zorunlu tablolar listede (MVP veya V1/V2 işaretli).
- Her MVP tablo için sensitivity sınıfı + RLS özeti + audit gereksinimi + retention notu var.
- Append-only defterler (point_ledger, bonus_ledger, audit_logs, *_events, snapshots) UPDATE/DELETE yasağı işaretli.
- compensation_records en sıkı sınıf + erişim audit'i (AD3) belirtilmiş.

## Test implications

- Append-only tablolarda UPDATE/DELETE reddi testi.
- point_ledger idempotent `task_approved` (tek satır) testi.
- bonus_ledger Σdebit=Σcredit + accrual snapshot_id zorunlu testi.
- compensation_records: employee SELECT reddi; comp erişim audit üretir (AD3).
- exports: snapshot/`pending_missing_cap_basis` bloğu testi (AD6).
- unique/check constraint negatif testleri (örn. iki aktif membership; reviewer=assignee).

## Open questions

- OQ-DD-1: `final_points` (tasks) türev cache tutarlılığı trigger ile mi server-only mı? (Phase 3.)
- OQ-DD-2: comment/attachment soft-delete politikası (Phase 4).
- OQ-RLS-2: comp erişim audit mekanizması trigger vs server-only (AD3 zorunlu; Phase 3).
- OQ-DD-3: notifications/exports retention süreleri (V1).
