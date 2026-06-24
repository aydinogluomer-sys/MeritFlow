# Database Requirements

## Genel İlkeler

- PostgreSQL ana source of truth olacaktır.
- Supabase kullanılıyorsa RLS zorunludur.
- Her tenant verisi `organization_id` ile izole edilmelidir.
- Client tarafına service role key asla sızdırılmamalıdır.
- Puan, prim ve audit kayıtları mutable toplam alanlara değil ledger/snapshot mantığına dayanmalıdır.
- Redis kullanılacaksa sadece read-model/cache/leaderboard için kullanılmalıdır; finansal source of truth olamaz.

## Zorunlu Tablolar

- organizations
- organization_settings
- profiles
- memberships
- roles
- permissions
- role_permissions
- teams
- team_memberships
- projects
- objectives
- tasks
- task_assignments
- task_comments
- task_attachments
- task_events
- task_reviews
- scoring_policies
- scoring_policy_versions
- point_ledger
- bonus_periods
- bonus_pools
- bonus_pool_components
- bonus_pool_eligibility
- bonus_calculation_runs
- bonus_allocations
- bonus_allocation_snapshots
- bonus_ledger
- disputes
- dispute_events
- anti_gaming_flags
- anomaly_baselines
- notifications
- audit_logs
- exports
- integrations
- webhook_events
- support_access_grants

## Multi-Tenant Requirements

- Her tenant `organizations` tablosunda temsil edilir.
- Kullanıcı ile organizasyon ilişkisi `memberships` tablosunda tutulur.
- Kullanıcı farklı organizasyonlarda farklı role sahip olabilir.
- RLS policy’leri membership üzerinden çalışmalıdır.
- Cross-organization data leakage testleri zorunlu olmalıdır.

## Ledger Requirements

### Point Ledger

- Append-only mantığa yakın olmalıdır.
- Eski kayıt silinmemelidir.
- Düzeltme gerekiyorsa reversal veya adjustment entry oluşturulmalıdır.
- Her entry `organization_id`, `employee_id`, `task_id`, `bonus_period_id`, `event_type`, `points_delta`, `reason`, `created_by`, `created_at`, `metadata` içermelidir.

### Bonus Ledger

- Para/hak ediş olaylarını point ledger’dan ayrı tutmalıdır.
- Bonus calculation snapshot ile bağlantılı olmalıdır.
- Payout/export olayları auditlenmelidir.
- Clawback/malus gibi işlemler doğrudan ceza değil, approval workflow ile ele alınmalıdır.

## Snapshot Requirements

Bonus calculation sonuçları immutable snapshot olarak saklanmalıdır.

Snapshot şunları içermelidir:

- calculation_run_id
- bonus_period_id
- bonus_pool_id
- policy_version_id
- employee allocation details
- raw points
- adjusted score
- multipliers
- cap applied
- zero factor applied
- final amount
- rounding adjustment
- calculation metadata
- created_at
- approved_by
- approved_at

## Index Requirements

Claude aşağıdaki index stratejilerini önermelidir:

- `organization_id` bazlı tenant filtreleri
- task status + assignee indexleri
- review queue indexleri
- bonus_period_id + employee_id indexleri
- point_ledger employee/period indexleri
- audit_logs organization/action/created_at indexleri
- disputes status/assignee indexleri
- exports organization/created_at indexleri

## RLS Requirements

En az şu RLS policy mantıkları tasarlanmalıdır:

- Employee kendi görevlerini ve kendi prim/puan verisini görebilir.
- Employee başkasının bonus detayını göremez.
- Manager kendi takımındaki görevleri ve review queue’yu görebilir.
- HR organization seviyesinde çalışan performans/dispute verisini görebilir.
- Finance sadece bonus/payout/export için gerekli veriyi görebilir.
- Auditor read-only audit/snapshot görebilir.
- Super admin support access grant olmadan tenant verisine erişemez.

## Sensitive Data Classification

Claude her tablo için veri hassasiyetini sınıflandırmalıdır:

- public/internal
- confidential
- compensation-sensitive
- personal data
- audit-critical
- financial-critical

## Migration Requirements

- Migration dosyaları geriye dönük izlenebilir olmalıdır.
- Critical table migration’ları rollback planı içermelidir.
- RLS policy migration’ları test edilmelidir.
- Seed data test tenant’ları üretmelidir.
- Production migration için dry-run checklist hazırlanmalıdır.

---
