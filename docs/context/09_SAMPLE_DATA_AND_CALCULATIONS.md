# Sample Data and Expected Calculations

## Employees

| id | name | role | team | employment_type | role_factor |
| --- | --- | --- | --- | --- | --- |
| e1 | Ali | Sales | A | full_time | 1.0 |
| e2 | Ayşe | Sales | A | full_time | 1.0 |
| e3 | Mehmet | Support | B | part_time | 0.5 |
| e4 | Zeynep | Operations | B | full_time | 1.1 |

## Approved Points

| employee | raw_points | quality_factor | team_factor | eligibility |
| --- | ---: | ---: | ---: | ---: |
| Ali | 1000 | 1.0 | 1.0 | 1 |
| Ayşe | 800 | 1.25 | 1.0 | 1 |
| Mehmet | 600 | 1.0 | 1.0 | 1 |
| Zeynep | 700 | 1.1 | 1.0 | 1 |

## Adjusted Score Calculation

Ali:

```txt
1000 * 1.0 * 1.0 * 1.0 = 1000
```

Ayşe:

```txt
800 * 1.0 * 1.25 * 1.0 = 1000
```

Mehmet:

```txt
600 * 0.5 * 1.0 * 1.0 = 300
```

Zeynep:

```txt
700 * 1.1 * 1.1 * 1.0 = 847
```

Total adjusted score:

```txt
3147
```

## Bonus Pool

Bonus pool:

```txt
100,000 TL
```

## Expected Bonus

Ali:

```txt
100000 * 1000 / 3147 = 31,776.29 TL
```

Ayşe:

```txt
100000 * 1000 / 3147 = 31,776.29 TL
```

Mehmet:

```txt
100000 * 300 / 3147 = 9,532.89 TL
```

Zeynep:

```txt
100000 * 847 / 3147 = 26,914.52 TL
```

## Expected Rules

- Raw points directly do not determine bonus.
- Adjusted score determines bonus.
- Part-time role factor applies.
- Quality multiplier can make lower raw score equal higher raw score.
- Rounding difference must be handled.
- Total payout must not exceed pool.

## Rounding Requirement

Claude şunu ayrıca tasarlamalıdır:

- Para hesaplamasında integer kuruş/cent bazlı hesaplama önerilmeli.
- Decimal rounding farkı en son allocation’a veya özel rounding_adjustment alanına yazılmalı.
- Total payout hiçbir koşulda bonus pool’u aşmamalı.
- Snapshot içinde raw, rounded ve final amount ayrı tutulmalı.

---
