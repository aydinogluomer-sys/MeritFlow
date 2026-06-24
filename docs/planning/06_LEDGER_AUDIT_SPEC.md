# 06 — Ledger & Audit Spec (DEEP)

## Purpose

Üç defteri birbirinden kesin biçimde ayırmak ve her birinin garantilerini tanımlamak:
(1) **Point Ledger** (puan, single-entry, append-only), (2) **Bonus Ledger** (para, double-entry),
(3) **Audit Log** (yetkili aksiyonların değiştirilemez kaydı). Bu doküman "puan ve para mutable
toplam alanlarda değil ledger/snapshot'ta yaşar" ilkesini somutlaştırır.

## Scope

- Kapsam: üç defterin şeması (kavramsal alanlar), event türleri, invariant'lar, reversal/adjustment
  kalıpları, audit zorunluluk listesi, compensation-sensitive audit maskeleme.
- Kapsam dışı: hesaplama matematiği (`04`/`05`), RLS (`03`).

## Assumptions

- `Assumption:` Para her zaman integer minor unit (kuruş) ve `currency` ile saklanır.
- `Assumption:` Point ledger puanları numeric (ondalık) saklar.
- `Assumption:` Tüm ledger yazımları transaction içinde, ilgili audit_log ile birlikte atomik yapılır.

## Non-negotiable rules

- Point ledger ve Bonus ledger **karıştırılmaz** (puan ≠ para).
- Hiçbir ledger satırı UPDATE/DELETE edilmez. Düzeltme yalnız yeni **reversal/adjustment** satırıdır.
- Bonus calculation snapshot olmadan final allocation/accrual üretilemez.
- Manual adjustment, bonus approval, dispute decision, payout export için **audit log zorunlu**
  (ayrıca: role/permission change, scoring/bonus policy change, calculation run, period lock/unlock,
  support access, user deactivation, comp access/change).
- Compensation-sensitive audit: employee comp payload göremez; liste masked summary; raw payload yetki+gerekçe ile (Decision Lock AD3).
- Audit silinmez; düzeltme append-only.

## Detailed specification

### 1. Point Ledger (single-entry, append-only)
Neden single-entry: puan korunan/transfer edilen bir miktar değildir; **kazanılır**. Çift kayıt
gerektiren bir "kaynaktan hedefe transfer" yoktur.

Alanlar (kavramsal):
`id, organization_id, employee_id, task_id?, bonus_period_id?, event_type, points_delta numeric,
reason, scoring_policy_version_id?, created_by, created_at, metadata jsonb`.

Event types (context `00 §7.1`):
`task_submitted` (puan vermez, iz), `task_approved` (kazanç), `task_rejected` (0),
`quality_multiplier_applied`, `timeliness_bonus_applied`, `revision_penalty_applied`,
`manual_adjustment`, `dispute_adjustment`, `reversal`, `anomaly_hold`, `anomaly_released`,
`period_locked`.

> MVP sadeleştirmesi: çarpan/penalty ayrı event yerine `task_approved` entry'sinin `metadata`'sında
> breakdown olarak saklanır (tek kazanç satırı). `manual_adjustment`, `dispute_adjustment`, `reversal`
> ayrı satırlardır.

Kurallar:
- `task_approved` idempotent: task başına bir kazanç satırı.
- Çalışanın dönem toplam puanı = ilgili period satırlarının `points_delta` toplamı (türev, cache değil source).
- Düzeltme: orijinali silme yerine `reversal` (negatif delta) + gerekiyorsa yeni `adjustment`.
- UPDATE/DELETE policy yok → DB seviyesinde imkânsız.

Invariants:
- PL-1: satır immutable.
- PL-2: period `locked` + onaylı snapshot varken o döneme yeni kazanç satırı eklenemez (yalnız
  dispute → `dispute_adjustment`, ve bu yeni calculation run tetikler).

### 2. Bonus Ledger (double-entry, money)
Neden double-entry: para korunan bir büyüklüktür; her hareket dengeli olmalı ve toplamlar
mutabakat (reconciliation) vermelidir. Σdebit = Σcredit invariant'ı yanlış/eksik ödemeyi yakalar.

Hesaplar (accounts):
- `pool` (org bonus havuzu)
- `accrual` (çalışan hak edişi, henüz ödenmemiş)
- `payout` (ödenmiş / dışa aktarılmış)
- `clawback` (geri alım)

Alanlar (kavramsal):
`id, organization_id, employee_id?, bonus_pool_id, calculation_run_id?, snapshot_id?, entry_type
(debit|credit), account, event_type, amount_minor bigint, currency, reason, created_by, created_at,
metadata jsonb`.

Event types (context `00 §7.2`):
`bonus_accrual`, `bonus_calculation_snapshot` (bağlantı), `bonus_approved`, `payout_exported`,
`payout_marked_paid`, `clawback_pending`, `clawback_approved`, `reversal`.

Tipik dengeli hareketler:
| Olay | Debit | Credit |
| --- | --- | --- |
| HR snapshot approve (accrual) | pool | accrual(employee_i) |
| Payout marked paid | accrual(employee_i) | payout(employee_i) |
| Clawback approved | clawback / accrual | (ters yönde dengeli reversal) |

Kurallar:
- Her calculation run için Σdebit = Σcredit (run bazında dengeli).
- Accrual yalnız **approved snapshot**'tan üretilir (snapshot_id zorunlu).
- `pending_missing_cap_basis` allocation'ları çözülmeden ilgili payout export üretilmez (Decision Lock AD6).
- Düzeltme = `reversal` (dengeli ters kayıt), satır silinmez.
- Clawback otomatik değil: `clawback_pending` → HR/Finance/Legal approval → `clawback_approved` +
  reversal entry + dispute hakkı (Decision Lock D2).

Invariants:
- BL-1: satır immutable.
- BL-2: Σ(accrual credits) ≤ pool (snapshot ile tutarlı; undistributed_remainder pool'da kalır).
- BL-3: payout yalnız accrual'ı olan çalışana; payout ≤ accrual.
- BL-4: her money mutation bir audit_log üretir.

### 3. Audit Log (append-only)
Alanlar (kavramsal):
`id, organization_id, actor_id, action, target_type, target_id, before jsonb, after jsonb, reason,
request_context (ip/agent opsiyonel), created_at`.

Zorunlu audit'lenen aksiyonlar (context `00 §7.3` + `07` + AD'ler):
scoring policy change, task point override, task approval/rejection, manual point adjustment,
bonus pool creation, bonus pool approval/lock, bonus calculation run, bonus period lock/unlock,
dispute decision, export generation, role/permission change, user deactivation, RLS/policy change,
support access, integration token change, **compensation record access/change** (AD3).

Compensation-sensitive audit (Decision Lock AD3):
- Liste/özet görünümü: `action, actor, target, timestamp, masked summary` (raw comp değeri görünmez).
- Raw `before/after` compensation payload yalnız `comp.read` yetkisi (HR/Finance/Auditor) + **gerekçeli erişim** ile.
- Employee comp audit payload'ı **hiç göremez**.
- Bu raw erişimlerin **kendisi** ayrıca audit log'a düşer (erişim audit'i).

Kurallar:
- Silme yok; düzeltme append-only.
- `before/after` snapshot ile "ne değişti" görünür (comp alanları maskeli — AD3).
- Auditor full read; Finance financial subset; diğerleri ilgili scope.

### 4. Ledger ↔ Snapshot ilişkisi
- Calculation run → immutable allocation snapshot (puan + faktörler dondurulur — AD7).
- HR approve → bonus ledger `bonus_accrual` (para tarafı başlar; `pending_missing_cap_basis` hariç).
- Finance export → `payout_exported`; mark paid → `payout_marked_paid`.
- Dispute kabul → point ledger `dispute_adjustment` → yeni calculation run → yeni snapshot →
  (gerekirse) bonus ledger reversal + yeni accrual.

## Edge cases

- **Yanlış manuel adjustment:** reversal + doğru adjustment; orijinal kalır (iz).
- **Çift accrual denemesi:** snapshot_id idempotency → ikinci accrual reddedilir.
- **Payout export sonrası dispute:** yeni run; fark için bonus ledger reversal + yeni accrual; ödenmiş
  tutar > yeni hak ediş ise clawback workflow (otomatik kesinti yok).
- **Period unlock:** yalnız HR + audit; onaylı snapshot varsa unlock allocation'ı geçersiz kılmaz,
  yeni run gerektirir.
- **Comp audit'e yetkisiz erişim:** reddedilir; deneme audit'lenir (AD3).
- **Currency uyumsuzluğu:** tek org tek currency (`Assumption`); çoklu currency V1+.

## Acceptance criteria

- Point ledger ve bonus ledger ayrı tablolar; hiçbir satır UPDATE/DELETE edilemiyor.
- Her money hareketi dengeli (Σdebit=Σcredit) ve audit'li.
- Accrual yalnız approved snapshot'tan üretiliyor; `pending_missing_cap_basis` export'u bloklanıyor (AD6).
- Tüm zorunlu aksiyonlar audit üretiyor; audit silinemiyor.
- Comp audit maskeleme uygulanıyor; raw payload yalnız yetki+gerekçe ile; erişim audit'leniyor (AD3).
- Çalışan toplam puanı/primi ledger/snapshot'tan türetiliyor (mutable total alan yok).

## Test implications

- Append-only testi: ledger UPDATE/DELETE reddedilir.
- Reversal testi: yanlış adjustment reversal ile düzeltilir, orijinal korunur.
- Double-entry denge testi: her run Σdebit=Σcredit.
- Accrual idempotency testi (snapshot_id).
- AD3 testi: employee comp audit payload göremez; raw payload yetki+gerekçe ile; erişim audit üretir.
- AD6 testi: `pending_missing_cap_basis` varken payout export bloklanır.
- Audit coverage testi: her zorunlu aksiyon → tam bir audit satırı (before/after dahil, comp maskeli).
- Snapshot→accrual→payout zinciri E2E testi.

## Open questions

- OQ-LA-2: Point ledger çok büyürse partition stratejisi (period bazlı) ne zaman gerekir? (V1 performans.)
- OQ-LA-3: Bonus ledger "cash/payout" tarafının gerçek banka entegrasyonu olmadığından `payout_marked_paid` manuel; mutabakat raporu MVP'de mi? (Öneri: basit export + manuel mark.)
