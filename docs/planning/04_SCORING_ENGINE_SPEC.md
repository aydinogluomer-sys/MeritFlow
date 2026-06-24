# 04 — Scoring Engine Spec (DEEP)

## Purpose

Bir görev `approved` olduğunda kazanılan **final puanı** deterministik, server-side, açıklanabilir
ve versiyonlanmış bir politika ile nasıl hesapladığımızı tanımlamak. Bu motor primin (bonus engine,
`05`) tek puan girdisini üretir.

## Scope

- Kapsam: task-level scoring (base points → multipliers → revision penalty → final points), policy
  versiyonlama, point ledger yazımı, manual override, timeliness kuralı.
- Kapsam dışı: bonus/pool/allocation hesabı (`05`), anti-gaming flag üretimi (`08`), collaboration multiplier (V1, AD5).

## Assumptions

- `Assumption:` `base_points` görev oluşturulurken Manager tarafından girilir; sistem öneri verebilir
  (öneri algoritması MVP'de basit/sabit; gelişmiş öneri V1).
- Çarpan değerleri scoring policy version içinde saklanır ve period başında kilitlenir (Decision Lock AD7);
  org bunları yayınlamadan görev approve edilemez.
- `Assumption:` Puanlar ondalık (numeric) tutulur; yuvarlama yalnız sunum/raporlama için, ledger ham değeri saklar.

## Non-negotiable rules

- Puan client'tan **alınmaz**; yalnız server-side, approved task üzerinden hesaplanır.
- Hesaplama **kilitli** `scoring_policy_version` ile yapılır (dönem ortasında değişmez — AD7).
- `quality = poor` ise görev `approved` olamaz (Decision Lock D3) → bu motor poor ile çağrılmaz.
- Timeliness çalışanın `submitted_at` zamanına göre ölçülür; geç onay çalışanı **cezalandırmaz** (Decision Lock AD4).
- Collaboration score `final_points`'i **etkilemez** (Decision Lock AD5).
- Approve idempotenttir: aynı task ikinci kez approve edilse bile ikinci bir kazanç ledger entry'si üretmez.
- Manual override yalnız reason + audit + 2-step ile; ayrı `manual_adjustment` ledger entry'si olarak.
- Hiçbir mutable `total_points` alanı source of truth olamaz; toplam ledger'dan türetilir.

## Detailed specification

### 1. Girdi alanları (task üzerinden)
- `base_points` (Manager girer)
- `complexity` ∈ {low, medium, high, critical}
- `impact` ∈ {low, medium, high, strategic}
- `quality` ∈ {acceptable, good, excellent}  (poor approve'a izin vermez → motora gelmez)
- `timeliness` ∈ {early, on_time, late_minor, late_major}  (yalnız `submitted_at` vs due_date'ten türetilir — AD4)
- `revision_count` (needs_revision sayısı) + revision history
- `last_valid_submitted_at` (son geçerli submission zamanı — AD4)
- `collaboration_score` (kaydedilir ama puanı etkilemez — AD5)
- `scoring_policy_version_id` (görev oluşturulurken bağlanır; period locked ise sabit)

### 2. Çarpan tabloları (policy version içinde saklanır, period başında kilitli — AD7)
| Faktör | Değer → çarpan |
| --- | --- |
| complexity | low 1.0 · medium 1.25 · high 1.5 · critical 2.0 |
| impact | low 1.0 · medium 1.2 · high 1.5 · strategic 2.0 |
| quality | acceptable 0.75 · good 1.0 · excellent 1.25 (poor 0 — ama approve edilemez) |
| timeliness | early 1.1 · on_time 1.0 · late_minor 0.85 · late_major 0.5 |

### 3. Formül (üretim yorumu)
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
> `collaboration_score` formülde yer almaz (AD5).

### 4. Timeliness türetme (AD4 — çalışanın kontrolündeki an)
- Ölçüm referansı: **`submitted_at`** (geç manager onayı timeliness'i düşürmez).
- `needs_revision` döngüsünde: final değerlendirme **son geçerli submission** (`last_valid_submitted_at`)
  ile yapılır; tüm submission/revision history `task_events`'te kaydedilir.
- `early`: submitted_at due_date'ten belirgin önce (`Assumption:` >= %20 erken).
- `on_time`: due_date'e kadar (submitted_at <= due_date).
- `late_minor`: due_date sonrası ama eşik içinde (`Assumption:` <= 48 saat).
- `late_major`: eşik sonrası.
- Türetme kuralı policy version'da parametre olarak tutulur; reviewer manuel override edebilir (audit'li).
- Breakdown'da hangi submission zamanının baz alındığı açıkça gösterilir (açıklanabilirlik — AD4).

### 5. Policy versiyonlama (AD7)
- `scoring_policies` (mantıksal politika) 1—* `scoring_policy_versions` (immutable snapshot).
- Bir görev oluşturulurken aktif published version'a bağlanır.
- Bonus period `locked` olduğunda, o döneme düşen görevlerin policy version'ı **değişemez** (silent mutation yasak).
- Yeni version yayınlamak audit üretir; eski version geçmiş görevleri etkilemez.
- Değişiklik gerekiyorsa: yeni version + audit + (etkilenen döneme) recalculation flow.
- Yayınlanmamış (draft) version ile görev approve edilemez.

### 6. Approve akışı (server-side, deterministik)
1. Reviewer `approve` seçer; quality/timeliness/collaboration skorlarını verir.
2. Guard: reviewer ≠ assignee (self-approval block); status == submitted; period not locked; quality != poor.
3. Sistem ilgili `scoring_policy_version`'dan çarpanları okur (kilitli — AD7).
4. `final_points` hesaplanır (timeliness submitted_at'ten — AD4; collaboration hariç — AD5).
5. `point_ledger`'a tek `task_approved` (kazanç) entry'si yazılır: `points_delta = final_points`,
   `reason`, `scoring_policy_version_id`, breakdown `metadata` (her çarpanın değeri + baz alınan submission zamanı).
6. Task `final_points`, `approved_at` set edilir (bu alan **türev cache**'tir, source of truth ledger).
7. `audit_log` (`action = task.approve`) yazılır.
8. Employee'ye notification; breakdown UI'da görünür.

### 7. Breakdown (açıklanabilirlik)
Her approve, employee'ye gösterilebilen şu kırılımı saklar (ledger metadata):
```txt
base_points, complexity(x), impact(x), quality(x), timeliness(x) + baz submission zamanı,
revision_count, revision_penalty_rate, final_points
```
"Bu puanı neden aldım?" sorusu bu kırılımla yanıtlanır. Collaboration score ayrı (bilgilendirme), puanı etkilemez.

### 8. Manual override / adjustment
- Manager/Admin doğrudan puan **yazamaz**; yalnız policy parametreleriyle hesaplanır.
- İstisnai durumda override gerekirse:
  - `point.override` izni + 2. onay + zorunlu `reason`.
  - Ayrı `manual_adjustment` ledger entry'si (delta, reason, created_by).
  - `audit_log` (`action = point.manual_adjustment`).
  - Employee bunu breakdown'da "manuel düzeltme" olarak görür ve dispute edebilir.

### 9. Puan yuvarlama
- Puanlar finansal değil; ham numeric saklanır. Sunumda 2 ondalık.
- Para yuvarlaması bonus engine'de (`05`) ayrı ele alınır — burada yapılmaz.

## Edge cases

- **base_points = 0:** geçerli (sıfır puanlı görev olabilir); final_points = 0; yine de ledger entry yazılır (iz için).
- **Tüm çarpanlar minimum + max revision:** `final * 0.75(q) * 0.5(t) * (1-0.25)` → düşük ama negatif olamaz (≥0).
- **revision_count > 5:** penalty %25'te sabitlenir (cap).
- **Geç onay:** manager submitted_at'ten çok sonra approve etse bile timeliness submitted_at'e göre (AD4) → çalışan cezalanmaz.
- **needs_revision sonrası tekrar submit:** son geçerli submission zamanı timeliness'i belirler; history korunur (AD4).
- **quality = poor geldi:** hata; approve reddedilir (Decision Lock D3) — motor çağrılmaz.
- **Period lock yarışı:** approve sırasında dönem lock olduysa işlem reddedilir (transaction guard).
- **İkinci approve denemesi:** idempotent; ikinci kazanç entry'si üretilmez.
- **Policy version draft:** approve reddedilir.
- **timeliness verisi yoksa (due_date null):** `on_time` varsayılır (`Assumption`).

## Acceptance criteria

- Aynı girdi her zaman aynı final_points üretir (deterministik).
- final_points yalnız published+locked policy version ile hesaplanır (AD7).
- Timeliness submitted_at'e göre; geç onay puanı düşürmez (AD4).
- Collaboration score puanı etkilemez (AD5).
- Approve → tam olarak bir kazanç ledger entry + bir audit_log.
- quality=poor ile approve mümkün değil.
- Manual override reason + audit + ayrı entry olmadan mümkün değil.
- Breakdown her approve için saklanır ve employee'ye gösterilebilir.

## Test implications

- Business-logic: submitted → final puan vermez; approved → ledger entry; rejected → entry yok.
- Determinizm testi: sabit girdi → sabit çıktı (örnek vektörler).
- AD4 testi: geç onay timeliness'i düşürmez; needs_revision sonrası son submission baz alınır.
- AD5 testi: farklı collaboration_score aynı final_points üretir.
- Penalty cap testi: revision_count=6 → rate=0.25.
- Policy lock testi: locked period'da version değişmez; draft version approve etmez (AD7).
- Override testi: reason'sız override reddedilir; override audit + ayrı entry üretir.
- Idempotency testi: çift approve → tek kazanç entry.

## Open questions

- OQ-SC-2: `early` eşiği ve `late_minor` eşiği policy'de sabit mi org-configurable mı? (Öneri: policy version parametresi.) — V1.
- OQ-SC-3: base_points öneri algoritması MVP'de sabit mi? (Öneri: complexity/impact'tan basit lookup.) — V1.
