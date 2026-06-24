# 17 — Phase 3A: Database Foundation & RBAC — Implementation Plan

> **STATUS: Phase 3A VERIFIED / DONE (2026-06-24).** Bu plan onaylanıp uygulandı ve lokal dev stack'te
> doğrulandı. Kanıt: `supabase db reset` passed (migrations `0001..0007` + seed), `supabase test db`
> passed — **38/38 pgTAP testi geçti (0 fail)**. Doğrulama sırasında tek kod/test değişikliği
> `supabase/tests/0001_phase3a_rls.test.sql` oldu (pgTAP `throws_ok` assertion formu 3-arg→strict 4-arg
> `(sql, errcode, errmsg, description)` düzeltildi); **migration/seed/RLS/schema bug bulunmadı**. Kod
> `supabase/` altında. **Phase 3B+ hâlâ gated** ve ayrı, birebir authorization ister (ADR-020).
> *(Aşağıdaki plan metni tarihsel referans olarak korunmuştur.)*

---

> **Bu dosya implementation DEĞİLDİR. Bu dosya yalnızca bir implementation PLANIDIR.**
> Hiçbir kod, SQL, migration, RLS policy gövdesi, seed verisi veya test bu dosyada yazılmaz; burada
> yalnızca *ne yapılacağı, hangi sırayla ve hangi kabul kriteriyle* tanımlanır. Gerçek implementation
> ancak kullanıcı bu dosyanın sonundaki tam yetki cümlesini yazarsa başlar (ADR-020; izin **faz-sınırlı**).

## 1. Purpose

Phase 3 (Database & Ledger Foundation) güvenlik temelinin **ilk dilimini (3A)** — yalnızca tenant
çekirdeği, RBAC, takım yapısı, support access, audit iskeleti ve RLS temeli — gerçek kodlamaya geçmeden
önce adım adım, geri-alınabilir ve test edilebilir bir plana bağlamak. Bu dilim, sonraki tüm fazların
(task/scoring/bonus) üzerine inşa edileceği multi-tenant izolasyon ve yetki zeminini kurar.

Kaynak finalize dokümanlar: `13_PHASE_2_DOMAIN_PERMISSIONS_FINAL`, `14_DATA_DICTIONARY_PRE_MIGRATION`,
`15_RLS_POLICY_MATRIX_PRE_MIGRATION`, `16_STATE_MACHINES_AND_INVARIANTS`.

## 2. Scope

Phase 3A **yalnızca** şunları kapsar:

- **Tablolar:** `organizations`, `organization_settings`, `profiles`, `memberships`, `roles`,
  `permissions`, `role_permissions`, `teams`, `team_memberships`, `support_access_grants`,
  `audit_logs` (temel append-only yapı).
- **RLS helper fonksiyonları (temel):** `current_org`, `has_role`, `has_permission`, `manages_team`,
  `has_support_grant` — hepsi `SECURITY DEFINER` + sabit `search_path`, read-only.
- **RLS temeli:** yukarıdaki 11 tabloda RLS ENABLED + FORCE; `organization_id = current_org()` ilk koşul;
  `15_RLS_POLICY_MATRIX` intent'lerinin yalnız bu tablolar için uygulanması.
- **Constraint'ler:** `14_DATA_DICTIONARY` içindeki bu tablolara ait PK/FK/unique/check.
- **Seed:** en az 2 test tenant + roller/izinler/role_permissions + örnek membership/team (cross-tenant
  negatif testleri için).
- **Testler:** bu dilimin RLS + constraint + helper davranışını kanıtlayan **bloklayıcı** negatif/positif suite.

## 3. Explicitly out of scope

Bu fazda **kesinlikle yok** (sonraki dilimlere/fazlara ait):

- `tasks`, `task_assignments`, `task_comments`, `task_attachments`, `task_events`, `task_reviews`
- `scoring_policies`, `scoring_policy_versions`, scoring engine
- `point_ledger`
- `bonus_periods`, `bonus_pools`, `bonus_pool_components`, `bonus_pool_eligibility`
- `bonus_calculation_runs`, `bonus_allocations`, `bonus_allocation_snapshots`, bonus calculation
- `bonus_ledger`
- `compensation_records`
- `disputes`, `dispute_events`
- `anti_gaming_flags`, `anomaly_baselines`
- `notifications`, `exports`
- `projects`, `objectives`, `integrations`, `webhook_events`
- UI / dashboard, API routes / Server Actions
- production data / production veritabanına herhangi bir dokunuş (Supabase MCP prod **yasak**)
- full test suite (yalnız 3A kapsamındaki testler yazılır)
- `team_of`, `owns_review_decision` helper'ları (point_ledger/dispute'a bağlı → sonraki dilim)
- comp audit maskeleme (AD3) implementasyonu — audit tablosu iskeleti kurulur, comp payload mantığı 3B+

## 4. Source documents to read before implementation

Implementation **başlamadan önce** (before-coding checklist, CLAUDE.md) okunacaklar:

- `CLAUDE.md` (non-negotiable rules, before/after-coding checklist)
- `docs/planning/00_DECISION_LOCK.md` (D1–D12 + AD1–AD10; özellikle **AD1, AD2, D4**)
- `docs/planning/13_PHASE_2_DOMAIN_PERMISSIONS_FINAL.md` (domain/role/support/cross-tenant)
- `docs/planning/14_DATA_DICTIONARY_PRE_MIGRATION.md` (bu 11 tablonun alan/constraint/index/sensitivity)
- `docs/planning/15_RLS_POLICY_MATRIX_PRE_MIGRATION.md` (bu 11 tablonun policy intent + negatif testler)
- `docs/planning/16_STATE_MACHINES_AND_INVARIANTS.md` (support grant machine; SI-6/SI-7/SI-11/SI-16)
- `docs/adr/ADR-003` (multi-tenant), `ADR-004` (Supabase RLS), `ADR-012` (server-side authz),
  `ADR-014` (MCP/tooling security), `ADR-020` (implementation gate)
- `docs/context/06_DATABASE_REQUIREMENTS.md`, `docs/context/04_ROLE_PERMISSION_MATRIX.md`

## 5. Files likely to be created/modified

> Mevcut repo'da uygulama iskeleti yok (yalnız `docs/`). 3A implementation'ı (yetki verildiğinde) minimal
> Supabase yerel geliştirme yapısı kurar. Aşağıdaki yollar **öneridir**; kesin isimler implementation'da netleşir.

- `supabase/config.toml` — yerel Supabase (dev/staging) yapılandırması (prod **değil**).
- `supabase/migrations/0001_extensions_and_helpers.sql` — uzantılar + ortak yardımcılar (örn. `updated_at` trigger fonksiyonu).
- `supabase/migrations/0002_core_tenant_identity.sql` — organizations, organization_settings, profiles.
- `supabase/migrations/0003_rbac.sql` — roles, permissions, role_permissions, memberships.
- `supabase/migrations/0004_teams.sql` — teams, team_memberships.
- `supabase/migrations/0005_support_and_audit.sql` — support_access_grants, audit_logs (iskelet).
- `supabase/migrations/0006_rls_helpers.sql` — `current_org`, `has_role`, `has_permission`, `manages_team`, `has_support_grant`.
- `supabase/migrations/0007_rls_enable_and_policies.sql` — 11 tabloda RLS ENABLE + FORCE + policy'ler.
- `supabase/seed/seed_test_tenants.sql` (veya `supabase/seed.sql`) — test tenant seed planı (§10).
- `supabase/tests/` (pgTAP) **veya** `tests/rls/*.test.ts` (Vitest + rol bazlı bağlantılar) — 3A testleri.
- `docs/planning/12_IMPLEMENTATION_ROADMAP.md` — Phase 3 durum notu güncellemesi (opsiyonel, implementation sırasında).

> Migration dosyalarının bölünmesi (tek vs çok dosya) implementation kararıdır; plan yalnız mantıksal grupları verir.

## 6. Tables included

`14_DATA_DICTIONARY` referansıyla, 3A'da oluşturulacak 11 tablo:

| Tablo | Amaç (kısa) | Hassasiyet | Append-only? |
| --- | --- | --- | --- |
| organizations | tenant kök | internal | hayır |
| organization_settings | org default policy (cap_default, locale) | confidential | hayır |
| profiles | kullanıcı profili (auth bağı) | personal-data | hayır |
| memberships | (org, profile, primary_role) — RLS anchor | confidential | hayır (status update; DELETE yok) |
| roles | rol kataloğu (D4) | internal | hayır |
| permissions | izin anahtarı kataloğu | internal | hayır |
| role_permissions | rol→izin eşlemesi (authz kaynağı — AD1) | confidential | hayır |
| teams | takım birimi | internal | hayır |
| team_memberships | employee↔team (primary_team — AD9) | internal | hayır |
| support_access_grants | süreli/sınırlı support erişimi (D4) | audit-critical | DELETE yok |
| audit_logs | append-only audit (iskelet) | audit-critical | **evet (UPDATE/DELETE yasak)** |

> `audit_logs` 3A'da **iskelet** kurulur (alan yapısı + append-only + RBAC/membership mutation audit'i).
> Comp maskeleme (AD3) ve finansal action subset'i sonraki dilimlerde genişletilir.

## 7. Helper functions included

Hepsi `SECURITY DEFINER`, sabit `search_path`, **read-only**; recursive RLS tuzağını kırar; JWT'ye güvenmez (AD1).

| Fonksiyon | İmza (intent) | Görev |
| --- | --- | --- |
| `current_org()` | `-> uuid` | aktif oturumun org_id'si (membership üzerinden) |
| `has_role(key text)` | `-> boolean` | current_org'da kullanıcının primary_role'ü (DB lookup) |
| `has_permission(key text)` | `-> boolean` | role_permissions üzerinden izin kontrolü (DB lookup) |
| `manages_team(team_id uuid)` | `-> boolean` | kullanıcı bu takımın manager'ı mı |
| `has_support_grant(org uuid)` | `-> boolean` | aktif (süresi geçmemiş) support grant var mı |

> Ertelenen: `team_of(employee_id)` (point_ledger ile gelir), `owns_review_decision(dispute_id)` (dispute ile gelir).

## 7A. Recursive RLS mitigation (binding — migration 0006/0007 öncesi karar)

> Refinement 1. Bu bölüm bağlayıcıdır; helper tasarımı (0006) bu kurallara uymadan RLS policy'leri (0007) yazılmaz.

- **`SECURITY DEFINER` tek başına recursive RLS riskini ÇÖZMEZ.** `memberships` üzerinde RLS **FORCE**
  açıkken, table owner'a ait `SECURITY DEFINER` fonksiyon da RLS'e tabidir. Yanlış kurguda
  policy → helper → policy **özyineleme döngüsü** oluşur.
- `current_org()`, `has_role()`, `has_permission()` helper'ları `memberships` / `role_permissions`
  okurken, **okudukları tablonun RLS policy'leri tekrar bu helper'ları çağırmamalıdır**.
- **`memberships` için non-recursive base SELECT policy zorunludur:**
  - kullanıcı kendi membership satırını **`profile_id = auth.uid()`** (veya profile↔auth bağlantısı) ile görebilir;
  - bu base policy `current_org()` / `has_role()` / `has_permission()` **çağırmaz** → özyineleme kırılır;
  - HR / `user.invite` gibi geniş görünürlük **ayrı (ek) policy** olarak eklenir; helper'ların ihtiyaç
    duyduğu self-row erişimi yalnız bu non-recursive base policy ile sağlanır.
- Aynı disiplin `role_permissions` (ve okunan `roles`) için geçerlidir: authz helper'ının okuduğu satırlar,
  helper'ı yeniden tetikleyen bir policy ardında olmamalı (catalog read — bkz. §8A).
- **Alternatif/ek önlem:** helper fonksiyonlarının owner'ı, **`BYPASSRLS` yetkili ayrı güvenli DB rolü**
  olabilir. Bu rol **client / anon / service role ile karıştırılmaz**, client'a asla sızdırılmaz
  (SI-11; ADR-012/ADR-014).
- **Tüm `SECURITY DEFINER` fonksiyonlarında fixed `search_path` zorunlu** (güvenlik + determinizm).
- **Sıra:** bu karar migration **0006 (helper tasarımı)**'da doğrulanır ve migration **0007 (RLS enable +
  policy)**'den **önce** kesinleşmiş olmalıdır. Yanlış sıralama cross-tenant sızıntı veya lockout riskidir.
- **Test (bloklayıcı):** (a) recursive RLS döngüsü oluşmaz (helper çağrısı sonsuz döngü/stack hatası
  üretmez); (b) helper'lar doğru org/role döndürür; (c) non-recursive base policy ile kullanıcı yalnız
  kendi membership self-row'unu okur; (d) FORCE RLS altında helper beklenen satırlara erişir.

## 8. RLS policies included

`15_RLS_POLICY_MATRIX` intent'lerinin **yalnız 3A tabloları** için uygulanması. Özet (tam intent → doc 15):

- **organizations / organization_settings:** SELECT = üye olunan org; settings UPDATE = `org.settings.write` (Owner/Admin) + audit.
- **profiles:** SELECT = kendi + aynı org görünür alanlar; UPDATE = kendi profili.
- **memberships:** SELECT = kendi OR `user.invite`/HR; INSERT/UPDATE = `user.invite`; DELETE yasak (deactivate = status).
- **roles / permissions / role_permissions:** SELECT = read (authz helper); write = Owner/Admin (`role.manage`), role_permissions değişimi audit.
- **teams / team_memberships:** SELECT = org (kendi takım vurgulu); write = `team.manage` (Owner/Admin; Manager kendi takım).
- **support_access_grants:** SELECT = Owner + Auditor; INSERT = `support.grant` (Owner); UPDATE(revoke) = Owner; DELETE yasak.
- **audit_logs:** SELECT = `audit.read`; INSERT = trusted/server; **UPDATE/DELETE yasak (append-only)**.

Genel: her tabloda RLS **ENABLED + FORCE**; **tenant-scoped tablolarda** her policy ilk koşul
`organization_id = current_org()` → **cross-tenant her zaman bloklu** (SI-7); **global/catalog tablolar
istisnadır (bkz. §8A)**; Auditor write yapamaz; Support yalnız aktif grant ile read; service role yalnız
trusted server (client'a sızdırılmaz — SI-11).

## 8A. organization_id exceptions (global / catalog tables)

> Refinement 2. Her tabloya **kör şekilde `organization_id` eklenmez**. "Her policy `organization_id =
> current_org()` ile başlar" kuralı **yalnız tenant-scoped tablolar** için geçerlidir. Bu bölüm
> `14_DATA_DICTIONARY` (alan tanımları) ve `15_RLS_POLICY_MATRIX` (policy intent) ile **çelişmez**; onların
> org-column boyutunu netleştirir.

3A tabloları iki sınıfa ayrılır:

| Tablo | organization_id? | Sınıf | RLS yaklaşımı |
| --- | :--: | --- | --- |
| organizations | **hayır** (tenant root) | root | üye olunan org satırı görünür (membership üzerinden) |
| profiles | **hayır** (global identity) | global | own-profile (`profile↔auth`) + same-org-via-membership görünür alanlar |
| roles | hayır (`is_system` global) | catalog | system catalog read; write Owner/Admin / system migration |
| permissions | hayır (`is_system` global) | catalog | system catalog read; write Owner/Admin / system migration |
| role_permissions | hayır (global mapping; org-override V1) | catalog | authz helper read; write Owner/Admin / system migration |
| organization_settings | **evet** | tenant | `organization_id = current_org()` |
| memberships | **evet** | tenant (anchor) | non-recursive base (§7A) + org-scoped ek policy'ler |
| teams | **evet** | tenant | `organization_id = current_org()` |
| team_memberships | **evet** | tenant | `organization_id = current_org()` |
| support_access_grants | **evet** | tenant | `organization_id = current_org()` (+ Owner/Auditor) |
| audit_logs | **evet** | tenant | `organization_id = current_org()` (+ `audit.read`) |

Notlar:

- `organizations` tenant **root**'tur; kendisi `organization_id` **taşımaz**; görünürlük membership üzerinden.
- `profiles` **global identity**'dir; `organization_id` **taşımaz**; org bağlantısı `memberships` üzerinden kurulur.
- `roles` / `permissions` sistem/global katalog olabilir; `is_system` kayıtları `organization_id` taşımaz;
  org-specific custom rol/izin **V1** (MVP dışı).
- `role_permissions` sistem role-permission mapping için global; org-specific override **V1**.
- Global/catalog tablolara **spurious `organization_id` eklenmez**; bu tablolarda RLS policy farklı yazılır
  (catalog read + sınırlı write); çelişki görülürse Decision Lock + bu plan birlikte referans alınır.

## 9. Constraints included

`14_DATA_DICTIONARY`'den 3A tablolarına ait kısıtlar (intent):

- **PK:** her tabloda `id uuid`.
- **FK:** tüm **tenant-scoped** tablolarda `organization_id → organizations` (global/catalog tablolar
  hariç — bkz. §8A: `organizations`, `profiles`, `roles`, `permissions`, `role_permissions` org FK taşımaz);
  `memberships.profile_id → profiles`,
  `memberships.primary_role → roles` (memberships **`primary_team_id` TAŞIMAZ** — primary team
  canonical = `team_memberships.is_primary`, bkz. doc 13 "Primary team model"); `role_permissions.(role_key,permission_key)`;
  `team_memberships.(team_id, profile_id)`; `support_access_grants.(grantee_id, granted_by)`.
- **unique:** `organizations.slug`; `organization_settings.organization_id` (1-1); `memberships(organization_id, profile_id)`
  (org başına tek aktif membership — tek primary_role, AD2); `roles.key`; `permissions.key`;
  `role_permissions(role_key, permission_key)`; `teams(organization_id, name)`; `team_memberships(team_id, profile_id)`.
- **check:** `organizations.status ∈ {...}`; `organization_settings.cap_rate_default ∈ [0,1]`;
  `memberships.status ∈ {active,pending,deactivated}`; `team_memberships` profil başına en fazla bir `is_primary=true` (AD9);
  `support_access_grants.expires_at > created_at`; `audit_logs` UPDATE/DELETE engeli (policy yokluğu + revoke).
- **index:** `organizations.slug`; `memberships(organization_id, profile_id)`, `memberships.primary_role`;
  `role_permissions(role_key, permission_key)`; `teams(organization_id)`, `teams.manager_id`;
  `team_memberships(team_id, profile_id)`, **partial unique** (`organization_id`,`profile_id`) where is_primary
  (AD9 canonical primary team); `support_access_grants(organization_id, status, expires_at)`;
  `audit_logs(organization_id, action, created_at)`.

## 10. Seeds included

Test tenant seed planı (yalnız dev/staging; prod **değil**). Amaç: RLS + cross-tenant negatif testlerini beslemek.

- **2 tenant:** `Org A` (acme) ve `Org B` (globex) — cross-tenant izolasyon testi için.
- **Roller/izinler:** 7 MVP rolü (owner, admin, hr, finance, manager, employee, auditor — D4) + permission kataloğu
  + `role_permissions` eşlemesi (doc 03/13 RBAC matrisinden).
- **Profiller & membership'ler (her org için):** her rolden en az bir kullanıcı; her birine **tek primary_role** (AD2).
- **Takımlar:** Org A'da en az 2 takım (Team Alpha, Team Beta) + manager atamaları; employee'lere **tek primary_team** (AD9);
  bir manager yalnız kendi takımına bağlı (manages_team testi için).
- **Support:** Org A için bir aktif ve bir süresi geçmiş `support_access_grant` (grant-yok / grant-var / süresi-dolmuş senaryoları).
- **Audit:** seed sırasında üretilen RBAC/membership mutasyonları için örnek audit kayıtları (append-only doğrulaması).
- **Belirleyici (deterministic) ID'ler:** testlerin tekrar edilebilirliği için sabit UUID'ler.

## 11. Tests planned

3A için **bloklayıcı** suite (gerçek Postgres üzerinde, rol bazlı bağlantılar — ADR-004/015):

- **Cross-tenant (SI-7, her tablo):** Org A kullanıcısı Org B satırını **göremez/yazamaz** (11 tablo).
- **RLS pozitif:** her rol kendi izinli satırını görür (membership/team/settings).
- **memberships:** org başına ikinci aktif membership reddi (unique, AD2); employee başka kullanıcının rolünü değiştiremez.
- **role_permissions / authz (AD1):** manipüle edilmiş JWT claim yetki kazandırmaz (authz DB'den); Manager izin eşlemesi değiştiremez.
- **support (D4):** grant **yokken** tenant verisine erişim reddi; grant **varken** read + her erişim audit üretir; **süresi dolmuş** grant erişim vermez.
- **audit_logs (SI-2 türevi):** audit satırı UPDATE/DELETE reddi; RBAC/membership mutasyonu audit üretir.
- **helper testleri:** `current_org` doğru org; `has_role`/`has_permission` DB lookup; `manages_team` yalnız kendi takım; `has_support_grant` süre duyarlı.
- **recursive RLS (§7A, bloklayıcı):** helper çağrısı özyineleme/stack hatası üretmez; `memberships`
  non-recursive base policy ile kullanıcı yalnız kendi self-row'unu okur; FORCE RLS altında helper beklenen satırlara erişir.
- **global/catalog tablolar (§8A):** `profiles` org-column'suz own-profile + same-org-via-membership görünür;
  `roles`/`permissions`/`role_permissions` catalog read herkese, write yalnız Owner/Admin; catalog tablolarda spurious org filtresi beklenmez.
- **service role (SI-11):** service role anahtarı client bundle'ında yok (statik tarama) — *(bu kontrol uygulama dilimiyle birlikte; 3A'da en azından secret yönetimi doğrulanır)*.
- **constraint negatif:** unique/check ihlalleri reddedilir (slug, settings 1-1, expires_at, is_primary tekliği).

> Auditor read-only ve "manager kendi görevini approve edemez" gibi task/dispute'a bağlı testler 3A kapsamı
> **dışıdır** (ilgili tablolar yok); ilgili dilimde gelir.

## 12. Step-by-step implementation order

Sıra, güvenlik temelinin doğru katmanlanması için bağlayıcıdır:

1. **Yerel ortam:** Supabase dev/staging yapılandırması (`config.toml`); prod bağlantısı **yok** (ADR-014).
2. **Uzantılar + ortak yardımcılar:** gerekli uzantılar + `updated_at` trigger fonksiyonu (henüz RLS yok).
3. **Çekirdek kimlik:** organizations → organization_settings → profiles (FK sırası).
4. **RBAC:** roles → permissions → role_permissions → memberships (authz kaynağı kurulur).
5. **Takımlar:** teams → team_memberships (primary_team kuralı — AD9).
6. **Support + audit:** support_access_grants → audit_logs (iskelet, append-only).
7. **RLS helper'ları (migration 0006):** `current_org`, `has_role`, `has_permission`, `manages_team`,
   `has_support_grant` (SECURITY DEFINER + **fixed search_path**; `memberships` için **non-recursive base
   policy** + opsiyonel **BYPASSRLS owner rolü** — bkz. **§7A**). Recursive RLS riski burada kesinleşir.
8. **RLS aç + policy (migration 0007):** 11 tabloda RLS ENABLED + FORCE; doc 15 intent'leri uygulanır;
   **tenant-scoped vs global/catalog ayrımı (§8A)** policy yazımında esas alınır.
9. **Seed:** 2 test tenant + roller/izinler/membership/team/support/audit (deterministic ID'ler).
10. **Testler:** §11 suite; **cross-tenant + authz (AD1) + support + append-only bloklayıcı** geçmeden dilim "done" değil.
11. **Doğrulama:** after-coding checklist (CLAUDE.md); `get_advisors` (Supabase) RLS/security uyarıları taranır.

## 13. Acceptance criteria

- 11 tablonun tamamında RLS **ENABLED + FORCE**; RLS'siz tablo yok (SI-6).
- Her policy `organization_id = current_org()` ile başlar; cross-tenant negatif suite **yeşil** (SI-7).
- Rol/izin yalnız DB'den okunuyor; JWT claim authz için kullanılmıyor; AD1 testi geçer.
- Her membership tek primary_role (AD2); her employee tek primary_team (AD9) — constraint + test ile kanıtlı.
- Support yalnız aktif grant ile erişiyor; grant-yok/ süresi-dolmuş erişim reddediliyor; her erişim audit'leniyor (D4).
- audit_logs append-only (UPDATE/DELETE reddi); RBAC/membership mutasyonları audit üretiyor.
- Helper fonksiyonları `SECURITY DEFINER` + sabit search_path; `memberships` non-recursive base policy
  ile **recursive RLS döngüsü yok** (§7A testi yeşil).
- Global/catalog tablolar (`profiles`/`roles`/`permissions`/`role_permissions`) `organization_id` **taşımıyor**;
  RLS'leri §8A'ya uygun (catalog read + sınırlı write; profiles membership-join) — spurious org filtresi yok.
- Service role anahtarı client'a sızmıyor (env-only); varsa BYPASSRLS owner rolü client/service role'dan ayrı.
- Seed deterministic; testler tekrar edilebilir; `get_advisors` kritik güvenlik uyarısı bırakmıyor.

## 14. Rollback considerations

- Her migration **geri-alınabilir** mantıkta planlanır (down/ters migration veya yeni düzeltici migration).
- Migration'lar yalnız dev/staging'e uygulanır; **prod'a dokunulmaz** (Supabase MCP prod yasak — ADR-014).
- Sıralı bağımlılık: RLS policy migration'ı (adım 8) helper'lardan (adım 7) sonra; geri alımda ters sıra
  (önce policy drop, sonra helper, sonra tablo).
- audit_logs append-only olduğundan rollback **veri silmez**; gerekirse şema geri alınır, üretilmiş audit kaydı
  test-tenant'a ait olduğu için dev/staging reset ile temizlenir (prod'da bu senaryo yok).
- Seed idempotent/temizlenebilir olmalı: `supabase db reset` ile yeniden üretilebilir.
- Her kritik tablo migration'ı için kısa rollback notu (geri alındığında bağımlı objeler) implementation sırasında yazılır.

## 15. Risks

- **Recursive RLS (yüksek dikkat):** `memberships` hem RLS-FORCE'a tabi hem `current_org()`/`has_role()`
  tarafından okunuyor. **`SECURITY DEFINER` tek başına yetmez** (FORCE altında definer da RLS'e tabidir) →
  çözüm: `memberships` **non-recursive base SELECT policy** (`profile_id = auth.uid()`, helper çağırmaz) +
  fixed `search_path` + opsiyonel **BYPASSRLS owner rolü** (client/service role'dan ayrı). Karar 0006'da,
  0007'den önce kesinleşir. **Bkz. §7A.**
- **Global/catalog tablo org-column hatası:** `profiles`/`roles`/`permissions`/`role_permissions`'a yanlışlıkla
  `organization_id` eklemek veya bunlara `organization_id = current_org()` policy yazmaya çalışmak → şema/policy
  hatası, lockout veya gereksiz coupling. Önlem: **§8A** tenant-scoped vs global/catalog ayrımı policy yazımından önce esas alınır.
- **Yanlış org filtresi:** bir policy'de org filtresi unutulursa cross-tenant sızıntı → RLS FORCE + zorunlu cross-tenant negatif test.
- **JWT'ye güven kayması:** authz'in yanlışlıkla claim'den okunması → AD1 testi + kod review guard.
- **Seed/test tenant'ın prod'a karışması:** ortam ayrımı net; prod bağlantısı yok; deterministic test-only ID'ler.
- **Helper search_path:** sabitlenmezse güvenlik açığı → tüm SECURITY DEFINER fonksiyonlarında sabit search_path.
- **audit iskeletinin eksik kalması:** sonraki dilimlerde comp maskeleme (AD3) eklenirken şema uyumlu olmalı → alanlar baştan AD3-uyumlu tasarlanır (before/after + is_sensitive).
- **Kapsam kayması:** task/scoring/bonus tablolarına erken dokunma riski → bu plan out-of-scope listesi bağlayıcı.

## 16. Pre-implementation checklist

Implementation **başlamadan** (yetki verildikten sonra) doğrulanacak:

1. [ ] Tam yetki cümlesi (§17) kullanıcı tarafından **birebir** yazıldı mı? (faz-sınırlı — ADR-020)
2. [ ] §4'teki kaynak dokümanlar okundu mu? (Decision Lock AD1/AD2/D4 dahil)
3. [ ] Hedef ortam dev/staging mı? Prod bağlantısı kapalı mı? (Supabase MCP prod yasak)
4. [ ] Bu dilimin out-of-scope listesi (task/scoring/bonus/comp/dispute/...) anlaşıldı mı?
5. [ ] RLS + audit + (henüz ledger yok) etkisi düşünüldü mü?
6. [ ] §11 test senaryoları (cross-tenant, AD1, support, append-only, constraint) belirlendi mi?
7. [ ] Service role secret'ı env-only; client'a sızmayacak şekilde mi yönetilecek?
8. [ ] Rollback/`db reset` yolu hazır mı?
9. [ ] **Recursive RLS (§7A):** `memberships` non-recursive base policy + fixed `search_path` (+ ops. BYPASSRLS owner rolü) tasarımı 0006'da, 0007'den önce doğrulandı mı?
10. [ ] **org_id exceptions (§8A):** tenant-scoped vs global/catalog tablo ayrımı netleşti mi? `profiles`/`roles`/`permissions`/`role_permissions`'a spurious `organization_id` eklenmeyeceği teyit edildi mi?

## 17. Exact authorization sentence required to start implementation

Phase 3A implementation'ı **yalnızca** kullanıcı aşağıdaki cümleyi **birebir** yazarsa başlar. Başka hiçbir
ifade (örn. "başla", "onaylıyorum", "go") yeterli değildir. İzin **yalnız bu faz** içindir; sonraki dilim/faz
yeni onay ister (ADR-020).

```txt
implementation authorized only for Phase 3A — Database Foundation & RBAC
```

> Bu cümle yazılana kadar: kod yok, SQL yok, migration yok, seed yok, test implementasyonu yok, config
> değişikliği yok. Bu doküman yalnızca plandır.
