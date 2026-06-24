# 03 — Permission & RLS Strategy (DEEP)

## Purpose

MeritFlow'un yetkilendirme modelini iki katmanda tanımlamak: (1) uygulama seviyesi RBAC
(rol → izin), (2) veritabanı seviyesi Row-Level Security (RLS) ile tenant izolasyonu ve
satır/kolon görünürlüğü. Bu doküman, "client-side authorization yeterli değildir" ilkesini
somut policy intent'lerine çevirir. **DDL/migration içermez; policy'ler "intent" (pseudo) olarak yazılır.**

## Scope

- Kapsam: MVP rolleri (Owner, Admin, HR, Finance, Manager, Employee, Auditor, Support-via-grant).
- Kapsam: Her kritik tablo için RLS policy intent + Finance kolon/view stratejisi + support access + comp audit.
- Kapsam dışı: Department Manager / Team Lead (V1), multi-role merge (V1, AD2), attribute-based access control (V1+).

## Assumptions

- `Assumption:` Auth sağlayıcısı Supabase Auth; `auth.uid()` server-side erişilebilir.
- `Assumption:` Her isteğin org bağlamı, kullanıcının aktif membership'inden türetilir (tek aktif org/oturum).
- Roller ve yetkiler DB'deki `memberships` / RBAC kayıtlarından okunur; **JWT yalnız identity** için kullanılır,
  authorization source of truth değildir (Decision Lock AD1).
- `Assumption:` Service role yalnız trusted server context'te (Server Actions / job) kullanılır, asla client'a gönderilmez.

## Non-negotiable rules

- Her tabloda RLS **ENABLED** ve **FORCE** (table owner dahil bypass yok).
- Her policy ilk koşul olarak `organization_id = current_org()` içerir.
- Client-side role / JWT claim **source of truth değildir** (AD1); gerçek karar DB + server'da verilir.
- Service role key client bundle'a asla dahil edilmez.
- Finance görev *içeriğini/puan detayını* göremez; yalnız ödeme özetini görür (kolon/view kısıtı).
- Employee başka çalışanın bonus/puan detayını göremez; compensation audit payload'ı **hiç** göremez (AD3).
- Super Admin/Support tenant verisine yalnız aktif `support_access_grant` ile erişir; her erişim audit'lenir.
- Cross-tenant erişim için zorunlu negatif testler yazılmadan ilgili tablo "done" sayılmaz.

## Detailed specification

### 1. RBAC katmanı

Her organization membership için tek `primary_role` (Decision Lock AD2). İzinler `permissions` +
`role_permissions` ile DB'de tanımlanır (data-driven, server-side authorization kaynağı). Multi-role
merge V1'e ertelenir; ileride gelirse **explicit deny / sensitive restriction allow'dan üstündür** (AD2).

Permission anahtarları (örnek, MVP):
`org.settings.read/write`, `user.invite`, `team.manage`, `task.create`, `task.assign`,
`task.submit`, `task.review`, `point.override`, `period.manage`, `pool.create`,
`calculation.approve`, `payout.export`, `payout.mark_paid`, `clawback.review`,
`dispute.open`, `dispute.resolve`, `audit.read`, `comp.read`, `support.grant`.

| Permission | Owner | Admin | HR | Finance | Manager | Employee | Auditor |
| --- | :--: | :--: | :--: | :--: | :--: | :--: | :--: |
| org.settings.write | ✔ | – | – | – | – | – | – |
| user.invite / team.manage | ✔ | ✔ | – | – | own team(r) | – | – |
| task.create / task.assign | ✔ | ✔ | – | – | own team | – | – |
| task.submit | – | – | – | – | – | own | – |
| task.review | – | – | – | – | team (not own) | – | – |
| point.override | – | 2-step | – | – | 2-step | – | – |
| period.manage | ✔ | – | ✔ | – | – | – | – |
| pool.create | – | – | – | ✔ | – | – | – |
| calculation.approve | – | – | ✔ | – | – | – | – |
| payout.export / mark_paid | – | – | – | ✔ | – | – | – |
| clawback.review | – | – | – | ✔ | – | – | – |
| dispute.open | – | – | – | – | – | own | – |
| dispute.resolve | – | – | ✔ | – | not-own-decision | – | – |
| audit.read | ✔ | ✔ | ✔ | financial only | – | – | full(ro) |
| comp.read | – | – | min | min | – | – | – |
| support.grant | ✔ | – | – | – | – | – | – |

`2-step` = ikinci onay + reason + audit gerektirir.

### 2. RLS katmanı — yardımcı fonksiyonlar (intent)

Aşağıdakiler "stable security-definer" yardımcılar olarak tasarlanır; **rol/izin kaynağı DB'dir** (AD1):

- `current_org() -> uuid` : aktif oturumun org_id'si (membership üzerinden).
- `has_role(role text) -> boolean` : kullanıcının current_org'daki `primary_role`'ü (DB lookup).
- `has_permission(key text) -> boolean` : role_permissions üzerinden izin kontrolü (DB lookup).
- `manages_team(team_id uuid) -> boolean` : kullanıcı bu takımın manager'ı mı.
- `has_support_grant(org uuid) -> boolean` : aktif support access grant var mı.

> Bu fonksiyonlar `SECURITY DEFINER` + sabit `search_path` ile yazılmalı ve yalnız okuma yapmalı
> (recursive RLS tuzağından kaçınmak için membership okuması dikkatli kurgulanır). JWT claim'e güvenilmez.

### 3. Tablo bazlı RLS policy intent

Notasyon: `USING` = okunabilir satır filtresi; `WITH CHECK` = yazılabilir satır kısıtı.
Tüm policy'ler örtük olarak `organization_id = current_org()` ile başlar.

**memberships**
- SELECT USING: `organization_id = current_org()` ve (`profile_id = auth.uid()` OR `has_permission('user.invite')` OR `has_role('HR')`).
- INSERT/UPDATE WITH CHECK: `has_permission('user.invite')`.

**tasks**
- SELECT USING: org eşit ve (`assignee_id = auth.uid()` OR `created_by = auth.uid()` OR `reviewer_id = auth.uid()` OR `manages_team(team_id)` OR `has_role('HR')` OR `has_role('Admin')` OR `has_role('Owner')` OR `has_role('Auditor')`).
- INSERT WITH CHECK: `has_permission('task.create')` ve (`manages_team(team_id)` OR `has_role('Admin')`).
- UPDATE WITH CHECK:
  - assignee yalnız kendi görevini ve yalnız `submit` geçişi için (status whitelist).
  - reviewer yalnız `task.review` ve `reviewer_id = auth.uid()` ve `assignee_id <> auth.uid()` (self-approval block).
  - Finance/Auditor: UPDATE yok.
- Period lock sonrası: ilgili döneme bağlı task'larda mutation engellenir (status/lock guard).

**task_reviews**
- SELECT USING: ilgili task SELECT'i görenler.
- INSERT WITH CHECK: `task.review` ve reviewer = auth.uid() ve task.assignee <> auth.uid().

**point_ledger** (append-only)
- SELECT USING: `employee_id = auth.uid()` OR `manages_team(team_of(employee_id))` OR `has_role('HR')` OR `has_role('Auditor')`.
- INSERT WITH CHECK: yalnız server/trusted (`has_permission` veya service context); manuel override `reason` + audit.
- UPDATE/DELETE: **policy yok → tamamen yasak** (append-only).

**bonus_allocations / bonus_allocation_snapshots**
- SELECT USING:
  - Employee: `employee_id = auth.uid()` (yalnız kendi allocation'ı; başka çalışan satırı görünmez).
  - HR: org seviyesinde.
  - Finance: erişir ama **kolon kısıtı** (aşağı bkz).
  - Auditor: read-only tüm snapshot.
- INSERT: yalnız calculation run (trusted). UPDATE/DELETE: snapshot için yasak (immutable).

**bonus_ledger**
- SELECT USING: `has_role('Finance')` OR `has_role('Auditor')` OR (`employee_id = auth.uid()` ve yalnız özet alanlar — view ile).
- INSERT: trusted/calculation/payout. UPDATE/DELETE: yasak (düzeltme = reversal entry).

**compensation_records** (comp-sensitive, Decision Lock D7/AD6)
- SELECT USING: `has_permission('comp.read')` (yalnız HR/Finance, minimum) — Employee/Manager/Auditor **göremez**.
- INSERT/UPDATE WITH CHECK: `has_permission('comp.read')` + audit zorunlu.
- Her SELECT erişimi uygulama katmanında audit'lenir; erişim audit'i ayrıca audit log'a düşer (AD3).

**disputes / dispute_events**
- SELECT USING: `complainant_id = auth.uid()` OR `assigned_reviewer_id = auth.uid()` OR `has_role('HR')` OR `has_role('Auditor')`.
- INSERT (open): `has_permission('dispute.open')` ve complainant = auth.uid().
- UPDATE (resolve): `has_permission('dispute.resolve')` ve reviewer kendi verdiği task kararına bakıyorsa final-decision engeli (uygulama kuralı + audit).

**audit_logs**
- SELECT USING: `has_permission('audit.read')`; Finance yalnız financial action subset (kolon/satır filtresi).
- Compensation-ilişkili audit satırları: liste görünümünde **masked summary** (action/actor/target/timestamp);
  raw before/after comp payload yalnız `comp.read` yetkisi + **gerekçeli erişim** ile; bu erişim de audit'lenir (AD3).
- INSERT: trusted. UPDATE/DELETE: yasak.

**support_access_grants**
- SELECT USING: `has_role('Owner')` OR `has_role('Auditor')`.
- INSERT: `has_permission('support.grant')`.

Diğer tablolar (teams, projects, objectives, notifications, exports, bonus_periods/pools,
scoring_policies/versions) aynı kalıpla: org filtresi + ilgili permission.

### 4. Finance kolon/view stratejisi (kritik)

RLS yalnız **satır** filtreler; "Finance görev detayını görmesin, ödeme özetini görsün" gereksinimi
**kolon** kısıtı ister. Strateji:
- Finance'a doğrudan `tasks`/`task_reviews`/`point_ledger` SELECT'i **verilmez**.
- Finance için dedicated **read view'lar**: `v_finance_allocation_summary`, `v_finance_payout`,
  `v_finance_period_totals`. Bu view'lar yalnız: employee_id, display_name (veya rumuz), period,
  final_amount, status, paid_at içerir; raw points / task içerik / quality detayını **içermez**.
- comp alanları (maaş) hiçbir Finance view'ında ham gösterilmez; cap yalnız "cap applied: yes/no" veya
  `pending_missing_cap_basis` flag'i olarak yansır (AD6).
- View'lar `security_invoker` ile çalışır ve alttaki tabloların RLS'ine tabidir.

### 5. Support access (Super Admin)
- Varsayılan: tenant verisine erişim **yok**.
- Owner bir `support_access_grant` oluşturur: scope + expires_at (süreli).
- Grant aktifken `has_support_grant()` true döner; ilgili read policy'ler support'a izin verir.
- Her support erişimi server katmanında `audit_logs`'a (`action = support.access`) yazılır.
- Grant süresi dolunca erişim otomatik kapanır.

### 6. Service role kullanımı
- Yalnız: scoring hesap, calculation run, snapshot yazımı, audit yazımı, bildirim fan-out.
- Service role kullanan her server fonksiyonu, kullanıcı yetkisini **uygulama katmanında** ayrıca doğrular
  (RLS bypass edildiği için authorization server'da tekrar kontrol edilir).
- Service role key environment secret; client bundle'a girmez; loglanmaz.

## Edge cases

- **Recursive RLS:** membership tablosu hem RLS'e tabi hem de `current_org()`/`has_role()`
  tarafından okunuyor → yardımcı fonksiyonlar `SECURITY DEFINER` ile bu döngüyü kırar.
- **Multi-org kullanıcı:** aktif org bağlamı yanlışsa veri sızar → her oturumda tek aktif org;
  org değişimi explicit ve audit'li.
- **Rol değişimi ortasında açık oturum:** rol/izin DB'den okunduğu için (AD1) değişiklik bir sonraki
  yetki kontrolünde anında etki eder; JWT claim'e bağımlı stale yetki riski yoktur.
- **Multi-role (gelecek):** explicit deny > allow; sensitive restriction her zaman kazanır (AD2).
- **Period lock sırasında yarış (race):** lock işlemi sırasında gelen mutation reddedilir (lock guard + transaction).

## Acceptance criteria

- Tüm tablolarda RLS ENABLED + FORCE; RLS'siz tablo yok.
- Her policy org filtresi içeriyor.
- Rol/izin yalnız DB'den okunuyor; JWT claim authorization için kullanılmıyor (AD1).
- Finance hiçbir yoldan ham task/point/comp verisine ulaşamıyor (view-only).
- Employee başka çalışanın allocation/point satırını ve comp audit payload'ını göremiyor (AD3).
- Support erişimi yalnız aktif grant ile ve audit'li.
- Service role client bundle'da bulunmuyor.

## Test implications

- RLS negatif testleri (zorunlu, bloklayıcı):
  - employee ≠ başka employee bonus/point satırı.
  - employee ≠ kendi görevini approve.
  - manager ≠ başka takımın görevi.
  - finance ≠ task score / raw points / comp.
  - auditor = read-only (her write reddedilir).
  - cross-tenant: A org kullanıcısı B org satırına erişemez (her tablo için).
  - support erişimi grant olmadan reddedilir; grant ile audit üretir.
- AD1 testi: JWT claim'i manipüle edilmiş istek yetki kazanamaz (authz DB'den).
- AD3 testi: employee comp audit payload göremez; raw comp payload yalnız yetki+gerekçe ile; erişim audit üretir.
- View bazlı testler: Finance view'ı yalnız izin verilen kolonları döndürür.

## Open questions

- OQ-RLS-2 (kısmen açık): `compensation_records` erişim audit'i DB trigger ile mi yoksa server-only mı
  üretilir? AD3 audit'i zorunlu kılar; mekanizma (trigger vs server) implementation detayı, Phase 3'te netleşir.
