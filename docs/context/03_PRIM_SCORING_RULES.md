# Prim ve Puanlama Kuralları

## Temel İlke

Puan sadece çalışan “tamamladım” dediği için verilmez. Puan ancak görev reviewer/manager tarafından onaylandıktan sonra point ledger’a yazılır.

## Task Status Flow

```txt
draft -> assigned -> in_progress -> submitted -> needs_revision -> approved
                                                    -> rejected
                                                    -> cancelled
```

## Scoring MVP Formula

```txt
final_points =
base_points
* complexity_multiplier
* impact_multiplier
* quality_multiplier
* timeliness_multiplier
- revision_penalty
```

## Complexity Multipliers

- low: 1.0
- medium: 1.25
- high: 1.5
- critical: 2.0

## Impact Multipliers

- low: 1.0
- medium: 1.2
- high: 1.5
- strategic: 2.0

## Quality Multiplier

- poor: 0
- acceptable: 0.75
- good: 1.0
- excellent: 1.25

## Timeliness Multiplier

- early: 1.1
- on_time: 1.0
- late_minor: 0.85
- late_major: 0.5

## Revision Penalty

Her revizyon final puandan %5 düşürür. Maksimum revizyon cezası %25’tir.

Önerilen üretim yorumu:

```txt
revision_penalty_rate = min(revision_count * 0.05, 0.25)

final_points =
base_points
* complexity_multiplier
* impact_multiplier
* quality_multiplier
* timeliness_multiplier
* (1 - revision_penalty_rate)
```

## Bonus Formula — Safe Pro-Rata

```txt
adjusted_score_i =
approved_points_i
* role_normalization_factor_i
* quality_factor_i
* team_factor_i
* eligibility_factor_i

bonus_i =
min(
  employee_bonus_cap_i,
  bonus_pool_amount * adjusted_score_i / sum(adjusted_scores)
)
```

## Zero Total Points

Eğer dönemde eligible çalışanların toplam adjusted score’u 0 ise:

- Bonus dağıtımı yapılmaz.
- Havuz “undistributed” statüsüne alınır.
- HR/Finance manuel karar vermeden ödeme oluşturulmaz.

## Cap

Bir çalışanın alabileceği dönemsel maksimum prim:

- Varsayılan: brüt maaşın %50’si
- Organization setting ile değişebilir
- Değişiklik dönem başlamadan önce yapılmalıdır

## Zero Factor

Şirket/departman hedefi tutmazsa T_org uygulanabilir.

T_org değerleri:

- 0: prim askıya alınır
- 0.5: havuzun yarısı dağıtılır
- 1: normal dağıtım
- 1.2: hedef üstü başarı çarpanı

Kurallar:

- Dönem başında tanımlanır
- Dönem sonunda keyfi değiştirilemez
- Değişiklik audit log ister
- HR/Finance onayı gerekir

## Winner Bonus

Varsayılan kapalıdır.

Açılırsa:

- Tüm havuz birinciye verilmez
- En fazla havuzun %5-10’u winner overlay olarak ayrılır
- Kalite barajı ve cap geçerlidir

---
