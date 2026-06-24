# ADR-003 — Multi-Tenant Architecture

## Status
Accepted

## Context
SaaS birden çok organizasyona hizmet eder; veriler kesin izole olmalı. Bir kullanıcı birden çok org'da
farklı role sahip olabilir.

## Decision
Tek veritabanı, shared-schema, **`organization_id` ile satır seviyesinde izolasyon** + RLS. Kullanıcı-org
ilişkisi `memberships`'te; her membership tek `primary_role` (AD2). Tüm sorgular org bağlamına göre filtrelenir.

## Alternatives considered
- DB-per-tenant: reddedildi (MVP'de operasyonel maliyet).
- Schema-per-tenant: reddedildi (migration/ölçek karmaşıklığı).

## Consequences
- Her tablo `organization_id` taşır; her policy org filtresi içerir.
- Cross-tenant test zorunlu.

## Risks
- Tek satırda org filtresi unutulursa sızıntı → RLS FORCE + testlerle bloklanır.

## Implementation notes
- `current_org()` helper; org değişimi explicit + audit; tek aktif org/oturum.

## Test implications
- Cross-tenant negatif suite (her tablo): A org → B org erişimi reddedilir.
