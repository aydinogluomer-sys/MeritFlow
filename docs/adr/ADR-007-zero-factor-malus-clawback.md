# ADR-007 — Zero Factor (T_org), Malus & Clawback

## Status
Accepted (Decision Lock D2, AD7, AD8)

## Context
Prim havuzu, kurumsal başarıya (Zero Factor `T_org`) bağlanmalı ve düşük performans/ihlal durumunda
düzeltme mümkün olmalı. Ancak otomatik kesinti; hukuki, etik ve güven riskleri taşır; "estimated"
bir tutarın sessizce eksiltilmesi savunulamaz.

## Decision
- `T_org` dönem başında policy ile set edilir, `locked` ile dondurulur ve calculation snapshot'a yazılır (AD7).
- `T_org ∈ {0, 0.5, 0.75, 1, 1.2}`; `distributable_pool = pool_amount * T_org`. `T_org = 1.2` onaylı
  pool'u **sessizce aşamaz**: hedef üstü dağıtım **Finance top-up approval** gerektirir; top-up yoksa
  dağıtılabilir tutar approved pool ile sınırlanır ve bonus breakdown'da açıklanır (AD8).
- Malus (`M_i`) adjusted score çarpanı **değildir** (D2); ceza/geri alım ayrı **clawback approval
  workflow**'u olarak modellenir. Otomatik kesinti **yok**.
- Clawback: `clawback_pending` → HR/Finance/Legal approval → `clawback_approved` + bonus ledger
  reversal entry + çalışana dispute hakkı.

## Alternatives considered
- `M_i`'yi çarpan olarak skora gömmek: reddedildi (otomatik ceza; itiraz edilemez; D2 ihlali).
- `T_org = 1.2`'yi koşulsuz uygulamak: reddedildi (pool'u sessizce aşar; finansal kontrol kaybı).

## Consequences
- Havuz kurumsal başarıya bağlı ama bütçe disiplini korunur (top-up gate).
- Her ceza insan onayı + ledger reversal + dispute ile izlenebilir/savunulabilir.
- Undistributed remainder (T_org < 1 kesintisi) snapshot'ta kalır (bkz. ADR-006, D6).

## Risks
- Top-up onayı operasyonel sürtünme ekler → net UX + audit ile yönetilir.
- Clawback algısı hassastır → "takdiri/koşullu" çerçeve + açıklanabilir breakdown.

## Implementation notes
- `05_BONUS_ENGINE_SPEC §4` (T_org + top-up), `06_LEDGER_AUDIT_SPEC §2` (clawback reversal).
- T_org değişimi audit; period lock sonrası silent change yasak (AD7).

## Test implications
- AD8: `T_org=1.2` + top-up yok → distributable = approved pool; top-up var → 1.2 uygulanır.
- D2: clawback approval olmadan kesinti yok; reversal entry üretir; dispute açılabilir.
- AD7: T_org snapshot'a kilitli; dönem ortası değişmez.
