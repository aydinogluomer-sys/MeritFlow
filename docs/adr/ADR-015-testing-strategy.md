# ADR-015 — Testing Strategy

## Status
Accepted

## Context
Sistem finansal sonuç (prim) ve hassas veri (compensation) içerir; güvenlik ve iş kurallarının
testle kanıtlanması zorunludur. Test edilmeyen business logic; sessiz regresyon ve hukuki risk üretir.

## Decision
- Her Decision Lock kararı (D1–D12 + AD1–AD10) **en az bir teste** bağlanır.
- **Cross-tenant** ve **self-approval** testleri **bloklayıcıdır**; geçmeden ilgili modül "done" değildir.
- **Business logic testsiz merge edilmez.**
- Test katmanları: business-logic, permission/RLS (gerçek Postgres üzerinde), anti-gaming, bonus
  calculation (worked example `09` reproduce), dispute, E2E (Playwright), security (RLS negatif suite +
  authz bypass + audit coverage + secret tarama).

## Alternatives considered
- Yalnız mutlu-yol testleri: reddedildi (negatif/güvenlik senaryoları kritik).
- RLS'i mock'lamak: reddedildi (RLS gerçek Postgres'te doğrulanmalı).

## Consequences
- Lock→test eşlemesi denetlenebilir kapsam sağlar; regresyon erken yakalanır.
- Release ancak bloklayıcı suite yeşilse mümkündür.

## Risks
- Test yükü geliştirmeyi yavaşlatabilir → kritik yollara öncelik; seed otomasyonu (OQ-TS-1).

## Implementation notes
- `10_TEST_STRATEGY` test envanteri; Vitest (unit/integration) + Playwright (E2E); RLS testleri staging/dev DB.

## Test implications
- Bu ADR test stratejisinin kendisini yönetir; ADR-004/ADR-012 RLS+authz testlerini, ADR-005/006/017
  ledger testlerini, ADR-018 comp erişim testlerini zorunlu kılar.
