# ADR-010 — Anti-Gaming Strategy

## Status
Accepted (Decision Lock D5)

## Context
Puan→prim akışı manipülasyona açıktır (self-approval, görev parçalama, collusion, dönem sonu şişirme).
Gelişmiş anomaly (Z-score, graph/GNN collusion) güçlüdür ama MVP'de aşırı karmaşık ve false-positive
riskli; ayrıca otomatik ceza KVKK/GDPR otomatik-karar riskleri taşır.

## Decision
MVP'de **5 deterministik kural** uygulanır:
1. **self-approval block** (hard block; reviewer ≠ assignee),
2. duplicate task detection,
3. tiny-task splitting flag,
4. same-reviewer concentration flag,
5. period-end point spike flag.

Self-approval dışındaki kurallar yalnız **flag** üretir → review queue → (gerekirse) dispute. Otomatik
ceza **yok**; her finansal etki ayrı insan kararı + ledger entry + çalışanın dispute hakkı. Z-score,
graph collusion, GNN ve gelişmiş anomaly V1/V2'ye ertelenir.

## Alternatives considered
- Otomatik ceza/kesinti: reddedildi (otomatik karar riski; itiraz hakkını zedeler).
- MVP'de gelişmiş ML anomaly: reddedildi (false-positive, açıklanamazlık, karmaşıklık).

## Consequences
- Tespit deterministik ve açıklanabilir; karar her zaman insanda (human-in-the-loop).
- Self-approval DB + uygulama katmanında engellenir (flag değil, blok).

## Risks
- Eşik kalibrasyonu yanlışsa false-positive → eşikler configurable; flag ceza değil.
- Küçük org'da same-reviewer doğal → org boyutu istisnası.

## Implementation notes
- `08_ANTI_GAMING_MVP_SPEC` kuralları + eşikler; flag yaşam döngüsü open→reviewing→confirmed|dismissed.

## Test implications
- Self-approval reddi (hard); her kural için pozitif/negatif test.
- "Confirmed flag otomatik ceza üretmez" testi; false-positive senaryosu.
