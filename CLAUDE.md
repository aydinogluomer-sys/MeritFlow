# CLAUDE.md — MeritFlow

MeritFlow, gamified görev takibi → puan → dönemsel prim akışını şeffaf, denetlenebilir ve adil
kılan bir HR-tech / ICM SaaS'ıdır. Bu dosya, bu repoda çalışan her ajan/insan için bağlayıcı
çalışma kurallarını içerir.

## Project mission

Çalışanların görev/performansını şeffaf takip eden; onaylanmış işten puan kazandıran; dönem sonunda
açıklanabilir ve itiraz edilebilir prim dağıtan; çalışanı gözetlemeyen, hukuken savunulabilir bir sistem.

## Source of truth & döküman önceliği

1. `/docs/planning/00_DECISION_LOCK.md` — kilitli kararlar (D1–D12 + AD1–AD10). **Her şeyin üstündedir.**
2. `/docs/context/` — 13 context dosyası (ürün kaynağı).
3. `/docs/planning/` — spec'ler (PRD, domain, RLS, scoring, bonus, ledger/audit, dispute, anti-gaming, UX, test, roadmap).
4. `/docs/adr/` — ADR-001…020.
- Çelişki olursa Decision Lock kazanır.
- PDF kullanılmaz; aranmaz; gap/open-question sayılmaz.

## Non-negotiable rules (forbidden actions dahil)

- **Implementation yalnız kullanıcı tam olarak `implementation authorized` dediğinde başlar.**
- **İzin verilse bile, izin faz-sınırlı kabul edilir** (yalnız o faz için; sonraki faz yeni onay ister).
- **Kod yazmadan önce ilgili planning dokümanı ve ADR okunur.**
- **RLS'siz tablo yok** (her tabloda RLS ENABLED + FORCE, `organization_id = current_org()`).
- **Client-side authorization / JWT claim source of truth değildir**; rol/izin DB'den okunur, authz server-side + RLS.
- **Point ledger silinmez/güncellenmez**; düzeltme yalnız reversal/adjustment entry.
- **Bonus snapshot olmadan payout/export yok**; allocation immutable snapshot'tan üretilir.
- **Employee monitoring/surveillance yasak** (ekran/mouse/konum/kamera/mikrofon/keystroke yok).
- **Pure tournament default olamaz** (default = Safe Pro-Rata).
- **Production database'e MCP ile dokunulmaz** (Supabase MCP yalnız staging/dev).
- **Service role client'a sızdırılmaz** (env secret; client bundle'a girmez; loglanmaz).
- **Her kritik mutation audit log ister** (manual adjustment, bonus approval, dispute decision, payout export,
  role/permission change, policy change, period lock/unlock, calculation run, support access, comp access/change).
- Ek yasaklar: mutable `total_points` source-of-truth yapmak; period lock sonrası silent mutation; otomatik
  clawback kesintisi; quality=poor'u approve etmek; public-shaming leaderboard; testsiz business-logic merge.

## Stack

Next.js (App Router) + TypeScript · Supabase (Auth/PostgreSQL/RLS) · Server Actions + Zod · Tailwind +
shadcn/ui · TanStack Table · Recharts · Vitest + Playwright · GitHub Actions · Vercel · Sentry.
Optional (V1): Upstash Redis (read-model), Inngest/Trigger.dev (jobs). MVP = modular monolith.

## Architecture rules

- Modular monolith; domain klasörleri (auth, organizations, users, teams, tasks, reviews, scoring,
  point-ledger, bonus-*, disputes, audit, anti-gaming, reports, admin). Servisleşme V2+.
- PostgreSQL source of truth; Redis yalnız cache/read-model (finansal kaynak olamaz).

## Database & RLS rules

- Her tablo `organization_id` + RLS. Helper'lar `SECURITY DEFINER` + sabit search_path.
- Finance: ham task/point/comp görmez → dedicated `v_finance_*` view (kolon kısıtı).
- `compensation_records` comp-sensitive: yalnız HR/Finance min yetki; employee göremez; erişim audit'li (AD3).
- Cross-tenant negatif testleri bloklayıcı.

## Scoring rules

- Server-side, approved-only, deterministik, kilitli policy version (AD7).
- `final_points = base * complexity * impact * quality * timeliness * (1 - revision_penalty)`.
- Timeliness `submitted_at`'e göre; geç onay cezalandırmaz (AD4). Collaboration puanı etkilemez (AD5).
- quality=poor approve edilemez (D3). Manual override = reason + audit + ayrı entry.

## Bonus calculation rules

- Default Safe Pro-Rata, tek havuz, W_individual=1.0 (D1). `bonus_i = min(cap_i, distributable * adj_i / Σadj)`.
- Kuruş bazlı + largest-remainder (tie-break employee_id). Σfinal + undistributed_remainder = pool.
- T_org policy-locked; 1.2 top-up onayı olmadan pool'u aşamaz (AD8). Cap residual undistributed (D6).
- Cap basis yoksa `pending_missing_cap_basis`, export bloklanır, unlimited cap yok (AD6).
- Eligibility ≥ 15 gün; proration cap üzerinde (D10). primary_team ile değerlendirme (AD9).

## Ledger rules

- Point ledger: single-entry, append-only. Bonus ledger: double-entry (Σdebit=Σcredit), money.
- Karıştırma yok. Düzeltme = reversal. Accrual yalnız approved snapshot'tan.

## Audit rules

- Append-only; silme yok. Comp audit: liste masked summary; raw payload yetki+gerekçe ile; erişim audit'li (AD3).

## Anti-gaming rules

- MVP'de 5 deterministik kural (self-approval block + duplicate + tiny-split + same-reviewer + period-end spike).
- Flag → review → dispute. Otomatik ceza yok (self-approval = hard block). Human-in-the-loop.

## Privacy / Legal / Ethical guardrails

- Data minimization, purpose limitation, role-based visibility, right to explanation, auditability.
- KVKK / Türkiye iş hukuku = **legal-review item** (kesin hukuki hüküm verilmez; uzman onayı gerekir).
- Prim "takdiri/koşullu" çerçevelenir; "estimated ≠ vested".

## UI/UX rules

- Premium, sakin, finance-grade; "neden bu puan/prim?" her zaman açıklanabilir.
- estimated/final ayrımı net; pending/approved/disputed ayrı; leaderboard privacy-first (2 görünüm).
- empty/loading/error state; WCAG 2.1 AA hedef.

## Testing rules

- Her Decision Lock kararı (D + AD) ≥1 teste bağlı. Cross-tenant + self-approval bloklayıcı.
- Business logic testsiz merge yok.

## MCP / tooling rules

- Min privilege. GitHub MCP read-only başlar. Supabase MCP prod yasak (staging/dev). Playwright yalnız E2E.
- Context7 tek kaynak değil. MCP secret/token audit'li.

## Before-coding checklist

1. `implementation authorized` verildi mi? Hangi faz için?
2. İlgili planning dokümanı + ADR okundu mu?
3. Decision Lock ile çelişki var mı?
4. RLS + audit + ledger etkisi düşünüldü mü?
5. Test senaryoları (`10`) belirlendi mi?

## After-coding checklist

1. RLS ENABLED+FORCE + cross-tenant test geçti mi?
2. Kritik mutation audit üretiyor mu?
3. Ledger append-only / snapshot immutable korunuyor mu?
4. Decision Lock kuralları ihlal edilmedi mi?
5. İlgili testler yazıldı ve geçti mi?

## Definition of Done

- Faz acceptance + test kriterleri yeşil; cross-tenant/self-approval bloklayıcı testler geçer; audit coverage
  tam; Decision Lock ihlali yok; doküman güncel. Aksi halde "done" değildir.
