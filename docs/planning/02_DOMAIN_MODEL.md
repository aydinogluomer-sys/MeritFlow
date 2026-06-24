# 02 — Domain Model

## Purpose

MeritFlow MVP'sinin domain entity'lerini, ilişkilerini, durum makinelerini ve değişmezlerini
(invariants) tanımlamak. Bu doküman schema (`03`/`06`) ve engine spec'lerinin (`04`/`05`) ortak
sözlüğüdür. DDL içermez.

## Scope

- Kapsam: MVP entity'leri ve ilişkileri (Decision Lock D + AD ile uyumlu).
- Kapsam dışı: integrations/webhooks (V1+), objectives/OKR derinliği (MVP minimal), Department/Team Lead rolleri, multi-role, multi-team.

## Assumptions

- `Assumption:` `objectives` MVP'de yalnız etiketleme/gruplama için minimal tutulur.
- `Assumption:` `projects` opsiyoneldir; görev doğrudan team'e bağlanabilir.

## Non-negotiable rules

- Her entity `organization_id` taşır (tenant izolasyonu).
- Puan ve para mutable toplam alanlarda değil ledger/snapshot'ta yaşar.
- Durum geçişleri yalnız tanımlı state machine üzerinden olur.
- Her membership tek `primary_role` (AD2); her employee her period tek `primary_team` (AD9).

## Detailed specification

### Çekirdek entity grupları

**Identity & Tenant**
- `organizations` — tenant kök.
- `organization_settings` — bonus policy defaults, cap_default, locale.
- `profiles` — kullanıcı profili (auth kimliğine bağlı).
- `memberships` — (organization, profile, `primary_role`) üçlüsü; RLS anchor. Roller/izinler DB'den okunur (AD1).
- `roles`, `permissions`, `role_permissions` — RBAC tanımları (server-side authorization kaynağı).

**Org yapısı**
- `teams`, `team_memberships` (employee'nin period değerlendirmesi `primary_team` üzerinden — AD9).
- `projects` (opsiyonel), `objectives` (minimal).

**İş / Görev**
- `tasks` — performans girdisi.
- `task_assignments`, `task_comments`, `task_attachments`.
- `task_events` — durum geçişi olayları (submission/revision history dahil — AD4).
- `task_reviews` — reviewer kararı + quality/timeliness/collaboration skorları (collaboration puanı etkilemez — AD5).

**Scoring**
- `scoring_policies`, `scoring_policy_versions` (immutable, dönemde kilitli — AD7).
- `point_ledger` — append-only puan defteri.

**Bonus / Para**
- `bonus_periods`, `bonus_pools` (period close öncesi kilitli — AD10), `bonus_pool_components`, `bonus_pool_eligibility`.
- `bonus_calculation_runs`, `bonus_allocations` (status: ... | `pending_missing_cap_basis` — AD6), `bonus_allocation_snapshots` (immutable; faktörleri kaydeder — AD7).
- `bonus_ledger` — double-entry money defteri.
- `compensation_records` — comp-sensitive (cap kaynağı).

**Yönetişim**
- `disputes`, `dispute_events`.
- `anti_gaming_flags`, `anomaly_baselines` (V1 kullanımı).
- `audit_logs` (comp erişimi masked summary; raw payload yetki+gerekçe ile — AD3), `exports`, `support_access_grants`, `notifications`.
- `integrations`, `webhook_events` (V1+).

### Ana ilişkiler (kavramsal)
- Organization 1—* Membership *—1 Profile (org-başına tek primary_role).
- Organization 1—* Team 1—* TeamMembership.
- Task *—1 Team, *—1 assignee(Profile), *—1 reviewer(Profile), *—1 scoring_policy_version.
- Task approve → PointLedger entry (append-only).
- BonusPeriod 1—* BonusPool 1—* (Component, Eligibility).
- BonusPeriod lock → BonusCalculationRun 1—* BonusAllocation + 1 BonusAllocationSnapshot.
- Allocation approve/payout → BonusLedger entries (double-entry).
- Dispute → (karar) PointLedger adjustment veya yeni CalculationRun.
- Profile *—1 CompensationRecord (effective range ile).

### State machines

**Task status**
```txt
draft -> assigned -> in_progress -> submitted
submitted -> needs_revision -> in_progress
submitted -> approved        (yalnız quality >= acceptable; Decision Lock D3)
submitted -> rejected
assigned/in_progress -> cancelled
approved/rejected/cancelled -> archived
```
Kurallar:
- Employee yalnız `submit` tetikler.
- `approved` puanı kesinleştirir (ledger entry).
- Self-approval blocked (reviewer != assignee).
- `quality = poor` ise `approved` seçilemez.
- Timeliness `submitted_at`'e göre; geç onay cezalandırmaz (AD4).

**Bonus period status**
```txt
open -> locked -> calculated -> approved -> exported -> closed
locked -> open  (yalnız HR + audit; pending iş/dispute varsa geri açma)
```
Pool, `locked` öncesinde kilitlenmiş olmalı (AD10).

**Allocation status**
```txt
draft -> calculated -> (pending_missing_cap_basis) -> approved -> exported -> paid
```
`pending_missing_cap_basis` çözülmeden export yok (AD6).

**Dispute status**
```txt
open -> under_review -> (needs_info -> under_review) -> resolved(accepted|rejected) -> closed
```

**Allocation/snapshot**
- Snapshot bir kez oluşur, immutable. Değişiklik = yeni calculation run + yeni snapshot.

### Invariants
- INV-1: Bir task'ın final puanı yalnız `approved`'da ve yalnız bir kez kesinleşir (idempotent).
- INV-2: PointLedger satırı update/delete edilemez; düzeltme yeni entry'dir.
- INV-3: Bir bonus period için onaylı snapshot varken o döneme ait point ledger mutate edilemez
  (yalnız dispute → yeni run).
- INV-4: Σ(bonus allocations) ≤ bonus pool amount (cap residual `undistributed_remainder`).
- INV-5: Her sensitive mutation bir audit_log satırı üretir.
- INV-6: Calculation snapshot, kullanılan tüm faktörleri (role/team/eligibility/proration/cap basis/T_org) kaydeder (AD7).

## Edge cases

- Aynı kullanıcı iki org'da: membership ayrı (her biri tek primary_role), RLS her sorguda org bağlamını uygular.
- Reviewer takımdan ayrılırsa: açık review'lar yeniden atanmalı (Open Question).
- Task archived sonrası dispute: dispute yine açılabilir (kayıt korunur).
- Employee birden çok takımda: period değerlendirmesi `primary_team` üzerinden (AD9).

## Acceptance criteria

- Tüm context tabloları (`06_DATABASE_REQUIREMENTS`) domain modelde bir gruba yerleşmiş.
- Tüm state machine'ler Decision Lock (D + AD) ile uyumlu.
- Invariants ledger/snapshot spec'leriyle (`06`) çelişmiyor.

## Test implications

- State machine geçişleri için pozitif/negatif geçiş testleri.
- INV-1..INV-6 her biri en az bir business-logic testine bağlanır.
- Allocation `pending_missing_cap_basis` geçişi ve export bloğu testi (AD6).

## Open questions

- OQ-DM-1: Reviewer ayrıldığında açık review'ların yeniden atanma kuralı? (Öneri: Manager/HR reassign.)
- OQ-DM-2: `projects` MVP'de UI'da görünür mü yoksa yalnız veri modeli mi? (Öneri: minimal/gizli.)
