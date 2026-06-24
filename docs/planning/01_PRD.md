# 01 — Product Requirements Document (PRD)

## Purpose

MeritFlow MVP'sinin ürün gereksinimlerini, hedef kullanıcılarını, çözdüğü problemi, başarı
metriklerini ve kapsam sınırlarını tanımlamak. Bu doküman, alttaki tüm teknik spec'lerin
"neden" sorusunu yanıtlar.

## Scope

- Kapsam: MVP ürün tanımı (`02_MVP_SCOPE` + Decision Lock ile uyumlu).
- Kapsam dışı (MVP): payroll/vergi/SGK entegrasyonu, AI auto-scoring, mobil app, çok-ülkeli
  compliance, public global leaderboard, microservice, GNN, weekly/quarterly period.

## Assumptions

- `Assumption:` Birincil pazar Türkiye, KOBİ segmenti (10–250 çalışan).
- `Assumption:` İlk müşteriler tek-org (tek tenant) kullanımı yapacak; multi-org kullanıcı nadir ama desteklenir.
- `Assumption:` Bonus dönemleri aylık ve takvim ayına hizalı (örn. 1–30 Haziran).
- Bonus havuzu Finance tarafından dönem `open` iken girilir ve **period close/calculation öncesi kilitlenir** (Decision Lock AD10).

## Non-negotiable rules

- Sistem bir performans/prim aracıdır, bir gözetim aracı değildir.
- "Estimated bonus" hiçbir ekranda hak edilmiş/garanti edilmiş gibi gösterilemez.
- Her puan ve her prim açıklanabilir (breakdown) ve itiraz edilebilir olmalıdır.
- Default prim modeli Safe Pro-Rata'dır (Decision Lock D1).

## Detailed specification

### Problem
Şirketlerde görev takibi, performans puanı, prim hesabı ve yönetici onayı Excel + WhatsApp +
manuel rapor + kişisel inisiyatifle yürür. Sonuç: adaletsizlik, itiraz, kayırma, puan şişirme,
prim anlaşmazlıkları. MeritFlow bu akışı **şeffaf, denetlenebilir, adil ve açıklanabilir** kılar.

### Hedef kullanıcılar / Personas
| Persona | İhtiyaç (JTBD) |
| --- | --- |
| Owner | Org'u kurar, politikayı belirler, denetler. "Sistem adil ve denetlenebilir olsun." |
| Admin | Kullanıcı/takım/scoring policy taslağı yönetir. "Kurulumu hızlı yapayım." |
| HR | Dönem yönetir, dispute çözer, calculation approve eder. "Şeffaf ve savunulabilir süreç." |
| Finance | Pool oluşturur, export alır, paid işaretler. "Güvenli, denetlenebilir ödeme." |
| Manager | Görev atar/review eder, kalite verir. "Adil ve hızlı review." |
| Employee | Görev yapar, puanını/primini görür, itiraz eder. "Neden bu puanı/primi aldım?" |
| Auditor | Değiştirilemez izi inceler. "Her şeyin kanıtı olsun." |

Her membership için tek `primary_role` (Decision Lock AD2).

### MVP Feature Set
- Auth + organization oluşturma + kullanıcı davet.
- Roller: Owner, Admin, HR, Finance, Manager, Employee, Auditor (Decision Lock D4).
- Takım yönetimi.
- Görev: oluşturma → atama → teslim → review (approve/reject/needs_revision).
- Scoring policy (versiyonlu) + point ledger (append-only).
- Monthly bonus period + bonus pool + Safe Pro-Rata calculation + immutable snapshot.
- Employee bonus breakdown.
- HR bonus approval.
- Finance payout export + mark paid.
- Basic dispute (5 iş günü SLA, Decision Lock D9).
- Audit log (kritik aksiyonlar).
- 2 leaderboard görünümü (personal progress + anonymized percentile, Decision Lock D12).
- 5 deterministik anti-gaming flag (Decision Lock D5).
- `compensation_records` (cap kaynağı, Decision Lock D7 + AD6).

### Key user journeys (özet)
1. Manager görev oluşturur → atar → Employee teslim eder → Manager approve eder → puan ledger'a yazılır → Employee breakdown görür.
2. HR dönemi kapatır → sistem lock eder → calculation run + snapshot → HR approve → Finance export.
3. Employee sonuca itiraz eder → HR reviewer atar → karar → (gerekirse) ledger adjustment + recalculation snapshot.

### Success metrics (MVP)
- Dönem kapanışı %100 snapshot'lı tamamlanır.
- Her prim için breakdown görünür (açıklanabilirlik = %100).
- Cross-tenant veri sızıntısı = 0 (test ile kanıtlı).
- Dispute round-trip uçtan uca çalışır.
- Audit coverage = kritik aksiyonların %100'ü.

## Edge cases

- Dönemde hiç onaylı görev yoksa → Σadjusted = 0 → bonus dağıtımı yapılmaz (bkz. `05_BONUS_ENGINE_SPEC`).
- Tek eligible çalışan → tüm havuz (cap'e tabi) ona gider; cap bağlarsa residual undistributed.
- Çalışan dönemde 15 günden az çalıştı → not eligible (Decision Lock D10).
- Çalışanın geçerli cap basis'i yok → allocation `pending_missing_cap_basis`; export bloklanır (Decision Lock AD6).
- Org henüz hiç scoring policy yayınlamadı → görev approve edilemez (policy version zorunlu).

## Acceptance criteria

- PRD, `02_MVP_SCOPE` ve Decision Lock (D + AD) ile çelişmiyor.
- Tüm MVP feature'lar bir persona ihtiyacına ve bir teknik spec'e bağlanmış.
- Non-goals açıkça listelenmiş.

## Test implications

- Her ana user journey bir E2E test senaryosuna karşılık gelir (`10_TEST_STRATEGY`).
- Success metric "cross-tenant = 0" → zorunlu RLS negatif testleri.

## Open questions

- OQ-PRD-2: Davet edilen ama henüz katılmamış kullanıcı eligible sayılır mı? (Öneri: hayır.) — V1'e ertelenebilir.
