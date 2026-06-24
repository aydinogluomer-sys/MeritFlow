# 11 — ADR Index

## Purpose

Mimari ve ürün kararlarının (Architecture Decision Records) dizinini, durumlarını ve özetlerini tek
yerde tutmak. Tam ADR metinleri `/docs/adr/ADR-XXX-*.md` altında tutulur; bu doküman indeks sağlar.

## Scope

- Kapsam: ADR listesi, durum, özet karar, Decision Lock bağlantısı.
- Kapsam dışı: tam ADR gövdeleri (ayrı dosyalarda, `/docs/adr/`).

## Assumptions

- ADR'ler `/docs/adr/` altında 20 dosya olarak tutulur (ADR-001 … ADR-020).

## Non-negotiable rules

- Decision Lock (D + AD) kararları ilgili ADR'lerde "Accepted" olarak yansıtılır; ADR Decision Lock ile çelişemez.
- Kabul edilmiş ADR değiştirilmez; yeni karar yeni ADR (superseded) ile yapılır.

## Detailed specification — ADR listesi (kanonik, `/docs/adr/` ile birebir)

| ADR | Başlık | Durum | Özet karar | Lock |
| --- | --- | --- | --- | --- |
| ADR-001 | Safe pro-rata default | Accepted | Default Safe Pro-Rata; pure tournament default-OFF; tek havuz W_individual=1.0 | D1 |
| ADR-002 | Hybrid team reserve | Proposed | Tasarlanır, MVP'de kapalı, flag-gated V1+ | D1 |
| ADR-003 | Multi-tenant architecture | Accepted | organization_id ile tam izolasyon | — |
| ADR-004 | Supabase RLS strategy | Accepted | RLS ENABLED+FORCE; membership anchor; rol/izin DB'den (AD1) | AD1/AD2 |
| ADR-005 | Point ledger vs mutable score | Accepted | Append-only single-entry point ledger; rounding/residual notu (D6) | D6 |
| ADR-006 | Bonus ledger & snapshots | Accepted | Double-entry money ledger + immutable snapshot (faktörleri kaydeder, AD7) | AD7 |
| ADR-007 | Zero Factor & malus/clawback | Accepted | T_org policy-locked + top-up (AD8); clawback approval workflow, no auto-deduct | D2/AD8 |
| ADR-008 | Leaderboard privacy model | Accepted | 2 görünüm, privacy-first, public-OFF | D12 |
| ADR-009 | Redis as read-model | Proposed | Postgres source of truth; Redis cache V1 | — |
| ADR-010 | Anti-gaming strategy | Accepted | MVP 5 deterministik kural; Z-score/graph V1+ | D5 |
| ADR-011 | Dispute & appeal workflow | Accepted | HR atama, 5 iş günü SLA, manager final değil | D9 |
| ADR-012 | Server-side authorization | Accepted | Client/JWT claim source of truth değil; DB+server enforce | AD1 |
| ADR-013 | Modular monolith vs microservices | Accepted | Modular monolith; servisleşme V2+ | — |
| ADR-014 | MCP/tooling security | Accepted | Min privilege; GitHub RO; Supabase MCP prod yasak | — |
| ADR-015 | Testing strategy | Accepted | Cross-tenant + self-approval bloklayıcı; lock→test eşleme | — |
| ADR-016 | Legal/privacy guardrails | Accepted | KVKK/iş hukuku legal-review item; surveillance yasak | D8 |
| ADR-017 | Double-entry money ledger | Accepted | Para double-entry, puan single-entry append-only | — |
| ADR-018 | compensation_records & cap source | Accepted | Ayrı comp tablo, en sıkı RLS, employee göremez; eligibility/proration (D10) | D7/D10/AD6 |
| ADR-019 | Phase-gate OQ resolution | Accepted | AD1–AD10 kararları (RLS/timeliness/collaboration/cap basis/T_org/multi-team/pool timing) | AD1–AD10 |
| ADR-020 | Implementation gate | Accepted | Kod yalnız `implementation authorized` ile; izin faz-sınırlı | — |

> Not: Rounding/residual politikası ADR-005/ADR-006 içinde; eligibility/proration ADR-018 içinde ele alınır
> (ayrı ADR dosyası yoktur; kanonik liste 20 ADR'dir).

## Edge cases

- Bir ADR Decision Lock ile çelişirse: ADR güncellenir, Lock değil.
- Proposed ADR'ler (002, 009) MVP'yi bağlamaz; yalnız yön gösterir.

## Acceptance criteria

- Her Decision Lock kararı (D + AD) bir Accepted ADR'ye bağlı.
- İndeks `/docs/adr/` altındaki 20 dosya ile birebir.

## Test implications

- ADR-015 test stratejisini (`10`) yönetir; ADR-004/012 RLS+authz testlerini zorunlu kılar.

## Open questions

- OQ-ADR-1: ADR-002 (Hybrid) ve ADR-009 (Redis) ne zaman Accepted'a geçer? (V1 planlamasında.)
