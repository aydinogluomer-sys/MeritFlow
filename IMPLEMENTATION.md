# MeritFlow — Implementation Status & TODO

> **Yaşayan durum/todo takip dosyası.** Detaylı "neden/nasıl" için kaynak: `docs/planning/` (00–18),
> `docs/adr/` (ADR-001…020), `CLAUDE.md`. Çelişki olursa `docs/planning/00_DECISION_LOCK.md` kazanır.
> Bu dosya **kod değildir**; yalnızca nerede olduğumuzu ve ne yapacağımızı izler.
> Son güncelleme: 2026-07-24 (bonus_pool_components + bonus_pool_eligibility runtime verified + committed + docs sync).

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
| Phase 3 bonus C/E | `bonus_pool_components` + `bonus_pool_eligibility` (MVP Safe Pro-Rata individual=1.0; same-org employee via memberships composite FK; AD9 primary_team is_primary; server-only eligibility writes; inputs immutable once parent pool leaves draft) | `migrations/0012`, `tests/0006` | ✅ **verified** | commit `8f74e8d`; 2026-07-24 |

**Runtime verification (2026-07-24, local dev stack, npx Supabase CLI 2.109.1):** `supabase db reset`
migrations **0001..0012** + seed temiz uyguladı; `supabase test db` → **Files=6, Tests=238, Result=PASS,
Failed=0** (`0001`·`0002`·`0003`·`0004`·`0005`·`0006` ok), iki temiz koşuda tekrar-üretildi. `db reset`'teki
storage-container "not ready" uyarısı **non-fatal**.

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

**App katmanı (Next.js/API/UI): ⬜ hiç başlanmadı** (repo'da `package.json` yok, sadece `supabase/`).

**✅ Doküman senkron güncel (2026-07-24):** `supabase/README.md`, `docs/planning/12`, `docs/planning/18`,
bu dosya — 0001..0012 + 3A/3B/comp/bonus-P/P/bonus-C/E verified durumunu yansıtıyor.

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
- [x] Docs/status sync (README + roadmap 12 + doc 18 + bu dosya).

### B. Kalan Phase 3 DB-foundation dilimleri (SQL-only, app gerektirmez)  ⛔ her biri ayrı yetki
> Her dilim = tablo(lar) + RLS ENABLE+FORCE + policy + bloklayıcı pgTAP + additive seed, **aynı dilimde**.
- [ ] **bonus_calculation_runs + bonus_allocations + bonus_allocation_snapshots** — **sıradaki önerilen dilim**: hesaplama iskeleti; run idempotency, allocation `pending_missing_cap_basis` (AD6), snapshot immutable (INV-6) + Σfinal+remainder=pool (INV-4). ⛔ henüz yetkili değil.
- [ ] **bonus_ledger** — double-entry money (Σdebit=Σcredit; accrual yalnız approved snapshot'tan — ADR-017).
- [ ] **disputes** + `dispute_events` (SLA/atama alanları, D9).
- [ ] **anti_gaming_flags** (+ `anomaly_baselines` iskeleti).
- [ ] **notifications**, **exports** (export snapshot olmadan üretilemez — AD6/SI-3).
- [ ] (Ops.) **projects**, **objectives** — minimal.

### C. App foundation (feature fazlarının ön koşulu)  ⛔/⬜
- [ ] **Next.js + TypeScript scaffold** — `package.json`, App Router, Server Actions, Zod, Tailwind + shadcn/ui, Supabase client (anon/server ayrımı, service-role env-only), Vitest + Playwright iskeleti, Sentry.
- [ ] Auth akışı (Supabase Auth) + org bağlamı (`current_org`) + RBAC okuması DB'den (AD1).

### D. Feature fazları (roadmap 4–10)  ⛔ her faz ayrı yetki
- [ ] **Phase 4 — Task & Review Core**: tasks ailesi tabloları (RLS'li) + submit→review + self-approval block + submission/revision history (AD4).
- [ ] **Phase 5 — Scoring Engine**: `04` motoru; approve→point_ledger (`task_approved` event + `task_id` + idempotency index bu fazda eklenir); timeliness=submitted_at (AD4); collaboration puanı etkilemez (AD5); breakdown.
- [ ] **Phase 6 — Bonus Engine**: `05` motoru; pro-rata + cap (compensation_records cap basis) + T_org(+top-up AD8) + kuruş/largest-remainder + Σ invariant + immutable snapshot; `09` worked example reproduce.
- [ ] **Phase 7 — Anti-Gaming & Disputes**: 5 deterministik kural (flag→review, no auto-punish) + dispute workflow (HR atama, 5 iş günü, manager final değil) + recalculation.
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

Phase 3 bonus_pool_components + bonus_pool_eligibility foundation **verified + committed + synced**. Sıradaki
mantıklı iş: **bonus_calculation_runs + bonus_allocations + bonus_allocation_snapshots** dilimi — hesaplama
iskeleti (run idempotency; allocation `pending_missing_cap_basis` — AD6; snapshot immutable — INV-6/AD7; ve
Σfinal + undistributed_remainder = pool — INV-4). Hesaplama **motoru** (final_points/pro-rata math) yine Phase
5–6'da; bu dilim yalnız container'ları + guarantee'leri kurar. **Henüz yetkili değil.** Başlatmak için yetki
cümlesi (örnek, tek dilim):

`implementation authorized only for Phase 3 — bonus_calculation_runs + bonus_allocations + bonus_allocation_snapshots (tables + RLS + tests)`

> Bu cümle gelene kadar hiçbir kod/migration/test yazılmaz; sonraki her dilim ayrı, faz-sınırlı yetki ister (ADR-020).
