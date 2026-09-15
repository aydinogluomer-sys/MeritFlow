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

### D13 — Governed Monetary Adjustments (Yönetilen Parasal Düzeltmeler)

> Kanonik kural: **Tüm yetkili prim parası — onaylı parasal düzeltmeler dâhil — yalnızca deterministik bir
> hesaplama koşusundan ve immutable snapshot'tan doğar. İnsan kullanıcılar parasal düzeltme talep edip
> onaylayabilir ama `bonus_ledger` / payout bakiyelerini asla doğrudan mutasyona uğratamaz. Ek parasal
> düzeltmeler taban fonlamayı yalnızca açık Finance-onaylı fonlama yetkilendirmesiyle aşabilir. Ödenmiş
> veya kapanmış tarihsel settlement durumu asla yeniden açılmaz; sonraki düzeltmeler immutable correction
> settlement'larla ve gerektiğinde mevcut yönetilen clawback süreciyle temsil edilir.**

Bağlayıcı hükümler:

1. Yetkili prim parası yalnız deterministik `calculation run` + immutable snapshot'tan çıkar.
2. İnsan kullanıcılar `bonus_ledger` bakiyelerini **doğrudan değiştiremez**.
3. Parasal düzeltmeler **yönetilen hesaplama girdileridir** (calculation input), ledger mutation değildir.
4. Parasal düzeltme talebi şunları ister: target organization, target employee, target bonus period,
   signed economic intent (yön + `amount_minor`), reason code, human-readable justification, audit identity,
   gereken yerde evidence/reference.
5. Nihai onay **ayrı HR ve Finance yetkisi** ister (four-eyes).
6. Talep sahibi kendi parasal düzeltmesini tek başına onaylayamaz.
7. HR ve Finance onayları **tek bir onay olayına indirgenemez** (ayrı kimlik + ayrı zaman kaydı).
8. Ek fonlama **açık Finance yetkilendirmesi** ister; AD8 ile sınırlıdır (≤ 1.2×; 1.2× ötesi **ayrı, gelecek
   bir kilitli ürün kararı** olup bu kapsamda değildir).
9. Mevcut cap / eligibility / proration kontrolleri, **ayrı bir kilitli ürün kararı açıkça override
   yaratmadıkça**, atlanmaz.
10. Onaylanmış parasal düzeltme **immutable financial-basis artifact**'tır.
11. Düzeltme = compensating/reversal artifact; **yıkıcı mutasyon (UPDATE/DELETE) yoktur**.
12. Ödenmiş/kapanmış finansal tarih **asla yeniden açılmaz veya sessizce yeniden yazılmaz**.
13. Finansal kapanış sonrası **pozitif** düzeltme bir **correction settlement** kullanır.
14. Ödeme sonrası **negatif** düzeltme **asla otomatik clawback yapmaz**; **D2 bağlayıcı kalır**
    (governed recovery-pending → HR/Finance/Legal approval + dispute hakkı).
15. Point-ledger `manual_adjustment` **puan-domain primitifidir** ve yeniden tanımlanmaz (puan ≠ para).
16. Düzeltme attribution'ı **açıklayıcı/provenance** verisidir; bağımsız bir para otoritesi **değildir**.

Fonlama (coordinator-confirmed):

- **REALLOCATION:** yalnız hâlihazırda yetkilendirilmiş fonlama içinde (undistributed / headroom) çalışır;
  ek fonlama gerektirmez.
- **SUPPLEMENTAL:** yalnız Finance-onaylı **pool re-version** ile (mevcut pool mekanizması yeniden
  kullanılır), AD8 ile sınırlı (≤ 1.2×). Pool-versioning temiz temsil edemezse ayrı bir
  `funding_authorization` kaydı eklenir; başka türlü ek para **açık Finance yetkilendirmesi olmadan asla**
  ortaya çıkmaz.

Actor integrity: yeni parasal RPC'ler her four-eyes adımında actor = `auth.uid()` bağlar (caller-supplied
actor spoofing yoktur). Mevcut `apply_manual_point_adjustment` audit-actor provenance nüansı **ayrı** bir
bulgudur; bu programın temeline bir point-RPC değişikliği **paketlenmez** (`12` roadmap'te opsiyonel gelecek
micro-hardening olarak işlenir).

Invariant tutarlılığı (SI-13 / BL-2): yetkili etkin fonlama (`pool_ref`), **onaylı düzeltmeler dâhil**,
Σfinal'i karşılamak zorundadır. REALLOCATION headroom'u tüketir; SUPPLEMENTAL fonlama yetkilendirmesi ister.
SI-13 (Σfinal + undistributed = `pool_ref`) ve BL-2 (Σaccrual ≤ `pool_ref`) bu **additive** düzeltme terimiyle
**korunur** (düzeltme `pool_ref`'i aşamaz; aşarsa SUPPLEMENTAL fonlama şarttır). Hesap matematiği bir Slice 3
çıktısıdır; bu karar yalnız invariant'ların tutarlı kalmasını sabitler.

Korunan kararlar (bu karar hiçbirini geçersiz kılmaz): **D2, AD6, AD8, AD9, AD10, ADR-006, ADR-017**.
Uygulama: `ADR-021`; spec'ler `06`/`07`/`16`; program `12` (GMA Slice 1–7).

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

- 13 (D1–D13) + 10 (AD1–AD10) kararın tamamı ilgili spec dokümanlarında uygulanmış olmalı.
- Hiçbir spec dokümanı kilitli bir kararla çelişmemeli.
- Çelişki bulunursa spec değil, bu dosya referans alınır.

## Test implications

- Test stratejisi (`10_TEST_STRATEGY.md`) her kilitli kararı (D + AD) en az bir test senaryosuna bağlamalı
  (örn. D3 → "quality=poor approve edilemez"; AD4 → "geç onay çalışanı cezalandırmaz";
  AD6 → "cap basis yoksa export bloklanır"; AD8 → "T_org=1.2 top-up'sız pool'u aşamaz";
  D13 → "insan doğrudan bonus_ledger'a para yazamaz; onaylı parasal düzeltme yalnız engine+snapshot
  üzerinden; kapanmış dönem yeniden açılmaz; negatif düzeltme otomatik clawback yapmaz").

## Open questions

- Yok. Bu dosya açık soru içermez; açık sorular ilgili spec dokümanlarında tutulur ve buraya
  yalnız karara dönüştüklerinde işlenir.
