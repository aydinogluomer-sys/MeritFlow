# ADR-001 — Safe Pro-Rata as Default Bonus Model

## Status
Accepted (Decision Lock D1)

## Context
Prim dağıtımı için saf winner-takes-all turnuva modeli; discouragement effect, sabotage, collusion ve
hukuki/etik riskler taşır. MVP'nin adil, açıklanabilir ve savunulabilir olması gerekir.

## Decision
Default ve MVP'de **tek** prim modeli **Safe Pro-Rata** olacaktır: tek havuz, `W_individual = 1.0`,
`bonus_i = min(cap_i, distributable_pool * adjusted_i / Σadjusted)`. Hybrid/Winner/Tournament modelleri
tasarlanır ama MVP'de kapalıdır (flag-gated, V1+).

## Alternatives considered
- Pure tournament (winner-takes-all): reddedildi (risk).
- Hybrid team reserve'i MVP default yapmak: ertelendi (karmaşıklık) — bkz. ADR-002.

## Consequences
- Her eligible çalışan onaylı normalize puanına göre pay alır; psikolojik baskı azalır.
- Cap, kalite barajı, dönem kilidi, itiraz zorunlu.
- Diğer modeller sonradan parametrik açılabilir.

## Risks
- Pro-rata "herkes alır" algısı performans baskısını azaltabilir → cap + kalite barajı + role normalization ile dengelenir.

## Implementation notes
- `05_BONUS_ENGINE_SPEC` formülü; W_individual=1.0 sabit; model seçimi org settings policy (V1).

## Test implications
- Worked example (`09`) reproduce; Σ invariant; pure tournament default DEĞİL testi.
