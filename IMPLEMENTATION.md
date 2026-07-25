# MeritFlow — Implementation Status & TODO

> **Yaşayan durum/todo takip dosyası.** Detaylı "neden/nasıl" için kaynak: `docs/planning/` (00–18),
> `docs/adr/` (ADR-001…020), `CLAUDE.md`. Çelişki olursa `docs/planning/00_DECISION_LOCK.md` kazanır.
> Bu dosya **kod değildir**; yalnızca nerede olduğumuzu ve ne yapacağımızı izler.
> Son güncelleme: 2026-07-24 (Phase 3B-A/3B-B runtime verified + docs sync).

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
| Phase 3B-A | `scoring_policies` + `scoring_policy_versions` (published immutable AD7, composite same-org FK) + RLS + `policy.manage` | `migrations/0008`, `tests/0002` | ✅ **verified** | commit `dd9b861`; 2026-07-24 |
| Phase 3B-B | `point_ledger` (append-only, server-only writes, Finance excluded) + `team_of()` + RLS | `migrations/0009`, `tests/0003` | ✅ **verified** | commit `f46ab49`; 2026-07-24 |

**Runtime verification (2026-07-24, local dev stack, npx Supabase CLI 2.109.1):** `supabase db reset`
migrations **0001..0009** + seed temiz uyguladı; `supabase test db` → **Files=3, Tests=97, Result=PASS,
Failed=0** (`0001` ok · `0002` ok · `0003` ok), iki temiz koşuda tekrar-üretildi. `db reset` sırasındaki
storage-container "not ready" uyarısı **non-fatal** (DB/migration/seed defekti değil).

**App katmanı (Next.js/API/UI): ⬜ hiç başlanmadı** (repo'da `package.json` yok, sadece `supabase/`).

**✅ Doküman senkron tamamlandı (2026-07-24):** `supabase/README.md` (0001..0009 + 3B verified),
`docs/planning/12`, `docs/planning/18` (§1 status + banner + Rev 4) ve bu dosya gerçek durumu yansıtıyor.

---

## 2. Nereye gideceğiz (roadmap hatırlatma)

`docs/planning/12` fazları: **Phase 3 (DB/ledger foundation) → 4 (task/review) → 5 (scoring engine)
→ 6 (bonus engine) → 7 (anti-gaming+dispute) → 8 (dashboards/UX) → 9 (test/security) → 10 (prod)**.
Kural: güvenlik temeli (RLS/ledger) bitmeden feature fazı ilerlemez.

---

## 3. Ne yapmalıyız (todolist)

### A. Phase 3B (scoring/ledger foundation)  ✅ verified + synced
- [x] **3B-A — Scoring policy tables + RLS + tests** ✅ (commit `dd9b861`, verified 2026-07-24).
- [x] **3B-B — Point ledger + `team_of` + append-only RLS + tests** ✅ (commit `f46ab49`, verified 2026-07-24).
- [x] **Runtime doğrulama** — `db reset` (0001..0009) + `test db` = Files=3/Tests=97/PASS/Failed=0.
- [x] **3B-D — Docs/status sync** ✅ (README + roadmap 12 + doc 18 + bu dosya, 2026-07-24).
- Not: 3B-C (seed expansion + pgTAP hardening) 3B-A/3B-B içinde kapsandı — seed 3B blokları + 97 assertion yeşil.

### B. Kalan Phase 3 DB-foundation dilimleri (SQL-only, app gerektirmez)  ⛔ her biri ayrı yetki
> Her dilim = tablo(lar) + RLS ENABLE+FORCE + policy + bloklayıcı pgTAP + additive seed, **aynı dilimde**.
- [ ] **compensation_records + comp audit maskeleme** (AD3, AD6, D7) — **sıradaki önerilen dilim**; bonus cap kaynağı, en hassas tablo; employee göremez; HR/Finance min; masked summary + gerekçeli raw. ⛔ henüz yetkili değil.
- [ ] **Bonus foundation** — `bonus_periods`, `bonus_pools`, `bonus_pool_components`, `bonus_pool_eligibility`, `bonus_calculation_runs`, `bonus_allocations`, `bonus_allocation_snapshots` (immutable), `bonus_ledger` (double-entry). Pool-lock (AD10), snapshot faktörleri (AD7), `pending_missing_cap_basis` (AD6).
- [ ] **disputes** + `dispute_events` (SLA/atama alanları, D9).
- [ ] **anti_gaming_flags** (+ `anomaly_baselines` iskeleti).
- [ ] **notifications**, **exports** — temel tablolar + RLS.
- [ ] (Ops.) **projects**, **objectives** — minimal.

### C. App foundation (feature fazlarının ön koşulu)  ⛔/⬜
- [ ] **Next.js + TypeScript scaffold** — `package.json`, App Router, Server Actions, Zod, Tailwind + shadcn/ui, Supabase client (anon/server ayrımı, service-role env-only), Vitest + Playwright iskeleti, Sentry.
- [ ] Auth akışı (Supabase Auth) + org bağlamı (`current_org`) + RBAC okuması DB'den (AD1).

### D. Feature fazları (roadmap 4–10)  ⛔ her faz ayrı yetki
- [ ] **Phase 4 — Task & Review Core**: tasks ailesi tabloları (RLS'li) + submit→review + self-approval block + submission/revision history (AD4).
- [ ] **Phase 5 — Scoring Engine**: `04` motoru; approve→point_ledger (`task_approved` event + `task_id` + idempotency index bu fazda eklenir); timeliness=submitted_at (AD4); collaboration puanı etkilemez (AD5); breakdown.
- [ ] **Phase 6 — Bonus Engine**: `05` motoru; pro-rata + cap + T_org(+top-up AD8) + kuruş/largest-remainder + Σ invariant + immutable snapshot; `09` worked example reproduce.
- [ ] **Phase 7 — Anti-Gaming & Disputes**: 5 deterministik kural (flag→review, no auto-punish) + dispute workflow (HR atama, 5 iş günü, manager final değil) + recalculation.
- [ ] **Phase 8 — Dashboards & UX**: 5 rol ekranı + 2 leaderboard görünümü; her puan/prim açıklanabilir; estimated/final ayrımı.
- [ ] **Phase 9 — Testing & Security**: tam suite; cross-tenant + self-approval bloklayıcı; AD1–AD10 testleri; audit coverage.
- [ ] **Phase 10 — Production Readiness**: monitoring, audit export, deploy checklist, support access workflow.

---

## 4. Kalıcı hatırlatmalar / riskler

- Puan client'tan gelmez; point ledger append-only; düzeltme = reversal (ADR-005).
- Bonus snapshot olmadan payout/export yok; snapshot immutable (ADR-006).
- Malus/clawback = approval workflow, otomatik kesinti yok (D2).
- `compensation_records` employee'den gizli; erişim audit'li (D7/AD3).
- Primary team tek kaynak: `team_memberships.is_primary` — `memberships.primary_team_id` **eklenmez** (AD9).
- KVKK / Türkiye iş hukuku = legal-review item (uzman onayı; kesin hüküm verilmez).

---

## 5. Önerilen ilk adım

Phase 3B foundation **verified + synced**. Sıradaki mantıklı iş: **`compensation_records` + comp audit
masking** dilimi (bonus engine'in cap kaynağı, en hassas tablo — izole ve erken kurmak en güvenli).
**Henüz yetkili değil.** Başlatmak için yetki cümlesi:

`implementation authorized only for Phase 3 — compensation_records + comp audit (table + RLS + tests)`

> Bu cümle gelene kadar hiçbir kod/migration/test yazılmaz; sonraki her dilim ayrı, faz-sınırlı yetki ister (ADR-020).
