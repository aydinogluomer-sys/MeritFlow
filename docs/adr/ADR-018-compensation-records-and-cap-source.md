# ADR-018 — compensation_records & Cap Source

## Status
Accepted (Decision Lock D7, D10, AD6)

## Context
Prim cap'i (`cap_i = cap_basis_i * cap_rate * proration_factor_i`) maaş gibi **compensation-sensitive**
bir tabana dayanır. Bu veri en hassas sınıftır; yanlış erişim ciddi gizlilik/hukuki ihlaldir. Ayrıca
cap basis eksikse sistemin davranışı belirsiz kalmamalıdır.

## Decision
- Ayrı **`compensation_records`** tablosu (comp-sensitive sınıf). En sıkı RLS: yalnız **HR/Finance
  minimum yetki** (`comp.read`); **employee göremez**, Manager/Auditor ham comp göremez. Her erişim
  audit'lenir (AD3, bkz. ADR-006).
- **Eligibility** (D10): dönemde aktif membership + en az **15 takvim günü** çalışma. **Proration** cap
  üzerinde uygulanır (puan prorate edilmez); `proration_factor_i = min(1, days_active / days_in_period)`.
- **Eksik cap basis (AD6):** aktif `compensation_records` veya geçerli absolute cap basis yoksa
  allocation `pending_missing_cap_basis` statüsüne alınır; sistem **sessizce unlimited cap uygulamaz**;
  HR/Finance tamamlamadan **final payout export oluşturulmaz**. Snapshot bu durumu kaydeder.

## Alternatives considered
- Maaşı genel kullanıcı tablosunda tutmak: reddedildi (gizlilik; en sıkı izolasyon gerekir).
- Cap basis yoksa unlimited cap: reddedildi (sessiz risk; AD6 ihlali).
- Eksik veride export'a devam: reddedildi (yanlış/savunulamaz ödeme).

## Consequences
- Compensation katmanı izole ve audit'li; finance bile ham maaşı view kısıtıyla görür (`03 §4`).
- Eksik veri akışı **fail-safe**: export bloklanır, durum görünür/açıklanabilir.

## Risks
- Comp erişim audit mekanizması (trigger vs server) implementation detayı (OQ-RLS-2) → Phase 3.
- İşten ayrılan çalışan final hesaplaşması legal-review item (D10).

## Implementation notes
- `03_PERMISSION_RLS_STRATEGY` comp RLS + Finance view; `05_BONUS_ENGINE_SPEC §5` eksik cap basis akışı.
- Bkz. ADR-006 (comp audit maskeleme), ADR-016 (privacy), ADR-007 (cap/residual ilişkisi).

## Test implications
- Employee comp göremez; HR/Finance min yetki; her erişim audit üretir (AD3).
- AD6: cap basis yok → `pending_missing_cap_basis`; payout export bloklanır; unlimited cap uygulanmaz.
- D10: 15 gün eşiği; proration cap üzerinde (puan prorate edilmez).
