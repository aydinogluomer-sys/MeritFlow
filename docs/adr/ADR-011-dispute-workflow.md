# ADR-011 — Dispute & Appeal Workflow

## Status
Accepted (Decision Lock D9)

## Context
Puan ve prim sonuçları çalışanı doğrudan etkiler; adil, izlenebilir ve açıklanabilir bir itiraz
mekanizması olmadan sistem hukuken/etik savunulamaz. Manager'ın kendi kararına final vermesi taraflılık
riski yaratır.

## Decision
Her puan/prim sonucu **dispute** edilebilir. Reviewer ataması **HR** tarafından yapılır; SLA **5 iş
günü**'dür. Manager kendi verdiği karara açılan dispute'ta **final decision maker olamaz** (bağımsız
reviewer/HR atanır). Dispute sonucu **audit log**'a yazılır ve açıklanabilir bir decision note içerir.
Sonuç etkileri:
- accepted (puan) → point ledger `dispute_adjustment` (delta) + audit,
- accepted (prim) → yeni `bonus_calculation_run` + yeni immutable snapshot (gerekirse bonus ledger
  reversal + yeni accrual; otomatik kesinti yok),
- rejected → değişiklik yok; gerekçeli not + audit.

## Alternatives considered
- Manager'ın kendi kararına final vermesi: reddedildi (taraflılık; D9 ihlali).
- SLA'sız serbest süreç: reddedildi (belirsizlik; eskalasyon yok).

## Consequences
- Şeffaf, izlenebilir itiraz; eski snapshot korunur (immutability), düzeltme yeni run ile.
- SLA aşımında HR'a eskalasyon (notification).

## Risks
- "İş günü" tanımı org tatil takvimine bağlı (OQ-DP-1) → MVP sabit hafta içi, takvim V1.
- Çoklu employee'yi etkileyen tek karar → toplu recalculation UX V1.

## Implementation notes
- `07_DISPUTE_WORKFLOW_SPEC` durum makinesi + atama kuralları; recalculation `05`/`06`'ya bağlı.

## Test implications
- Manager kendi reddine final veremez (kontrol + audit).
- accepted-puan → ledger adjustment; accepted-prim → yeni run + snapshot (eski korunur).
- SLA due_at hesabı + aşım eskalasyonu.
