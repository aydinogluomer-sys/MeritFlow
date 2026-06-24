# ADR-002 — Hybrid Team Reserve Bonus Model

## Status
Proposed (Decision Lock D1 — MVP'de kapalı)

## Context
Kurumsal müşteriler bireysel + takım + kalite + winner overlay karışımı isteyebilir. Bu, rekabeti
dengeleyip işbirliğini ödüllendirir ama hesaplama ve UX karmaşıklığını artırır.

## Decision
Hybrid model **tasarlanır** (component weights: individual/team/quality/winner) ama MVP'de **devre dışı**.
V1'de feature flag + org policy ile açılır. Açıldığında her bileşen ayrı havuz olarak hesaplanır.

## Alternatives considered
- MVP'de Hybrid default: reddedildi (Safe Pro-Rata yeterli ve basit).
- Hiç desteklememek: reddedildi (kurumsal talep).

## Consequences
- Bonus engine parametrik tasarlanmalı (weights = 0 → Safe Pro-Rata).
- V1'de ek snapshot alanları (per-component).

## Risks
- Çok bileşen → açıklanabilirlik zorlaşır → breakdown UX yatırımı gerekir.

## Implementation notes
- Bonus engine'i baştan weight-aware kurgula; MVP'de W_individual=1.0, diğerleri 0.

## Test implications
- V1: per-component dağıtım + Σ invariant; MVP: weights=0 davranışı = Safe Pro-Rata.
