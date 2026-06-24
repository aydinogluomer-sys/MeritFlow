# MASTER PROMPT v2 — Oyunlaştırılmış İş Planı, Puanlama ve Dinamik Prim Yönetim Sistemi

Sen bu projede kıdemli bir ürün, mimari, güvenlik, HR-tech ve incentive compensation uzmanı gibi çalışacaksın.

Rollerin:

- Principal Product Manager
- Principal Software Architect
- HR-Tech Domain Expert
- Incentive Compensation Management Architect
- Gamification & Behavioral Design Specialist
- Financial Ledger / Audit Systems Architect
- Security & Privacy Engineer
- Anti-Fraud / Anti-Gaming Systems Designer
- Database & RLS Architect
- UI/UX Dashboard Lead
- QA / E2E Test Strategy Lead
- Claude Code Agent Orchestrator
- Source Verification & Research Agent

## 0. Bağlam

Ben çalışanların iş planlarını ve görevlerini takip ettiği, görev tamamladıkça puan kazandığı, bu puanların kalite/onay/zaman/önem/zorluk gibi faktörlere göre hesaplandığı ve belirli dönemlerde çalışanların puan oranlarına göre prim aldığı bir uygulama yapmak istiyorum.

Bu sistem sıradan bir todo app değildir.

Bu sistem:

- görev yönetimi,
- performans yönetimi,
- oyunlaştırma,
- prim/ödül yönetimi,
- audit log,
- çalışan kişisel verisi,
- ücret/prim etkisi,
- hile önleme,
- rol bazlı yetki,
- itiraz sistemi,
- finansal hesaplama,
- HR ve Finance onayı

içeren ciddi bir HR-tech / ICM ürünüdür.

Bu nedenle sistemi çalışanı baskılayan, gözetleyen, haksız rekabet yaratan veya hukuki risk üreten bir araç olarak değil; şeffaf, adil, denetlenebilir ve açıklanabilir bir performans/prim sistemi olarak tasarla.

## 1. Önce Context Analizi Yap

Sana verilen bu context pack'i ve varsa eklenen PDF'i önce analiz et.

Özellikle şu konuları çıkar:

- Rank-Order Tournament Theory
- discouragement effect
- sabotage / collusion / hile riskleri
- Octalysis framework
- white-hat / black-hat motivation balance
- Zero Factor
- malus / clawback
- proportional bonus formula
- max cap
- Redis Sorted Set leaderboard
- authoritative server model
- Z-score anomaly detection
- collusion detection
- microservice vs modular monolith trade-off
- AI agent/tool listesi
- GitHub reference repos
- stratejik öneriler

Sonra şu çıktıyı üret:

1. Doğrudan alınması gereken fikirler
2. Alınması ama değiştirilmesi gereken fikirler
3. MVP için fazla ağır olan fikirler
4. Hukuki/etik/finansal risk taşıyan fikirler
5. Eksik kalan ürün/mimari parçalar
6. Master prompt'a eklenecek net maddeler
7. Çelişen yaklaşımları uzlaştıran nihai ürün stratejisi

Kod yazma. Önce analiz ve planlama yap.

## 2. En Kritik Ürün İlkesi

Varsayılan model “en yüksek puan alan herkesin parasını alır” modeli olmayacak.

Saf winner-takes-all turnuva modeli risklidir.

Bunun yerine sistem 4 farklı prim modeli destekleyecek şekilde tasarlanmalı:

### Model A — Safe Pro-Rata Model

Varsayılan ve en güvenli model.

- Her eligible çalışan, onaylanmış normalize puan oranına göre prim havuzundan pay alır.
- Kalite barajı, cap, eligibility, dönem kilidi ve itiraz mekanizması zorunludur.

### Model B — Hybrid Team Reserve Model

Tavsiye edilen kurumsal model.

Örnek:

- Prim havuzunun %60’ı bireysel normalize puanlara göre
- %25’i takım/departman hedeflerine göre
- %10’u kalite ve müşteri memnuniyeti gibi kalite metriklerine göre
- %5’i özel başarı / liderlik / innovation bonus olarak

Bu oranlar organization settings içinde policy olarak yönetilir.

### Model C — Winner Bonus Overlay

Birinciye ekstra bonus verilir ama tüm havuzu almaz.

Örnek:

- Pro-rata dağıtım yapılır.
- Dönem birincisine ayrıca havuzun %5’i kadar başarı bonusu verilir.
- Bu bonus cap ve kalite barajına tabidir.

### Model D — Pure Tournament Mode

Riskli ve opsiyonel mod.

- Sadece şirket açıkça istiyorsa kullanılabilir.
- Varsayılan kapalıdır.
- HR/Finance/Legal uyarısı gösterilir.
- Takım rezervi, max cap, itiraz, kalite barajı ve anti-gaming zorunludur.
- Çalışanlara dönem başında açıklanmalıdır.
- Dönem ortasında keyfi değiştirilemez.

Her model için matematiksel formül, avantaj, risk, kullanım senaryosu, edge case ve hukuki/etik risk üret.

## 3. Davranışsal Tasarım ve Octalysis Entegrasyonu

Sistem yalnızca puan, XP ve leaderboard ile tasarlanmamalı.

Aşağıdaki denge kurulmalı:

### Black-Hat Motivation Riskleri

- kaybetme korkusu
- kıtlık baskısı
- sürekli rekabet
- leaderboard stresi
- prim kaybetme korkusu
- düşük sıradaki çalışanların kopması

### White-Hat Motivation Tasarım İlkeleri

- kişisel gelişim
- ustalık hissi
- görev tamamlama netliği
- takım katkısı
- kalite odaklı ilerleme
- şeffaflık
- adil itiraz hakkı
- çalışan kontrol hissi
- güvenli ve saygılı UX

Çıktıda Octalysis tablosu üret:

- Core Drive
- Sistemdeki karşılığı
- Potansiyel risk
- Tasarım koruması
- Hangi modülde uygulanacağı
- MVP/V1/V2 seviyesi

## 4. Turnuva Teorisi Risk Analizi

Rank-order tournament modelinin risklerini ayrı bölümde analiz et.

Şunları mutlaka ele al:

- discouragement effect
- sabotage
- collusion
- bilgi paylaşımının azalması
- düşük skor alanların motivasyon kaybı
- rol ve departman adaletsizliği
- cinsiyet/dezavantajlı grup etkisi
- çalışanlar arası psikolojik baskı
- kalite yerine nicelik odaklı çalışma
- görev parçalama
- manager bias
- self-approval
- peer-review reciprocity

Her risk için ürün koruması öner.

Örnek ürün korumaları:

- takım rezervi
- kalite multiplier
- role normalization
- cap
- peer review limit
- reviewer rotation
- dispute mechanism
- anonymous leaderboard
- personal progress view
- anti-gaming alerts
- audit log
- period lock
- HR review

## 5. Prim Hesaplama Motoru

Bana hem MVP hem enterprise düzeyde matematiksel model ver.

### 5.1. Temel Değişkenler

Tanımla:

- B = period bonus pool
- S_i = employee raw approved points
- A_i = adjusted points
- Q_i = role/time adjusted target quota
- T_org = organization performance factor
- T_team = team performance factor
- C_i = quality multiplier
- R_i = role normalization factor
- E_i = eligibility factor
- M_i = malus/clawback factor
- Cap_i = maximum payable bonus cap
- Floor_i = minimum bonus threshold
- W_individual = individual pool weight
- W_team = team pool weight
- W_quality = quality pool weight
- W_winner = winner overlay weight

### 5.2. Adjusted Score Formula

Örnek formül üret ama bunu geliştir:

```txt
A_i =
S_i
* C_i
* R_i
* T_team
* E_i
* M_i
```

A_i ayrıca şu kurallara tabi olsun:

- task type cap
- period cap
- role quota normalization
- part-time adjustment
- tenure adjustment
- quality threshold
- dispute adjustment
- anomaly pending hold

### 5.3. Safe Pro-Rata Bonus Formula

```txt
Bonus_i =
min(
  Cap_i,
  B * W_individual * A_i / ΣA_eligible
)
```

Eğer `ΣA_eligible = 0` ise ne olacağını açıkla.

### 5.4. Hybrid Team Reserve Formula

Bireysel, takım, kalite ve winner overlay havuzlarını ayrı ayrı hesapla.

```txt
FinalBonus_i =
IndividualBonus_i
+ TeamBonus_i
+ QualityBonus_i
+ WinnerOverlay_i
- Clawback_i
```

Ama bu formülü üretime uygun hale getir.

### 5.5. Zero Factor

Zero Factor keyfi uygulanamaz.

Tasarla:

- T_org = 0, 0.5, 0.75, 1, 1.2 gibi policy-defined değerler alabilir.
- Hangi koşulda hangi değer alınacağı dönem başında kilitlenir.
- T_org değişirse audit log oluşur.
- Dönem sonunda silent change yasaktır.
- Çalışan bonus breakdown’da görür.
- Legal/HR approval gerekebilir.

### 5.6. Malus / Clawback

Malus/clawback hassas modül olarak tasarlanmalı.

Kurallar:

- Her clawback hukuki/sözleşmesel koşula bağlıdır.
- Otomatik para kesintisi yapılmaz; sadece öneri/flag oluşturulur.
- HR/Finance/Legal onayı gerekir.
- Ledger’da reversal/adjustment entry oluşur.
- Çalışana açıklanabilir olmalıdır.
- İtiraz hakkı vardır.

## 6. Görev ve Puanlama Sistemi

Task modeli basit todo gibi değil, performans girdisi gibi tasarlanmalı.

Task alanları:

- id
- organization_id
- project_id
- objective_id
- team_id
- title
- description
- task_type
- priority
- complexity
- impact
- urgency
- estimated_effort
- due_date
- assigned_to
- created_by
- reviewer_id
- status
- acceptance_criteria
- evidence_required
- evidence_files
- submitted_at
- approved_at
- rejected_at
- completed_at
- revision_count
- base_points
- scoring_policy_version_id
- final_points
- quality_score
- timeliness_score
- collaboration_score
- reviewer_note
- employee_note
- anomaly_status
- audit_metadata

Status flow:

```txt
draft
-> assigned
-> in_progress
-> submitted
-> needs_revision
-> approved
-> rejected
-> cancelled
-> archived
```

Kurallar:

- Çalışan sadece submitted yapabilir.
- Puan approved sonrası kesinleşir.
- Employee kendi görevini approve edemez.
- Manager puanı doğrudan yazamaz; policy parametreleri üzerinden hesaplanır.
- Manual override varsa reason + audit log + permission gerekir.
- Dönem kapandıktan sonra normal mutation yapılamaz.
- Adjustment sadece dispute/reversal flow ile olur.

## 7. Point Ledger, Bonus Ledger ve Audit Log Ayrımı

Üç defteri birbirinden ayır:

### 7.1. Point Ledger

Puan olayları için append-only defter.

Event types:

- task_submitted
- task_approved
- task_rejected
- quality_multiplier_applied
- timeliness_bonus_applied
- revision_penalty_applied
- manual_adjustment
- dispute_adjustment
- reversal
- anomaly_hold
- anomaly_released
- period_locked

### 7.2. Bonus Ledger

Para / prim hak edişi ve ödeme olayları için defter.

Event types:

- bonus_accrual
- bonus_calculation_snapshot
- bonus_approved
- payout_exported
- payout_marked_paid
- clawback_pending
- clawback_approved
- reversal

Double-entry accounting mantığını değerlendir, ama point ledger ile money ledger’ı karıştırma.

### 7.3. Audit Log

Yetkili aksiyonların değiştirilemez kayıtları.

Audit log şu aksiyonlarda zorunlu:

- scoring policy change
- task point override
- task approval/rejection
- manual point adjustment
- bonus pool creation
- bonus pool approval
- bonus calculation run
- bonus period lock/unlock
- dispute decision
- export generation
- role/permission change
- user deactivation
- RLS/policy change
- support access
- integration token change

Silme değil reversal/append yaklaşımı kullan.

## 8. Anti-Gaming ve Fraud Detection Sistemi

Bu sistemi ayrı bir domain olarak tasarla.

### 8.1. MVP Anti-Gaming Rules

En az şu kurallar olsun:

- self approval blocked
- duplicate task detection
- tiny task splitting detection
- abnormal completion speed
- excessive manual adjustment
- same reviewer concentration
- repeated high scores from same manager
- revision abuse
- after-deadline manipulation
- period-end point spike
- employee-manager collusion signal
- peer-review reciprocity
- sudden score jump
- too many low-evidence completions
- task created and approved too quickly

### 8.2. Z-Score Anomaly Detection

Z-score formülünü kullan:

```txt
Z = (x - μ) / σ
```

Ama şu güvenlik kurallarını ekle:

- Küçük örneklemde Z-score tek başına karar veremez.
- Z-score sadece risk flag üretir.
- Z > 3 ise auto punishment değil, pending review.
- Employee’ye açıklanabilir olmalı.
- Manager/HR review queue oluşmalı.
- False positive senaryoları düşünülmeli.
- Role/team/task-type baseline ayrı tutulmalı.

### 8.3. Collusion Detection

MVP’de GNN kullanma.

Önce graph metrics kullan:

- reviewer-user edge frequency
- reciprocal approvals
- approval cluster density
- unusually high approval speed
- repeated pair pattern
- manager bias score
- peer-review ring detection

V2/V3’te ML/GNN opsiyonunu ayrıca değerlendir.

## 9. Leaderboard Tasarımı

Leaderboard primin source of truth’u değildir.

Source of truth:

- PostgreSQL point ledger
- bonus calculation snapshot
- locked policy version

Redis sadece read-model/cache olabilir.

Leaderboard türleri:

- personal progress
- team leaderboard
- role-normalized leaderboard
- department leaderboard
- quality leaderboard
- collaboration leaderboard
- period leaderboard
- percentile-only view
- anonymized leaderboard

Privacy rules:

- Global public leaderboard default OFF.
- Employee tüm şirketin tam sırasını göremeyebilir.
- Employee kendi sırasını, percentile’ını ve yakın komşu aralığı anonim görebilir.
- Manager kendi takımını görebilir.
- HR organization seviyesinde görebilir.
- Finance sadece ödeme ile ilgili sonuçları görebilir.
- “En kötü çalışan” gibi etiketler yasak.
- Çalışan rumuz/avatar kullanabilmeli.
- Leaderboard psikolojik baskı yaratmamalı.

## 10. Teknik Mimari

İki ayrı mimari öner:

### 10.1. MVP Architecture

Önerilen stack:

- Next.js App Router
- TypeScript
- Supabase Auth
- Supabase PostgreSQL
- Supabase RLS
- Server Actions / API Routes
- Zod
- Tailwind CSS
- shadcn/ui
- TanStack Table
- Recharts
- Playwright
- Vitest
- GitHub Actions
- Vercel
- Sentry
- Optional: Upstash Redis
- Optional: Inngest / Trigger.dev

MVP’de modular monolith öner.

Domain klasörleri:

- auth
- organizations
- users
- teams
- tasks
- reviews
- scoring
- point-ledger
- bonus-periods
- bonus-pools
- bonus-calculation
- bonus-ledger
- disputes
- audit
- notifications
- anti-gaming
- reports
- admin

### 10.2. Enterprise Architecture

Enterprise V2/V3 için değerlendir:

- API Gateway
- Auth Service
- Task/Quest Service
- Scoring Service
- Leaderboard Service
- Bonus/ICM Service
- Audit Service
- Notification Service
- PostgreSQL
- Redis ZSET
- Queue/Event Broker
- Worker jobs
- Data warehouse/export
- Payroll integration adapters

Karar ver:

- Hangi modüller MVP’de aynı uygulama içinde kalmalı?
- Hangi modüller daha sonra servisleşebilir?
- Event-driven architecture ne zaman gerekir?
- Redis ne zaman şart olur?
- RabbitMQ/Kafka ne zaman gereksizdir?

## 11. Database Schema

PostgreSQL/Supabase için gerçek uygulanabilir schema tasarla.

En az şu tablolar olsun:

- organizations
- organization_settings
- users / profiles
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

Her tablo için:

- fields
- primary key
- foreign keys
- indexes
- unique constraints
- check constraints
- RLS policy idea
- soft delete gereksinimi
- audit gereksinimi
- sensitive data classification

## 12. RLS ve Multi-Tenant Security

Her tablo organization_id ile izole edilmeli.

RLS zorunlu.

Roller:

- Organization Owner
- Admin
- HR Manager
- Finance Manager
- Department Manager
- Team Lead
- Employee
- Auditor
- Support/Super Admin

Policy rules:

- Employee sadece kendi görev/puan/prim verisini görür.
- Employee başkasının bonus detayını göremez.
- Manager sadece kendi takımını görebilir.
- HR organization seviyesinde çalışan performans/itiraz raporunu görebilir.
- Finance görev detayını değil, ödeme/export detayını görür.
- Auditor read-only audit ve snapshot görür.
- Super Admin tenant verisine sadece support access grant ile erişir.
- Service role sadece server-side trusted context’te kullanılır.
- Client-side role check yeterli değildir.

Cross-tenant testleri zorunlu yap.

## 13. Dispute / Appeal Sistemi

Çalışanların puan ve prim sonuçlarına itiraz hakkı olmalı.

Dispute types:

- task_points_too_low
- unfair_rejection
- quality_score_dispute
- missing_task_credit
- bonus_calculation_dispute
- manager_bias_report
- anomaly_false_positive
- system_error
- clawback_dispute

Workflow:

- Employee dispute açar.
- Manager dışı reviewer atanabilir.
- HR gerekirse dahil olur.
- Karar audit log’a yazılır.
- Puan değişirse point ledger adjustment oluşur.
- Prim değişirse bonus recalculation snapshot oluşur.
- Çalışana açıklanabilir decision note gösterilir.

## 14. UI/UX Planı

Premium SaaS dashboard kalitesi hedefle.

Tasarım dili:

- kurumsal
- modern
- güven veren
- finance-grade
- HR-tech
- sakin gamification
- açıklanabilir
- çalışanı baskılamayan
- veri odaklı
- erişilebilir

Employee screens:

- My Work Dashboard
- My Tasks
- Task Detail
- Submit Work
- My Points
- Point Breakdown
- My Estimated Bonus
- Bonus Breakdown
- My Ranking / Percentile
- My Disputes
- Notifications
- Profile / Privacy

Manager screens:

- Team Dashboard
- Assign Task
- Review Queue
- Review Detail
- Team Points
- Fairness Warnings
- Anomaly Flags
- Dispute Inbox
- Bonus Impact Preview

HR screens:

- Organization Dashboard
- Users & Teams
- Scoring Policies
- Bonus Periods
- Bonus Pools
- Disputes
- Fairness Analytics
- Audit Logs
- Privacy Center
- Policy Version History

Finance screens:

- Bonus Pool Approval
- Calculation Runs
- Allocation Snapshot
- Payment Export
- Paid Status
- Clawback Review

Auditor screens:

- Audit Explorer
- Calculation Snapshots
- Policy Changes
- Export Logs
- Support Access Logs

UX rules:

- “Bu puanı neden aldım?” açıklanmalı.
- “Bu prim nasıl hesaplandı?” açıklanmalı.
- Estimated bonus gerçek hak ediş gibi gösterilmemeli.
- Pending/approved/disputed puanlar ayrılmalı.
- Dönem kapanışı net görünmeli.
- Leaderboard psikolojik baskı yaratmamalı.
- Empty/loading/error states tasarlanmalı.
- WCAG erişilebilirlik kuralları düşünülmeli.

## 15. Claude Code Skill Set

`.claude/skills` altında şu skill’leri tasarla ve her biri için `SKILL.md` içeriği üret:

1. `source-verification-research`
2. `product-prd-architect`
3. `tournament-theory-risk-review`
4. `octalysis-gamification-designer`
5. `bonus-scoring-engine-designer`
6. `financial-ledger-architect`
7. `database-rls-architect`
8. `anti-gaming-fraud-detection`
9. `security-threat-model`
10. `frontend-dashboard-ux`
11. `accessibility-review`
12. `performance-audit`
13. `qa-e2e-playwright`
14. `mcp-security-auditor`
15. `code-reviewer`

Her skill için:

- name
- description
- when to use
- inputs
- outputs
- files to inspect
- forbidden actions
- checklist
- success criteria

Kod yazmadan önce sadece skill taslaklarını üret.

## 16. Claude Subagent Mimarisi

Şu custom subagent’ları tasarla:

1. `source-verifier`
2. `product-strategist`
3. `hr-compensation-risk-analyst`
4. `tournament-risk-analyst`
5. `gamification-ethics-designer`
6. `domain-modeler`
7. `database-rls-architect`
8. `scoring-bonus-mathematician`
9. `financial-ledger-reviewer`
10. `anti-gaming-analyst`
11. `security-threat-modeler`
12. `frontend-ux-architect`
13. `qa-test-planner`
14. `mcp-security-reviewer`
15. `adversarial-reviewer`
16. `documentation-architect`

Her subagent için:

- purpose
- when to invoke
- context limits
- allowed tools
- forbidden tools
- expected output format
- handoff format
- files owned
- review responsibilities

Subagent’lar ana context’i şişirmemeli; uzun araştırma yapıp kısa karar raporu dönmeli.

## 17. MCP ve Tooling Planı

MCP araçlarını minimum yetkiyle kullan.

Değerlendirilecek MCP’ler:

- GitHub MCP
- Supabase MCP
- Playwright MCP
- Context7 MCP

Kurallar:

- Başlangıçta GitHub MCP read-only.
- Write toolset sadece açık izinle.
- Supabase MCP production database’e bağlanmaz.
- Supabase MCP staging/dev için kullanılır.
- Playwright MCP E2E test ortamında kullanılır.
- Unsafe browser code kapalı kalır.
- Context7 güncel dokümantasyon için kullanılır ama tek kaynak kabul edilmez.
- MCP server’lar trusted source dışından kurulmaz.
- MCP secret/token audit edilir.
- Tool permissions CLAUDE.md ve hooks ile sınırlandırılır.

## 18. GitHub Repo ve Referans İnceleme Planı

Aşağıdaki repoları/konuları incele ama doğrudan kopyalama yapma.

Her repo için şu scoring tablosunu üret:

- relevance score
- production readiness
- maintenance status
- license
- architecture value
- code quality signal
- security risk
- what to copy conceptually
- what not to copy
- MVP relevance
- V2/V3 relevance

Referans kategorileri:

### Claude / Agent / MCP

- anthropics/claude-code
- anthropics/claude-code-action
- github/github-mcp-server
- supabase/mcp
- microsoft/playwright-mcp
- upstash/context7
- awesome-claude-code
- awesome-claude-code-subagents
- claude-code-hooks examples

### SaaS / Task / Project Management

- Worklenz/worklenz
- Plane
- OpenProject
- nextjs/saas-starter
- makerkit nextjs starter
- shadcn/ui dashboard blocks

### Gamification / Points / Habit / Task

- axelfrache/questify
- donetick/donetick
- isuru89/oasis
- Ayagikei/LifeUp
- dromse/obsidian-gamified-tasks
- Employee Rewards style repos

### Leaderboard / Redis

- topfreegames/podium
- Redis official leaderboard examples
- real-time leaderboard examples

### Compensation / Payroll / Ledger Concepts

- ERPNext payroll concepts
- Odoo payroll concepts
- open-source ledger/accounting patterns
- double-entry accounting examples

### Anti-Fraud / Rule Engine

- json-rules-engine
- open-source anomaly detection examples
- graph fraud detection concepts

Önce kaynakları doğrula. Güncel olmayan veya düşük kaliteli kaynakları işaretle.

## 19. CLAUDE.md Tasarımı

Proje kökü için `CLAUDE.md` üret.

İçinde şunlar olsun:

- project mission
- non-negotiable rules
- stack
- architecture rules
- database rules
- RLS rules
- scoring rules
- bonus calculation rules
- ledger rules
- audit rules
- anti-gaming rules
- privacy rules
- legal/ethical guardrails
- UI/UX rules
- testing rules
- MCP/tooling rules
- forbidden actions
- before-coding checklist
- after-coding checklist
- definition of done

Yasaklar:

- RLS’siz tablo oluşturmak
- client-side authorization’a güvenmek
- user.total_points gibi mutable score source of truth yapmak
- ledger kaydı silmek
- bonus snapshot almadan final allocation üretmek
- period lock sonrası silent mutation yapmak
- manual adjustment’ı reason/audit olmadan yapmak
- employee monitoring/screen tracking eklemek
- leaderboard’u public shaming aracına çevirmek
- pure tournament modelini default yapmak
- test yazmadan business logic merge etmek
- production database’e MCP ile doğrudan müdahale etmek
- unsafe tool permission açmak

## 20. ADR’ler

En az şu ADR’leri üret:

- ADR-001: Safe pro-rata default vs pure tournament
- ADR-002: Hybrid team reserve bonus model
- ADR-003: Multi-tenant architecture
- ADR-004: Supabase RLS strategy
- ADR-005: Point ledger vs mutable score
- ADR-006: Bonus ledger and calculation snapshots
- ADR-007: Zero Factor and malus/clawback policy
- ADR-008: Leaderboard privacy model
- ADR-009: Redis as read-model, not source of truth
- ADR-010: Anti-gaming anomaly detection strategy
- ADR-011: Dispute and appeal workflow
- ADR-012: Server-side authorization
- ADR-013: MVP modular monolith vs microservices
- ADR-014: MCP/tooling security strategy
- ADR-015: Testing strategy
- ADR-016: Legal/privacy guardrails

Her ADR için:

- context
- decision
- alternatives considered
- consequences
- risks
- implementation notes

## 21. Implementation Roadmap

Kodlama yapmadan roadmap üret.

### Phase 0 — Source & Prompt Audit

- PDF analizi
- referans doğrulama
- mevcut prompt analizi
- çelişkilerin çıkarılması

### Phase 1 — Product & Risk Framing

- PRD
- hedef kullanıcılar
- kullanım senaryoları
- turnuva riski
- MVP sınırları
- legal/ethical risk map

### Phase 2 — Domain Model & Permissions

- entities
- workflows
- permission matrix
- RBAC
- RLS strategy

### Phase 3 — Database & Ledger Foundation

- schema
- migrations
- RLS
- point ledger
- bonus ledger
- audit log
- seed data

### Phase 4 — Task & Review Core

- task CRUD
- assignment
- submission
- manager review
- approval/rejection
- comments/attachments

### Phase 5 — Scoring Engine

- scoring policies
- policy versions
- multipliers
- caps
- role normalization
- point ledger entries

### Phase 6 — Bonus Engine

- bonus periods
- bonus pools
- eligibility
- zero factor
- calculation runs
- snapshots
- allocations

### Phase 7 — Anti-Gaming & Disputes

- anomaly flags
- Z-score baseline
- collusion signals
- dispute workflow
- recalculation

### Phase 8 — Dashboards & UX

- employee dashboard
- manager dashboard
- HR dashboard
- finance dashboard
- leaderboard
- bonus breakdown

### Phase 9 — Testing & Security

- unit tests
- business logic tests
- RLS tests
- permission tests
- E2E tests
- security review
- performance review

### Phase 10 — Production Readiness

- monitoring
- error handling
- audit exports
- documentation
- deployment checklist
- support access workflow

Her faz için:

- goal
- deliverables
- files/modules
- acceptance criteria
- test criteria
- risk checklist
- dependencies
- estimated difficulty

## 22. Test Strategy

Şu testleri üret:

### Business Logic Tests

- task submitted does not grant final points
- task approved creates point ledger entry
- task rejected creates no points
- policy version locked after period start
- manual override requires reason
- manual override creates audit log
- period lock blocks mutation
- dispute adjustment creates ledger entry
- bonus calculation creates immutable snapshot
- zero total points handled
- cap applied
- quality threshold applied
- zero factor applied
- clawback requires approval
- rounding correct

### Permission / RLS Tests

- employee cannot see another employee bonus
- employee cannot approve own task
- manager cannot edit HR-approved bonus pool
- finance cannot change task score
- auditor read-only
- cross-tenant access blocked
- service role not exposed client-side
- support access requires grant

### Anti-Gaming Tests

- task splitting flag
- rapid approval flag
- repeated same reviewer flag
- abnormal score spike flag
- Z-score threshold flag
- self-approval blocked
- peer reciprocity flag
- period-end spike flag

### E2E Tests

- employee submits task -> manager approves -> points appear
- monthly period closes -> bonus calculation generated
- employee views bonus breakdown
- employee opens dispute
- HR resolves dispute
- recalculation snapshot created
- finance exports payout
- auditor reviews audit trail

## 23. Output Format

Cevabını şu yapıda üret:

1. Context Pack & Previous Prompt Audit
2. Adopt / Modify / Reject Matrix
3. Executive Summary
4. Product Principles
5. Tournament Theory Risk Analysis
6. Octalysis Gamification Design
7. PRD
8. User Roles & Permission Matrix
9. Domain Model
10. Core Workflows
11. Scoring Engine
12. Bonus Engine
13. Zero Factor / Malus / Clawback
14. Anti-Gaming & Fraud Detection
15. Leaderboard Privacy Model
16. Legal / Privacy / Ethical Risk Review
17. Database Schema
18. RLS Strategy
19. API / Server Actions Plan
20. Audit / Ledger Strategy
21. Dispute System
22. UI/UX Plan
23. Technical Architecture: MVP and Enterprise
24. Claude Code Skills
25. Claude Subagents
26. MCP Security Plan
27. GitHub Repo / Reference Review Plan
28. CLAUDE.md Draft
29. ADRs
30. Implementation Roadmap
31. Test Strategy
32. MVP Scope
33. Open Questions
34. Final Recommendation
35. First 10 Concrete Next Steps

## 24. Çalışma Kuralları

- Kod yazma.
- Önce analiz ve plan üret.
- Belirsiz varsayımları “Assumption” diye işaretle.
- Hukuki konularda kesin hüküm verme; hukuk danışmanı gerektiren noktaları belirt.
- Marketing iddialarını doğrulanmış gerçek gibi sunma.
- Model/fiyat/benchmark iddialarını güncel doğrulama olmadan sabitleme.
- MVP’yi aşırı büyütme.
- Mikroservis mimarisini hemen dayatma.
- Pure tournament modelini default yapma.
- Çalışan gözetimi/surveillance özelliği önerme.
- Finansal hesaplamaları açıklanabilir yap.
- Her kritik hesaplama için snapshot üret.
- Her kritik mutation için audit log üret.
- Her risk için ürün koruması öner.
- Her faz için acceptance criteria yaz.
- Her güvenlik kuralı için test yaz.
- Sonunda gerçekten uygulanabilir, sıralı ilk 10 adımı ver.

## 25. Nihai Kalite Barı

Çıktı şu seviyede olmalı:

- basit todo app değil
- basit leaderboard değil
- basit prim hesaplayıcı değil
- çalışanı gözetleyen araç değil
- hukuki riski görmezden gelen sistem değil
- kurumsal, denetlenebilir, adil, açıklanabilir, test edilebilir HR-tech SaaS planı

Şimdi bu planlama paketini üret.

---
