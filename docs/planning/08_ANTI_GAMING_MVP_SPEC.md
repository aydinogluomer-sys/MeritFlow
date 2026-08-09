# 08 — Anti-Gaming MVP Spec

## Purpose

MVP'de hile/manipülasyonu **otomatik ceza vermeden** tespit edip insan incelemesine yönlendiren
5 deterministik kuralı tanımlamak. Bu sistem flag üretir; karar her zaman insandadır.

## Scope

- Kapsam: 5 deterministik kural (Decision Lock D5), flag → review queue → dispute akışı.
- Kapsam dışı: Z-score, graph collusion, GNN, gelişmiş anomaly (V1/V2 — Decision Lock D5).

## Assumptions

- `Assumption:` Eşik değerleri org settings ile ayarlanabilir; aşağıdaki değerler varsayılan.
- `Assumption:` Flag'ler asenkron (review sonrası veya periyodik job) üretilebilir; MVP'de approve anında + period-end taramasında.

## Non-negotiable rules

- Anti-gaming **otomatik ceza vermez**; yalnız `anti_gaming_flag` (status: open/reviewing/dismissed/confirmed) üretir.
- Self-approval **hard block** (flag değil, engelleme) — reviewer ≠ assignee.
- Flag'ler açıklanabilir; etkilenen çalışan/manager için şeffaf; flag primi otomatik etkilemez
  (insan kararı + gerekirse dispute → ledger adjustment).
- Human-in-the-loop zorunlu (GDPR/KVKK otomatik karar riskine karşı).

## Detailed specification

### Kural 1 — Self-approval block (hard)

- Mekanizma: reviewer_id == assignee_id ise approve **reddedilir** (DB + uygulama).
- Çıktı: engelleme (flag değil); denenirse audit.

### Kural 2 — Duplicate task detection

- Mekanizma: aynı assignee + aynı/çok benzer title (normalize) + yakın zaman penceresi içinde
  tekrar eden görevler (`Assumption:` aynı title + 24 saat içinde N≥2).
- Çıktı: `flag(duplicate_task)` → review queue.

### Kural 3 — Tiny-task splitting flag

- Mekanizma: kısa sürede çok sayıda düşük base_point'li görev (`Assumption:` base_points < eşik ve
  aynı assignee için 1 saatte M≥ adet) → görev parçalama şüphesi.
- Çıktı: `flag(tiny_task_splitting)`.

- Mekanizma: bir çalışanın onaylarının orantısız kısmı aynı reviewer'dan (`Assumption:` son dönemde
  bir reviewer payı > %80 ve toplam onay ≥ eşik) → collusion sinyali (deterministik oran).
- Çıktı: `flag(same_reviewer_concentration)`.

### Kural 5 — Period-end point spike flag

- Mekanizma: dönem kapanışına yakın pencerede (`Assumption:` son 3 gün) bir çalışanın puan kazancı
  kendi dönem ortalamasının belirgin üstünde (`Assumption:` günlük ortalamanın > 3 katı) → puan şişirme şüphesi.
- Çıktı: `flag(period_end_spike)`.

### Flag yaşam döngüsü

```txt
open -> reviewing -> confirmed | dismissed
```

- Manager/HR review queue'da görür; inceler; `confirmed` ise olası aksiyon: ilgili görevlerin yeniden
  review'i, manuel adjustment (audit'li), veya dönem hesabında HR kararı.
- `dismissed` ise gerekçe + audit.
- Confirmed flag tek başına ceza değildir; her finansal etki ayrı insan kararı + ledger entry + (çalışan için) dispute hakkı.

## Edge cases

- Meşru yoğun dönem (gerçek yüksek performans) → false positive; bu yüzden flag, ceza değil.
- Küçük takımda same-reviewer doğal (tek manager) → eşik + "tek reviewer mümkün" istisnası (org boyutuna göre).
- Part-time çalışanın düşük hacmi tiny-split'i yanlış tetikleyebilir → eşik kişiselleştirme (V1).
- Period-end spike, gerçekten dönem sonunda biten büyük görevden olabilir → review insanı karar verir.

## Acceptance criteria

- 5 kural tanımlı ve deterministik; eşikler configurable.
- Hiçbir kural otomatik ceza/kesinti üretmiyor (self-approval hariç = engelleme).
- Her flag review queue'ya düşüyor; confirm/dismiss audit'li.
- Flag'in finansal etkisi yalnız ayrı insan kararı + ledger entry ile mümkün.

## Test implications

- Self-approval testi: reviewer=assignee approve reddedilir.
- Her kural için pozitif (tetikler) + negatif (tetiklemez) test.
- "Confirmed flag otomatik ceza üretmez" testi.
- False-positive senaryo testi (meşru yoğunluk flag olur ama ceza olmaz).

## Open questions

- OQ-AG-1: Eşik varsayılanları (N, M, %, kat) hangi değerlerde başlamalı? (Pilot veriyle kalibre — V1.)
- OQ-AG-2: Tek-manager'lı küçük org'da same-reviewer kuralı otomatik devre dışı mı? (Öneri: org boyutu < eşik ise pasif.)
- OQ-AG-3: Flag üretimi gerçek-zamanlı mı yoksa periyodik job mu? (Öneri: approve anında basit kurallar + period-end batch.)
