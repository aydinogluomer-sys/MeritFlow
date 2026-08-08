# 00 — Decision Lock

> Bu doküman bağlayıcıdır. Aşağıdaki kararlar kullanıcı tarafından kilitlenmiştir (`Decision Lock`).
> Tüm diğer planlama dokümanları bu kararlara uymak zorundadır. Bir karar yalnızca kullanıcının
> açık talimatıyla değiştirilebilir; değişiklik bu dosyada revizyon notu olarak işlenir.

## Purpose

MeritFlow MVP planlamasının üzerine inşa edileceği nihai ürün/mimari kararlarını tek yerde,
değiştirilemez referans olarak sabitlemek.

## Scope

- Kapsam: MVP planlama fazı kararları.
- Source of truth: `/docs/context` altındaki 13 context dosyası.
- PDF kullanılmayacaktır. `00_MASTER_PROMPT_v2.md` içindeki tüm PDF referansları **"context pack kavramları"**
  olarak yorumlanır. Tournament Theory, Octalysis, Zero Factor, Redis ZSET, double-entry ledger, Z-score,
  collusion detection gibi kavramlar context pack içinde **yeterli** kabul edilir. Phase 0 için PDF doğrulaması gerekmez.
- PDF yokluğu artık blocker / gap / open question değildir.

## Assumptions

- Birincil pazar Türkiye; UI Türkçe, kod/domain terimleri İngilizce (bkz. Decision 8).
- Para birimi varsayılan TL; hesaplama minor unit (kuruş) bazlı.
- Tek tenant = tek organization; bir kullanıcı birden çok org'da farklı role sahip olabilir.

## Non-negotiable rules

- Pure tournament modeli default olamaz.
- Employee monitoring / surveillance yok.
- Puan client'tan alınmaz; yalnız approved task üzerinden server-side hesaplanır.
- Point ledger append-only.
- Bonus calculation snapshot immutable ve zorunlu.
- RLS zorunlu; cross-tenant erişim engellenir.
- Manual adjustment, bonus approval, dispute decision, payout export için audit log zorunlu.
- Implementation yalnız kullanıcı `implementation authorized` dediğinde başlar.

## Detailed specification — Locked Decisions

### D1 — Pro-rata formül tutarlılığı

- MVP'de **tek havuz** kullanılır.
- `W_individual = 1.0`.
- Hybrid model açıldığında component weights devreye girer (V1+).
- MVP'de yalnız **Safe Pro-Rata Model** ship edilir.

### D2 — Malus / Clawback

- `M_i` adjusted score çarpanı **değildir**.
- Malus/clawback ayrı **approval workflow** olarak modellenir.
- Otomatik kesinti yok.
- HR/Finance/Legal approval + bonus ledger reversal/adjustment + dispute hakkı **zorunlu**.

### D3 — Quality = poor

- `quality = poor` ise görev `approved` olamaz.

- Reviewer yalnız `needs_revision` veya `rejected` seçebilir.
- Approved task minimum `acceptable` kaliteye sahip olmalıdır.

### D4 — Rol taksonomisi

- MVP'de tek `Manager` rolü.
- `Department Manager` ve `Team Lead` V1'e ertelenir.
- `Super Admin / SaaS Support` yalnız support access grant ile, sınırlı/süreli ve audit'li.

### D5 — Anti-gaming MVP (5 deterministik kural)

1. self-approval block
2. duplicate task detection
3. tiny-task splitting flag
4. same-reviewer concentration flag
5. period-end point spike flag

Z-score, graph collusion, GNN ve gelişmiş anomaly sistemi V1/V2'ye ertelenir.

### D6 — Cap residual

- Cap sonrası kalan tutar MVP'de **yeniden dağıtılmaz**.
- `undistributed_remainder` calculation snapshot içinde saklanır.
- Iterative redistribution V1 feature flag.

### D7 — Maaş / Cap kaynağı

- `compensation_records` tablosu eklenir.
- compensation-sensitive sınıfı.
- Employee bu veriyi göremez.
- HR/Finance minimum yetkiyle erişir.
- Tüm erişimler audit log'a düşer.

### D8 — Birincil pazar / dil

- MVP TR-first.
- UI dili Türkçe olabilir.
- Kod/domain terimleri İngilizce.
- KVKK ve Türkiye iş hukuku riskleri explicit **legal-review item**.

### D9 — Dispute SLA

- Dispute reviewer ataması **HR** tarafından yapılır.
- MVP SLA: **5 iş günü**.
- Manager kendi verdiği karara açılan dispute'ta final decision maker **olamaz**.
- Dispute sonucu audit log'a yazılır.

### D10 — Eligibility / proration

- Eligible çalışan: dönem içinde aktif membership'i olan ve ilgili dönemde **en az 15 takvim günü** çalışmış kişi.
- Dönem ortası giriş/çıkış için **basit proration** uygulanır.
- İşten ayrılan çalışan konusu **legal-review item**.
- Gelişmiş tenure/leave/part-time kuralları V1.

### D11 — Period model

- MVP yalnız **monthly** bonus period destekler.
- Weekly/quarterly/custom V1.

### D12 — Leaderboard

- MVP'de 2 görünüm: (1) personal progress, (2) anonymized percentile / nearby range.
- Global public leaderboard yok.
- Advanced leaderboard türleri V1+.

## Additional Decision Lock — Phase-Gate OQ Resolution

> Phase-gate open question'ları aşağıdaki kararlarla kapatılmıştır. Bunlar da bağlayıcıdır (AD1–AD10).

### AD1 — Role change / RLS  (resolves OQ-RLS-1)

- Roller ve yetkiler DB'deki `memberships` / RBAC kayıtlarından okunur.
- Client-side role ve JWT claim **source of truth değildir**.
- JWT yalnız identity için kullanılır; authorization server-side + RLS ile yapılır.

### AD2 — Çoklu rol  (resolves OQ-RLS-3)

- MVP'de her organization membership için tek `primary_role`.
- Multi-role permission merge V1'e ertelenir.
- İleride multi-role gelirse: **explicit deny / sensitive restriction allow'dan üstündür**.

### AD3 — Audit'te compensation-sensitive data  (resolves OQ-LA-1)

- `compensation_records` erişimleri auditlenir.
- Employee compensation audit payload göremez.
- Audit listesinde: action, actor, target, timestamp ve **masked summary** görünür.
- Raw before/after compensation payload yalnız HR/Finance/Auditor yetkisiyle ve **gerekçeli erişimle** görülebilir.
- Tüm sensitive audit erişimleri ayrıca audit log'a düşer.

### AD4 — Timeliness calculation  (resolves OQ-SC-1)

- Timeliness multiplier çalışanın `submitted_at` zamanını baz alır.
- Manager/reviewer'ın geç onayı çalışanı **cezalandırmaz**.
- `needs_revision` sonrası final değerlendirmede **son geçerli submission zamanı** ve **revision history** birlikte kaydedilir.
- Kural scoring breakdown'da açıklanabilir olur.

### AD5 — Collaboration score  (resolves OQ-SC-4)

- MVP'de collaboration score `final_points` veya bonus hesabını **etkilemez**.
- Yalnız kayıt/analitik/review context olarak tutulur.
- Collaboration multiplier V1'e ertelenir.

### AD6 — Maaş / cap basis eksikliği  (resolves OQ-BN-2)

- Aktif `compensation_records` veya geçerli absolute cap basis yoksa allocation `pending_missing_cap_basis` statüsüne alınır.
- Sistem **sessizce unlimited cap uygulamaz**.
- HR/Finance eksik cap basis'i tamamlamadan **final payout export oluşturulmaz**.

### AD7 — Policy / factor lock  (resolves OQ-BN-3)

- Scoring policy ve bonus policy period başında **version olarak kilitlenir**.
- role factor, team factor, eligibility, proration, cap basis ve T_org **calculation snapshot içinde** kaydedilir.
- Period lock sonrası policy/factor değişikliği **silent mutation olarak yasaktır**.
- Değişiklik gerekiyorsa: yeni version + audit + recalculation flow.

### AD8 — T_org = 1.2  (resolves OQ-BN-1)

- `T_org = 1.2` onaylı bonus pool tutarını **sessizce aşamaz**.
- Hedef üstü başarı ek bütçe gerektiriyorsa **Finance top-up approval** gerekir.
- Top-up yoksa dağıtılabilir tutar approved pool ile sınırlıdır.
- Durum bonus breakdown'da açıklanır.

### AD9 — Çoklu takım  (resolves OQ-BN-4)

- MVP'de her employee her period için tek `primary_team` ile değerlendirilir.
- Multi-team allocation ve weighted team factor V1'e ertelenir.

### AD10 — Bonus pool timing  (resolves OQ-PRD-1)

- Bonus pool, period close / calculation **öncesinde kilitlenmiş** olmalıdır.
- Lock sonrası pool amount değişikliği normal edit olamaz.
- Değişiklik gerekiyorsa: new version + audit + recalculation.

## Edge cases

- Bir karar başka bir context dosyasıyla çelişirse, **Decision Lock üstündür**.
- AD kararları orijinal D kararlarıyla birlikte uygulanır; çelişirse en kısıtlayıcı/güvenli yorum kazanır.
- Decision Lock bir konuyu kapsamıyorsa, ilgili spec dokümanı `Assumption` olarak işaretler ve Open Questions'a taşır.

## Acceptance criteria

- 12 (D1–D12) + 10 (AD1–AD10) kararın tamamı ilgili spec dokümanlarında uygulanmış olmalı.
- Hiçbir spec dokümanı kilitli bir kararla çelişmemeli.
- Çelişki bulunursa spec değil, bu dosya referans alınır.

## Test implications

- Test stratejisi (`10_TEST_STRATEGY.md`) her kilitli kararı (D + AD) en az bir test senaryosuna bağlamalı
  (örn. D3 → "quality=poor approve edilemez"; AD4 → "geç onay çalışanı cezalandırmaz";
  AD6 → "cap basis yoksa export bloklanır"; AD8 → "T_org=1.2 top-up'sız pool'u aşamaz").

## Open questions

- Yok. Bu dosya açık soru içermez; açık sorular ilgili spec dokümanlarında tutulur ve buraya
  yalnız karara dönüştüklerinde işlenir.
