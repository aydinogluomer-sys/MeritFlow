# ADR-013 — Modular Monolith vs Microservices

## Status
Accepted

## Context
MeritFlow birden çok domain içerir (auth, tasks, scoring, ledger, bonus, disputes, audit, anti-gaming).
Mikroservis erken benimseme; dağıtık transaction, operasyonel yük ve tutarlılık riskleri getirir.
Finansal doğruluk (ledger/snapshot) güçlü transactional garantiler ister.

## Decision
MVP **modular monolith** olarak kurulur: net domain klasörleri (auth, organizations, users, teams,
tasks, reviews, scoring, point-ledger, bonus-*, disputes, audit, anti-gaming, reports, admin),
tek deploy edilebilir uygulama, tek PostgreSQL. Servisleşme **V2+**; domain sınırları net tutularak
ileride ayrıştırma kolaylaştırılır.

## Alternatives considered
- Microservices (MVP): reddedildi (dağıtık tx, operasyonel maliyet, tutarlılık riski).
- Sınırsız monolith (modülsüz): reddedildi (sınır erozyonu; gelecekte ayrıştırma zorlaşır).

## Consequences
- Güçlü transactional bütünlük (ledger + audit aynı tx).
- Domain modülleri arası bağımlılık disiplinli tutulmalı (ileride ayrıştırma için).

## Risks
- Monolith zamanla coupling üretebilir → modül sınırları + import kuralları ile korunur.

## Implementation notes
- Domain klasör yapısı CLAUDE.md "Architecture rules" ile hizalı; Postgres source of truth (Redis V1 cache).

## Test implications
- Modüller arası sözleşmeler (servisleşmeye hazırlık) test edilebilir kalır; tx bütünlüğü testleri.
