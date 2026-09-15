# 07 — Dispute Workflow Spec

## Purpose

Çalışanların puan ve prim sonuçlarına adil, izlenebilir ve açıklanabilir biçimde itiraz edebilmesini
sağlayan dispute (itiraz/appeal) sistemini tanımlamak.

## Scope

- Kapsam: dispute türleri, durum makinesi, reviewer atama, SLA, karar sonrası ledger/recalculation etkileri.
- Kapsam dışı: gelişmiş çoklu-aşama appeal (V1+), dış arabuluculuk.

## Assumptions

- `Assumption:` Bir dispute tek bir hedefe bağlanır (task / point entry / allocation / clawback).
- `Assumption:` Dispute kanıtı (evidence) ekleme MVP'de basit dosya/not ile yapılır.

## Non-negotiable rules

- Her puan/prim sonucu dispute edilebilir.
- Dispute reviewer ataması **HR** tarafından yapılır (Decision Lock D9).
- SLA = **5 iş günü** (Decision Lock D9).
- Manager kendi verdiği karara açılan dispute'ta **final decision maker olamaz** (Decision Lock D9).
- Dispute sonucu **audit log**'a yazılır.
- Puan değişirse point ledger `dispute_adjustment`; prim değişirse yeni calculation run + snapshot.
- Karar **açıklanabilir** decision note içerir.

## Detailed specification

### Dispute türleri (context `00 §13`)

`task_points_too_low`, `unfair_rejection`, `quality_score_dispute`, `missing_task_credit`,
`bonus_calculation_dispute`, `manager_bias_report`, `anomaly_false_positive`, `system_error`,
`clawback_dispute`.

### Durum makinesi

```txt
open
 -> under_review            (HR reviewer atadı)
 -> needs_info -> under_review   (ek bilgi istendi)
 -> resolved(accepted)      (lehte; düzeltme uygulanır)
 -> resolved(rejected)      (aleyhte; gerekçe yazılır)
 -> closed
```

### Reviewer atama kuralları

- HR bir reviewer atar.
- Atanan reviewer, ihtilaf konusu kararın **sahibi olamaz** (örn. reddi yapan manager o reddin
  dispute'unda final karar veremez; bağımsız reviewer/HR atanır).
- `manager_bias_report` ve `clawback_dispute` türleri doğrudan HR'a eskale edilir.

### SLA

- Hedef çözüm süresi: 5 iş günü.
- SLA aşımında HR'a uyarı/eskalasyon (notification).
- SLA durumu dispute kaydında izlenir (opened_at, due_at, resolved_at).

### Karar sonrası etkiler

- **accepted (puan):** point ledger'a `dispute_adjustment` (delta) + audit.
- **accepted (prim):** etkilenen period için yeni `bonus_calculation_run` + yeni immutable snapshot;
  gerekiyorsa bonus ledger reversal + yeni accrual (otomatik kesinti yok; ödenmiş fazla için clawback workflow).
- **rejected:** değişiklik yok; gerekçeli decision note + audit.
- Her iki sonuçta employee'ye açıklanabilir bildirim.

### Attribution ayrımı — dispute vs monetary adjustment (D13)

Dispute kaynaklı finansal etki ile **governed monetary adjustment** (D13 / `ADR-021`) kaynaklı finansal etki
**ayrı provenance kaynaklarıdır**; "manual change" adı altında birleştirilmez. İki neden zinciri paraleldir:

```txt
Dispute → underlying basis correction → recalculation → dispute-attributed effect
Monetary Adjustment Request → HR+Finance approval → approved monetary basis → recalculation → adjustment-attributed effect
```

- Dispute attribution mevcut Phase 7-D yolundan gelir (dönem düzeyi `v_finance_dispute_recalc_money`, 0051);
  monetary-adjustment attribution ayrı bir `source_type` ile temsil edilir (`16` invariant'ları + Slice 6).
- Financial explainability her kaynağı ayrı satırda gösterebilmelidir; örn.:

  ```txt
  Base entitlement            ₺20.000
  Dispute D-192              +  ₺1.200
  Monetary Adjustment A-83   + ₺2.500
  -----------------------------------
  Final entitlement           ₺23.700
  ```

- Bir dispute'un para etkisi **her zaman** mevcut dispute→recalculation→snapshot yolundan geçer; bir monetary
  adjustment onayı **asla** doğrudan `bonus_ledger`'a yazmaz — ikisi de yalnız engine + snapshot üzerinden para
  üretir (tek para otoritesi korunur).

### Reopen

- `Assumption:` MVP'de resolved bir dispute aynı gerekçeyle yeniden açılamaz; yeni kanıtla HR onayıyla
  yeni dispute açılabilir.

## Edge cases

- Period kapanmış/exported iken gelen dispute: yeni run + snapshot; ödenmişse clawback/ek ödeme akışı.
- Disputed task arşivlenmiş: kayıt korunur, dispute açılabilir.
- Aynı sonuç için birden çok employee dispute (bonus_calculation_dispute): HR toplu inceleyebilir
  (`Assumption:` MVP'de ayrı ayrı kayıt, ortak karar notu).
- Reviewer dispute süresince ayrılırsa: HR yeniden atar.

## Acceptance criteria

- Dispute uçtan uca açılıp çözülebiliyor; her durum geçişi izleniyor.
- Manager kendi kararına final veremiyor (kontrol + audit).
- accepted-puan → ledger adjustment; accepted-prim → yeni snapshot.
- Tüm kararlar audit'li ve açıklanabilir.
- SLA izleniyor; aşım eskalasyonu üretiliyor.

## Test implications

- E2E: employee dispute açar → HR reviewer atar → karar → (accepted) ledger adjustment / yeni snapshot.
- Kontrol testi: manager kendi reddine final karar veremez.
- Recalculation testi: prim dispute accepted → yeni run + snapshot, eski snapshot korunur.
- SLA testi: due_at hesaplanır; aşımda eskalasyon.

## Open questions

- OQ-DP-1: "iş günü" tanımı org takvimi/tatillerine göre mi? (Öneri: MVP'de sabit hafta içi; tatil takvimi V1.)
- OQ-DP-2: Çoklu employee'yi etkileyen tek karar için toplu recalculation UI gerekli mi? (Öneri: V1.)
- OQ-DP-3: Bağımsız reviewer havuzu nasıl tanımlanır (hangi roller uygun)? (Öneri: HR + başka takım manager'ı.)
