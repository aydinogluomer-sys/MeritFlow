# ADR-017 — Double-Entry Money Ledger

## Status

Accepted

## Context

Para; korunan (conserved) bir büyüklüktür ve mutabakat (reconciliation) gerektirir. Tek-giriş veya
mutable toplam alanlar; yanlış/eksik ödeme, sessiz değişim ve denetlenemezlik üretir. Puan ise
kazanılır (transfer edilmez), farklı semantiğe sahiptir.

## Decision

- **Para** hareketleri **double-entry `bonus_ledger`**'da tutulur: her hareket dengeli (`entry_type`
  debit/credit), hesaplar `pool` / `accrual` / `payout` / `clawback`. Her calculation run için
  **Σdebit = Σcredit**.
- **Puan** ayrı **single-entry append-only `point_ledger`**'da (ADR-005); para ile **karıştırılmaz**.
- Para her zaman integer **minor unit (kuruş)** + `currency` ile saklanır.
- Accrual yalnız **approved snapshot**'tan üretilir; düzeltme = **reversal** (satır silinmez/güncellenmez).
- Her money mutation bir **audit_log** üretir.

## Alternatives considered

- Para için single-entry: reddedildi (mutabakat/denge garantisi yok).
- Float/decimal para: reddedildi (yuvarlama hataları; kuruş integer zorunlu).
- Puan + parayı tek ledger'da birleştirmek: reddedildi (farklı semantik; karışıklık riski).

## Consequences

- Her dönem finansal olarak mutabık ve denetlenebilir; yanlış ödeme dengesizlik olarak yakalanır.
- Reversal kalıbı geçmişi korur (immutability).

## Risks

- Double-entry disiplini geliştirici hatasına açık → hesap kuralları + denge invariant testleri.

## Implementation notes

- `06_LEDGER_AUDIT_SPEC §2` hesaplar + dengeli hareket tablosu; idempotency `snapshot_id` ile.
- Bkz. ADR-005 (point ledger), ADR-006 (snapshot), ADR-018 (cap basis → export gate).

## Test implications

- Her run Σdebit=Σcredit; accrual yalnız approved snapshot'tan (idempotent).
- payout ≤ accrual; reversal orijinali korur; her money mutation audit üretir.
