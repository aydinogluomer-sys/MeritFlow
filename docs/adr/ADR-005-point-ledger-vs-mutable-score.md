# ADR-005 — Point Ledger vs Mutable Score

## Status
Accepted

## Context
Puan, primi etkileyen denetlenebilir bir büyüklüktür. Mutable `total_points` alanı; yarış, sessiz
değişim ve denetlenemezlik üretir.

## Decision
Puanlar **append-only, single-entry `point_ledger`**'da tutulur. Çalışan toplamı satırlardan türetilir
(cache değil source). Düzeltme = `reversal`/`adjustment` entry; UPDATE/DELETE yok. (Para tarafı ayrı —
ADR-017; puan tek-giriş yeterlidir çünkü transfer edilen değil kazanılan bir miktardır.)

## Alternatives considered
- Mutable total_points: reddedildi (denetlenemez, yarış).
- Puan için double-entry: gereksiz (transfer semantiği yok).

## Consequences
- Tam denetlenebilirlik; idempotent approve; dispute = yeni entry.
- Rounding/residual para tarafında ele alınır (ADR-006/019; D6).

## Risks
- Ledger büyümesi → period bazlı partition (OQ-LA-2, V1).

## Implementation notes
- `06_LEDGER_AUDIT_SPEC §1`; DB'de UPDATE/DELETE policy'si yok.

## Test implications
- Append-only testi; reversal testi; approve idempotency; toplam = Σdelta.
