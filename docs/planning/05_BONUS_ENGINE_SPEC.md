# 05 — Bonus Engine Spec (DEEP)

## Purpose

Bir bonus period kilitlendiğinde, onaylanmış puanlardan **Safe Pro-Rata** modeliyle prim
tutarlarını deterministik, açıklanabilir, snapshot'lı ve para-güvenli (kuruş bazlı) şekilde
hesaplamayı tanımlamak.

## Scope

- Kapsam: adjusted score, pro-rata dağıtım, eligibility/proration, cap (+ eksik cap basis), T_org (Zero Factor + top-up),
  para yuvarlama, calculation run + immutable snapshot, idempotency.
- Kapsam dışı: Hybrid/Winner/Tournament modelleri (V1+, flag-gated), multi-team weighted factor (V1, AD9),
  clawback workflow detayı (`06`), scoring (`04`).

## Assumptions

- Bonus pool tutarı Finance tarafından dönem `open` iken girilir ve **period close/calculation öncesi kilitlenir** (Decision Lock AD10).
- `T_org` (Zero Factor) dönem başında HR/Finance tarafından set edilir ve `locked` ile dondurulur; snapshot'a yazılır (AD7).
- `Assumption:` cap_rate varsayılan 0.50; org settings ile değişir; değişiklik dönem başlamadan yapılır.
- `Assumption:` Para minor unit (kuruş) integer olarak hesaplanır; tüm bölmeler integer aritmetiği + largest-remainder ile kapatılır.
- Her employee her period için tek `primary_team` ile değerlendirilir (Decision Lock AD9).

## Non-negotiable rules

- Default model **Safe Pro-Rata**, tek havuz, `W_individual = 1.0` (Decision Lock D1).
- `M_i` (malus) adjusted score çarpanı **değildir** (Decision Lock D2).
- Hesap **kilitli** period + locked policy version + locked T_org + locked pool ile yapılır (AD7/AD10).
- Sonuç **immutable snapshot** olarak saklanır; snapshot kullanılan tüm faktörleri kaydeder (AD7); değişiklik = yeni run + yeni snapshot.
- Σ(allocations) ≤ pool amount; aşan dağıtım imkânsız. `T_org=1.2` approved pool'u **top-up onayı olmadan aşamaz** (AD8).
- Cap residual yeniden dağıtılmaz; `undistributed_remainder` snapshot'ta saklanır (Decision Lock D6).
- Geçerli cap basis yoksa allocation `pending_missing_cap_basis`; sistem **sessizce unlimited cap uygulamaz**; eksik tamamlanmadan final payout export yok (Decision Lock AD6).
- Σadjusted = 0 ise dağıtım yapılmaz; pool `undistributed`; HR/Finance manuel karar.

## Detailed specification

### 1. Eligibility (Decision Lock D10)
Bir çalışan dönemde **eligible** sayılır ⇔:
- dönem içinde aktif membership'i var, **ve**
- dönemde en az **15 takvim günü** çalışmış (active gün sayısı ≥ 15).

`eligibility_factor_i ∈ {0, 1}`; eligible değilse 0 → dağıtımdan çıkar. (Eligibility snapshot'a yazılır — AD7.)

### 2. Proration (basit, MVP)
- Dönem ortası giriş/çıkışta **cap** prorate edilir (adjusted score prorate **edilmez** — puan zaten
  yapılan gerçek işi yansıtır, yeniden indirim çifte ceza olur).
- `proration_factor_i = min(1, days_active_i / days_in_period)` (snapshot'a yazılır — AD7).
- `cap_i = cap_basis_i * cap_rate * proration_factor_i` (cap_basis = gross_salary; bkz. §5 eksik cap basis).
- İşten ayrılan çalışan: **legal-review item** (final hesaplaşma hukuki); MVP'de eligible ise normal
  hesaplanır, ödeme kararı HR/Finance + legal onayına bırakılır.

### 3. Adjusted score (malus YOK)
```txt
adjusted_score_i =
  approved_points_i
  * role_normalization_factor_i
  * quality_factor_i
  * team_factor_i            (primary_team üzerinden — AD9)
  * eligibility_factor_i
```
- `approved_points_i` = dönemde o çalışanın point ledger'ındaki onaylı kazanç toplamı (ledger'dan türetilir).
- role/quality/team faktörleri period başında kilitlenir ve snapshot'a yazılır (AD7).

### 4. T_org (Zero Factor) + top-up (AD8)
- `T_org ∈ {0, 0.5, 0.75, 1, 1.2}` (policy-defined, dönem başında kilitli, snapshot'a yazılır).
- `distributable_pool = pool_amount * T_org` — **ancak**:
  - T_org ≤ 1: `pool_amount * (1 - T_org)` kısmı `undistributed_remainder`'a eklenir.
  - **T_org = 1.2:** approved pool'u sessizce aşamaz (AD8). Hedef üstü dağıtım **Finance top-up approval** gerektirir.
    Top-up varsa `distributable_pool = pool_amount * 1.2` (top-up onaylı ek bütçe ile). Top-up yoksa
    `distributable_pool = pool_amount` ile sınırlanır ve durum breakdown'da açıklanır.
- T_org = 0 ise prim askıya alınır (distributable_pool = 0).
- T_org değişimi audit + HR/Finance onayı; dönem sonunda silent change yasak (AD7).

### 5. Eksik cap basis (Decision Lock AD6)
- `cap_basis_i` = aktif `compensation_records` veya geçerli absolute cap basis.
- Yoksa: allocation `pending_missing_cap_basis` statüsüne alınır; **unlimited cap uygulanmaz**.
- HR/Finance cap basis'i tamamlayana kadar o employee için **final payout export oluşturulamaz**.
- Snapshot bu durumu (`cap_applied = pending_missing_cap_basis`) kaydeder.

### 6. Pro-rata dağıtım + cap
```txt
Σadj = Σ adjusted_score_i  (eligible çalışanlar)

raw_share_i = distributable_pool * adjusted_score_i / Σadj
bonus_i     = min(cap_i, raw_share_i)        (cap basis varsa)
```
- `Σadj = 0` ise: dağıtım yok; tüm distributable_pool `undistributed`; HR/Finance manuel karar; payout üretilmez.
- Cap bağlarsa: `(raw_share_i - cap_i)` farkı **yeniden dağıtılmaz**, `undistributed_remainder`'a eklenir (Decision Lock D6).
- cap_basis yoksa: `pending_missing_cap_basis` (§5).

### 7. Para yuvarlama (kuruş, deterministik)
Tüm hesap minor unit (kuruş) ile:
1. `pool_minor = pool_amount * 100` (veya doğrudan kuruş).
2. Her çalışan için `raw_share_minor_i` hesaplanır (tam bölme + ondalık).
3. `floor_i = floor(raw_share_minor_i)`; ardından cap uygulanır: `alloc_i = min(cap_minor_i, floor_i)`.
4. `distributed = Σ alloc_i`.
5. `remainder = distributable_pool_minor - distributed`.
6. **Cap'i bağlamamış** çalışanlar arasında, `raw_share_minor_i`'nin kesirli kısmı (frac) büyükten
   küçüğe sıralanır; eşitlikte `employee_id` artan (deterministik tie-break). Sıra ile 1'er kuruş ile
   **floor residual** kapatılır. (Cap nedeniyle artan kısım Decision Lock D6 gereği dağıtılmaz.)
7. `undistributed_remainder_minor` = T_org kesintisi + cap residual + (varsa) dağıtılamayan artık.
8. Invariant: `Σ final_i + undistributed_remainder_minor = pool_minor`.

### 8. Worked example (context `09` ile doğrulama)
Girdi: pool = 100.000 TL = 10.000.000 kuruş, T_org = 1.0, cap bağlamıyor.
adjusted: Ali 1000, Ayşe 1000, Mehmet 300, Zeynep 847 → Σadj = 3147.

| Çalışan | raw_share (kuruş) | floor | frac |
| --- | ---: | ---: | ---: |
| Ali | 3.177.629,49 | 3.177.629 | 0,49 |
| Ayşe | 3.177.629,49 | 3.177.629 | 0,49 |
| Mehmet | 953.288,84 | 953.288 | 0,84 |
| Zeynep | 2.691.452,18 | 2.691.452 | 0,18 |

Σfloor = 9.999.998 kuruş → remainder = 2 kuruş.
Largest-remainder: Mehmet (0,84) → +1; sonra Ali ve Ayşe eşit (0,49), tie-break employee_id (Ali < Ayşe) → Ali +1.

| Çalışan | final (kuruş) | final (TL) |
| --- | ---: | ---: |
| Ali | 3.177.630 | 31.776,30 |
| Ayşe | 3.177.629 | 31.776,29 |
| Mehmet | 953.289 | 9.532,89 |
| Zeynep | 2.691.452 | 26.914,52 |
| **Σ** | **10.000.000** | **100.000,00** |

→ Σ tam olarak pool'a eşittir; `undistributed_remainder = 0`.

### 9. Calculation run + snapshot
- Period lock'tan sonra `bonus_calculation_run` oluşturulur (idempotency key ile; aynı run tekrar
  tetiklenirse yeni snapshot **üretmez**).
- Run sonucu **immutable** `bonus_allocation_snapshot`. Alanlar (context `06` + AD7):
  `calculation_run_id, bonus_period_id, bonus_pool_id, policy_version_id, T_org, top_up_applied,
  employee allocation details (employee_id, primary_team_id, raw_points, adjusted_score, multipliers,
  role/team/eligibility/proration factors, cap_basis, cap_minor, cap_applied
  (yes|no|pending_missing_cap_basis), raw_share_minor, final_amount_minor, rounding_adjustment_minor),
  undistributed_remainder_minor, calculation_metadata, created_at, approved_by, approved_at`.
- HR snapshot'ı inceler ve approve eder → bonus ledger accrual (bkz. `06`).
- Dispute sonucu değişiklik → **yeni** run + **yeni** snapshot (eski silinmez).

### 10. Açıklanabilirlik (employee breakdown)
Employee kendi allocation'ı için görür: approved_points, adjusted_score (faktör kırılımı),
raw_share, cap (uygulandı mı / pending_missing_cap_basis), T_org etkisi (+ top-up notu), final_amount.
"Estimated" dönemi açıkken; "final" yalnız approved snapshot sonrası.

## Edge cases

- **Σadj = 0:** dağıtım yok; pool undistributed; HR/Finance manuel.
- **Tek eligible çalışan:** raw_share = distributable_pool; cap bağlarsa residual undistributed.
- **Herkes cap'e takılır:** Σfinal < pool; fark undistributed_remainder.
- **T_org = 0:** distributable = 0; tüm pool undistributed; bonus_ledger accrual üretilmez.
- **T_org = 1.2, top-up yok:** distributable = approved pool ile sınırlı; breakdown'da açıklanır (AD8).
- **cap basis eksik:** allocation `pending_missing_cap_basis`; export bloklanır (AD6).
- **Negatif/sıfır cap (proration_factor=0):** eligible değil zaten (15 gün kuralı) → çıkar.
- **Çift run:** idempotency key → yeni snapshot yok.

## Acceptance criteria

- Σ(final allocations) + undistributed_remainder = pool (kuruş bazında tam eşitlik).
- Hiçbir allocation cap_i'yi aşmaz; cap basis yoksa unlimited cap uygulanmaz (AD6).
- T_org=1.2 top-up onayı olmadan approved pool'u aşmaz (AD8).
- Snapshot kullanılan tüm faktörleri kaydeder (AD7).
- Σadj=0 ve T_org=0 senaryolarında payout üretilmez.
- Aynı girdi → aynı snapshot (deterministik); çift run yeni snapshot üretmez.
- `09` worked example birebir reproduce edilir.

## Test implications

- Worked-example testi (yukarıdaki tablo birebir).
- Σ invariant testi (cap'li, cap'siz, T_org'lu senaryolar).
- AD6 testi: cap basis yok → `pending_missing_cap_basis`; export bloklanır; unlimited cap yok.
- AD8 testi: T_org=1.2 + top-up yok → distributable = approved pool; top-up var → 1.2 uygulanır.
- AD7 testi: snapshot tüm faktörleri içerir; period lock sonrası faktör değişmez.
- AD9 testi: team_factor primary_team'den.
- Σadj=0 testi; T_org=0 testi; tek-eligible testi; herkes-cap testi.
- Rounding determinizm + tie-break (employee_id) testi.
- Idempotency testi (çift run → tek snapshot).
- Eligibility 15-gün eşik testi; proration cap testi.

## Open questions

- (Phase-gate OQ'lar kapatıldı.) Açık kalan ileri seviye konular V1'e ait: multi-team weighted factor (AD9),
  iterative cap redistribution (D6), Hybrid/Winner/Tournament modelleri.
