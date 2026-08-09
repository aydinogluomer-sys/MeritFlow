# ADR-006 — Bonus Ledger and Calculation Snapshots

## Status

Accepted (Decision Lock AD7)

## Context

Prim, finansal sonuç doğurur; hesap dondurulmalı, açıklanabilir ve değiştirilemez kanıta dayanmalı.

## Decision

Bonus calculation sonucu **immutable `bonus_allocation_snapshot`** olarak saklanır; snapshot kullanılan
**tüm faktörleri** (role/team/eligibility/proration/cap basis/T_org) kaydeder (AD7). Para hareketleri
ayrı **`bonus_ledger`**'da (double-entry, ADR-017). Accrual yalnız approved snapshot'tan. Para yuvarlaması
kuruş + largest-remainder; `Σfinal + undistributed_remainder = pool` (D6, rounding policy buraya bağlı).

## Alternatives considered

- Snapshot'sız doğrudan hesap-ödeme: reddedildi (denetlenemez).
- Faktörleri snapshot dışında tutmak: reddedildi (recompute drift riski).

## Consequences

- Dönem sonucu yeniden üretilebilir/savunulabilir; dispute → yeni run + yeni snapshot.
- Eski snapshot korunur (immutability).

## Risks

- Snapshot şeması zenginliği → tasarım yükü; ama denetlenebilirlik için gerekli.

## Implementation notes

- `05_BONUS_ENGINE_SPEC §9` alan listesi; idempotency key ile çift run engeli.

## Test implications

- Snapshot immutable; faktörler kaydedilir (AD7); idempotent run; rounding determinizm; Σ invariant.
