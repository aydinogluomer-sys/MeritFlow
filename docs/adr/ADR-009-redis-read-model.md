# ADR-009 — Redis as Read-Model (Cache)

## Status
Proposed (MVP'de kapalı; V1)

## Context
Leaderboard/percentile, dashboard özetleri ve sık okunan agregatlar için düşük gecikme gerekebilir.
Redis (ör. Upstash, ZSET) hızlı read-model sağlar; ancak finansal/puan kaynağı olamaz.

## Decision
PostgreSQL **tek source of truth**'tur. Redis yalnız **cache / read-model** olarak, V1'de devreye
alınır (feature flag). Para ve puan hiçbir koşulda Redis'ten otoritatif okunmaz; Redis verisi her
zaman Postgres'ten türetilir ve yeniden üretilebilir (rebuild edilebilir).

## Alternatives considered
- Redis'i MVP'de zorunlu kılmak: reddedildi (gereksiz karmaşıklık; MVP ölçeği Postgres ile yeterli).
- Hiç cache kullanmamak (V1+): reddedildi (leaderboard/dashboard ölçeklenince gerekebilir).

## Consequences
- MVP basit kalır (yalnız Postgres).
- V1'de okuma performansı cache ile iyileştirilebilir; stale veri toleransı yalnız non-finansal alanlarda.

## Risks
- Cache invalidation karmaşıklığı → yalnız türetilebilir/yeniden üretilebilir veriler cache'lenir;
  finansal sonuç asla cache'ten servis edilmez.

## Implementation notes
- V1: read-model projeksiyonları (leaderboard ZSET, dashboard özetleri) job/event ile beslenir.
- Cache miss → Postgres fallback; kaynak tutarsızlığında Postgres kazanır.

## Test implications
- V1: cache rebuild testi (Redis boşalır → Postgres'ten yeniden üretilir; sonuç birebir).
- Finansal değerlerin cache'ten servis edilmediği testi.
