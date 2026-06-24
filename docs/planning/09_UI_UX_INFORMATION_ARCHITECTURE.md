# 09 — UI/UX Information Architecture

## Purpose

MVP'nin ekran envanterini, rol bazlı bilgi mimarisini (IA), navigasyonu ve bağlayıcı UX kurallarını
tanımlamak. Premium, sakin, finance-grade, çalışanı baskılamayan bir HR-tech deneyimi hedeflenir.

## Scope

- Kapsam: rol bazlı ekran listesi, navigasyon yapısı, açıklanabilirlik ve leaderboard UX kuralları, durum (state) gereksinimleri.
- Kapsam dışı: görsel tasarım sistemi detayı, component kütüphanesi (implementation), mobil app.

## Assumptions

- `Assumption:` Web-first, masaüstü öncelikli, responsive.
- `Assumption:` UI dili Türkçe (Decision Lock D8); i18n altyapısı V1 için açık bırakılır.
- `Assumption:` WCAG 2.1 AA hedef seviyesidir.

## Non-negotiable rules

- "Bu puanı neden aldım?" ve "Bu prim nasıl hesaplandı?" her zaman açıklanabilir (breakdown).
- Estimated bonus, hak edilmiş/garanti gibi gösterilemez; net "tahmini" etiketi.
- Pending / approved / disputed puanlar görsel olarak ayrılır.
- Leaderboard psikolojik baskı yaratmaz; "en kötü çalışan" dili yasak; default private.
- Empty / loading / error state'leri her ekranda tasarlanır.

## Detailed specification

### Navigasyon (rol bazlı)
Sol panel rol'e göre filtrelenir; kullanıcı yalnız yetkili olduğu alanları görür (RLS ile uyumlu).

### Employee ekranları
- My Work Dashboard (özet: açık görevler, pending puan, tahmini prim, dönem geri sayımı)
- My Tasks (liste + filtre)
- Task Detail
- Submit Work (evidence/not)
- My Points + Point Breakdown ("neden bu puan?")
- My Estimated Bonus + Bonus Breakdown (tahmini etiketi)
- My Ranking / Percentile (anonim, sakin)
- My Disputes
- Notifications
- Profile / Privacy

### Manager ekranları
- Team Dashboard
- Assign Task
- Review Queue + Review Detail (approve/reject/needs_revision, quality/timeliness/collaboration)
- Team Points
- Fairness Warnings / Anomaly Flags (review queue)
- Dispute Inbox (kendi kararına final veremez uyarısı)
- Bonus Impact Preview

### HR ekranları
- Organization Dashboard
- Users & Teams
- Scoring Policies (+ Policy Version History)
- Bonus Periods (aç/kapat/lock)
- Bonus Pools
- Disputes (atama + çözüm)
- Fairness Analytics (temel)
- Audit Logs
- Privacy Center

### Finance ekranları
- Bonus Pool Approval
- Calculation Runs
- Allocation Snapshot (yalnız ödeme özeti — task/puan detayı yok)
- Payment Export
- Paid Status (mark paid)
- Clawback Review

### Auditor ekranları
- Audit Explorer
- Calculation Snapshots
- Policy Changes
- Export Logs
- Support Access Logs

### Açıklanabilirlik kalıbı
- Point Breakdown kartı: base_points + her çarpan (değer) + revision penalty + final.
- Bonus Breakdown kartı: approved_points → adjusted_score (faktör kırılımı) → raw_share → cap → final;
  T_org etkisi ve "tahmini/final" durumu açıkça.

### Leaderboard UX (Decision Lock D12)
- Yalnız 2 görünüm: personal progress + anonymized percentile / nearby range.
- Global public leaderboard yok.
- Pozitif, sakin dil; rumuz/avatar.

### State gereksinimleri
- Her liste/detay: loading skeleton, empty state (yönlendirici metin), error state (retry).
- Dönem kapanışı net görünür (banner/sayaç).
- Disputed/pending/approved rozetleri tutarlı renk/dil.

## Edge cases

- Henüz görev yok → empty state "ilk görevini bekliyorsun".
- Dönem henüz hesaplanmadı → estimated bonus "tahmini, dönem kapanınca kesinleşir".
- Eligible değil (15 gün) → bonus ekranında nazik açıklama, dispute linki.
- Veri erişim reddi (yetkisiz) → 403 friendly state (sızıntısız).

## Acceptance criteria

- Her rol yalnız yetkili ekranları görür (RLS ile birebir).
- Her puan/prim ekranı breakdown sunar.
- Estimated/final ayrımı her yerde net.
- Leaderboard 2 görünümle sınırlı ve privacy-first.
- Tüm ekranlarda empty/loading/error tanımlı.

## Test implications

- E2E: employee breakdown görüntüler; manager review yapar; HR dönem kapatır; finance export; auditor inceler.
- Erişim testi: yetkisiz ekran/route engellenir (UI + server).
- A11y: temel WCAG AA kontrolleri (kontrast, klavye, başlık hiyerarşisi).

## Open questions

- OQ-UX-1: i18n MVP'de Türkçe-only mu yoksa TR+EN mi? (Öneri: TR-only, altyapı i18n-ready.)
- OQ-UX-2: Manager "Bonus Impact Preview" gerçek snapshot öncesi tahmini mi gösterir? (Öneri: tahmini, net etiket.)
- OQ-UX-3: Privacy Center MVP'de hangi self-service hakları sunar (veri görüntüleme/itiraz)? (Öneri: görüntüleme + dispute linki.)
