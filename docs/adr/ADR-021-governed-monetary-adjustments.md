# ADR-021 — Governed Monetary Adjustments as Deterministic Calculation Inputs

## Status

Accepted (Decision Lock **D13**)

## Context

MeritFlow'un finansal çekirdeğinde bugüne kadar **bir insanın doğrudan prim parası yaratmasına izin veren
yaptırımlı (sanctioned) hiçbir primitif yoktu**. Tüm yetkili para hareketleri yalnız deterministik hesaplama
motorundan (`run_bonus_calculation`) çıkan immutable snapshot üzerinden, `SECURITY DEFINER` + server-only
RPC'lerle (`post_bonus_accrual`, `recalculate_bonus_after_dispute`, `mark_payout_paid`) üretilir; `bonus_ledger`
append-only'dir, RLS `ENABLE+FORCE`'tur ve doğrudan yazma imkânı yoktur. Bu **güvenliydi ama eksikti**: iş
gerçekliğinde HR/Finance'in bir çalışanın primini yönetişimli biçimde düzeltmesi gerekir (ör. gözden kaçan
katkı, hakem dışı bir ödül, hatalı bir taban). Mevcutta buna en yakın şey `point_ledger.manual_adjustment`'tır
— ama o **PUAN**'dır, para değil.

İki kavramı ayırmak zorunludur:

- **Manual point correction** (`point_ledger.manual_adjustment`): puan-domain düzeltmesi; pro-rata tabanını
  besler; bir sonraki calculation run üzerinden dolaylı olarak paraya dönüşür. Puan ≠ para.
- **Governed monetary adjustment** (bu ADR): açık bir **para** niyeti (₺, minor unit); yönetişimli talep +
  HR/Finance onayı ile immutable bir **financial-basis artifact** olur ve deterministik motora **girdi** olarak
  girer — ledger'a doğrudan yazılmaz.

Bu boşluğu **ikinci bir para otoritesi yaratmadan** kapatmak gerekir.

## Decision

```txt
Monetary adjustment  !=  ledger mutation
Monetary adjustment  ==  governed calculation basis (input)
```

Onaylı parasal düzeltme; puanlar, compensation basis, eligibility, policy version ve dispute düzeltmeleriyle
aynı düzlemde **yönetilen bir hesaplama girdisidir**. Tek yetkili para yolu korunur:

```txt
Governed Inputs → Deterministic Engine → Immutable Snapshot → Approved Posting → Append-only Ledger
```

Talep akışı iki aşamalıdır: **Adjustment Request** (draft → submitted → pending_hr → pending_finance →
approved) → onayda **immutable Approved Monetary Adjustment** artifact. Onay four-eyes'tır (ayrı HR ve Finance
kimliği; talep sahibi kendi talebini onaylayamaz; yeni parasal RPC'ler actor'ı `auth.uid()`'e bağlar). Onaylı
düzeltme immutable'dır; düzeltme yalnız compensating/reversal + gerekiyorsa replacement artifact'larla yapılır.
Detaylar `16` (state machine'ler + invariant'lar), `06` (ledger konumu), `12` (Slice planı).

## Rejected alternatives

### Alternatif A — Yönetici doğrudan `bonus_ledger` credit/debit

**Reddedildi:** ikinci bir para otoritesi yaratır (`Admin → +₺ → bonus_ledger`). Deterministik replay'i,
snapshot değişmezliğini ve tek-yol garantisini bozar; `bonus_ledger` append-only + RLS-force ilkesini deler.

### Alternatif B — `point_ledger.manual_adjustment`'ı yeniden kullan

**Reddedildi:** `points != money`. Puan primitifine `amount_minor` eklemek onu iki domain'de polimorfik yapar,
mevcut puan semantiğini sessizce değiştirir ve point/bonus ledger ayrımını (`06`) ihlal eder.

### Alternatif C — Snapshot'ı elle düzenle (mutable snapshot)

**Reddedildi:** snapshot immutable'dır (AD7 / SI-14 / ADR-006). Düzeltme yeni bir deterministik run + yeni
immutable snapshot üretir; eski snapshot korunur (superseded).

### Alternatif D — Ödenmiş/kapanmış dönemi yeniden aç ve tarihi yeniden yaz

**Reddedildi:** finansal tarih append-only/auditable kalmalıdır. Kapanmış dönem yeniden açılmaz; kapanış sonrası
düzeltme **additive correction settlement** ile temsil edilir (pozitif → correction ödemesi; negatif → governed
recovery-pending, **otomatik clawback yok — D2**).

### Alternatif E — LLM-üretilmiş düzeltme tutarları

**Reddedildi:** yetkili para mantığında LLM yer alamaz (§26). AI ileride yalnız açıklama/taslak/anomali yüzeyi
için yardımcı olabilir; tutarı seçemez, onaylayamaz, hesaplayamaz, ledger yazamaz, clawback'e karar veremez.

## Consequences

- Daha fazla yönetişim + durum: talep workflow'u, ayrı HR/Finance onayı, immutable artifact, funding
  authorization, correction settlement.
- Daha iyi auditability + deterministik replay: input manifest + input hash (Slice 3) ile aynı etkin girdi
  seti → aynı sonuç; `calculation_run_adjustments` ile bir run bir düzeltmeyi en çok bir kez içerir.
- Daha temiz müşteri açıklaması: snapshot decomposition + financial attribution "neden değişti?" sorusunu
  base / dispute / adjustment / cap / final olarak yanıtlar (requested basis ≠ approved basis ≠ realized effect
  ayrımıyla; matematiksel dürüstlük — clamp/funding sınırı gerçek etkiyi değiştirebilir).
- Güvenli kapanmış-dönem düzeltmesi: tarihsel gerçeğe dokunmadan additive correction settlement.
- Korunan kararlar: **D2** (otomatik kesinti yok), **AD6** (`pending_missing_cap_basis` export'u bloklar),
  **AD8** (T_org ≤ 1.2×; supplemental Finance authorization ister), **AD9**, **AD10** (pool-lock),
  **ADR-006** (human re-approval), **ADR-017** (double-entry Σdebit=Σcredit). D13 bunları geçersiz kılmaz;
  yeni yönetilen-girdi yolunu **yaptırımlı** hale getirir.

## Risks

- Yönetişim ek adımları hızı yavaşlatabilir → net state machine + roadmap Slice'ları (`12`) ile yönetilir.
- Nonlineer allocation etkileşiminde per-source realized attribution sıra-bağımlı olabilir → sahte sayı
  üretmek yerine basis katkısı ile net sonuç ayrı raporlanır (dürüstlük > cazip metrik).
- Kapsam sürünmesi riski → slice-per-branch + faz-sınırlı yetki (ADR-020); 1.2× ötesi fonlama ve harici
  payroll/bank mutabakatı **kapsam dışı gelecek ürün** olarak işaretlidir.

## Implementation notes

- Yeni permission'lar (`bonus.adjustment.request|approve_hr|approve_finance`) ve şema Slice 2'de iner; bu ADR
  (Slice 1) yalnız kararı sabitler.
- Attribution, mevcut Phase 7-D dispute attribution'ından (`v_finance_dispute_recalc_money`, 0051) **ayrı**
  tutulur (`07`); "manual change" adı altında birleştirilmez.
- Intelligence "Düzeltme Para Etkisi / Adjustment Money Impact" kartı (Slice 6) yalnız **gerçekleşen** para
  etkisinden beslenir (requested amount değil); role/RLS/veri yoksa honest-unavailable (asla uydurma 0).

## Test implications

- pgTAP negatifleri: cross-tenant (employee/period/adjustment), unauthorized request/HR/Finance, self-approval,
  aynı HR=Finance approver, sıfır/geçersiz tutar, eksik reason, geçersiz currency/period-state, fonlamasız
  supplemental, approved-artifact UPDATE/DELETE, duplicate approval/run-inclusion/correction, cross-tenant
  reversal, forbidden direct ledger mutation, cap-basis eksikken export bloğu, payout ≤ accrual, Σdebit=Σcredit.
- Determinizm: aynı etkin girdi seti + aynı diğer girdiler → aynı sonuç; input hash tekrar üretilebilir.
- E2E golden: açık-dönem düzeltme (C), sonraki alâkasız rerun düzeltmeyi korur (D), reversal (E), kapanmış
  dönem pozitif correction (F), kapanmış dönem negatif recovery-pending (G), dashboard (H).
