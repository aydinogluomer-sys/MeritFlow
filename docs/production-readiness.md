# Production Readiness — Kalan Görevler

MeritFlow Engineering Maturity **00→12 kod-complete ve CI-yeşil**. ENGINEERING-12'nin DoD'u
ise *operasyonel kanıt* ister (gerçek restore drill, PITR, tetiklenmiş alert, rotation drill,
deletion-verification + hukuk imzası). Bu dosya o kalan operasyonel işlerin tek-bakış takibidir;
kanıt tablosu [docs/runbooks/README.md](runbooks/README.md) checklist'i + ilgili runbook'ların
evidence bölümleridir.

## Durum özeti

| Alan | Durum | Kim |
| --- | --- | --- |
| Branch protection — 7 required check (lint/typecheck/unit/migration-lint/db/build/e2e) | ✅ Aktif | Sen |
| GitHub `production` Environment — 3 secret eklendi | ✅ | Sen |
| `actions/checkout` + `setup-node` → v5 (Node 20 deprecation) | ✅ | Agent (`7c7027f`) |
| Gated prod migration — ilk gerçek `deploy.yml` çalıştırması | ⏳ Kurulum tam; ilk dry-run/push bekliyor | Sen |
| Restore drill | ❌ Blocked (Supabase local stack 5 unhealthy container) | Agent (Docker hazır olunca) |
| PITR doğrulama | ⏭️ Free plan — Pro'ya geçince | Sen |
| Alerting (Sentry) | ❌ Yapılmadı | Agent (DSN sen) + Sen |
| Credential rotation drill | ❌ Yapılmadı | Sen |
| Deletion dry-run + legal imza | ❌ Yapılmadı | Agent (script) + Sen |
| SLO dashboard | ❌ Yapılmadı (alerting'e bağlı) | Sen |

> **Gated prod migration — evidence:** her `deploy.yml` çalıştırması
> [runbooks/deploy-evidence.md](runbooks/deploy-evidence.md)'ye kaydedilir. Workflow sonundaki
> **"Evidence summary"** adımı (run_id · triggered_by · timestamp · apply · outcome) kopyalanabilir
> bir satır basar (job log + run step-summary sayfası).

---

## 1. Restore Drill

**Durum:** ❌ Blocked
**Neden blocked:** `npx --no-install supabase start` exit 1 — 5 container unhealthy
(`analytics`, `realtime`, `storage`, `pg_meta`, `studio`); stack ayağa kalkmıyor.
**Önkoşul:** Docker Desktop yeniden başlatılmalı (kaynak/health sorunu), sonra stack healthy.

**Adımlar:**

1. Docker Desktop'ı yeniden başlat.
2. `npx --no-install supabase start` → exit 0 + healthy stack beklenir.
3. `bash scripts/restore-drill.sh` — fresh-stack drill: `db reset` (tüm migration + seed) →
   schema drift → **pgTAP** (0030 reconciliation invariants + 0031 migration integrity + tam suite).
   Tam çıktıyı kaydet.
4. (Opsiyonel) Bonus-ledger balance invariant'ı ayrıca doğrulamak için bir dump gerekir:
   `bash scripts/restore-drill.sh --dump <dosya.sql>`. **Not:** dosyasız `--dump` fresh-stack
   drill'e düşer (script davranışı); balance-check yalnızca gerçek bir dump dosyasıyla çalışır.
   Fresh-stack pgTAP zaten reconciliation/ledger invariant'larını (0030/0016) kapsar.
5. Evidence yaz:
   - **Ana tablo:** [disaster-recovery.md](runbooks/disaster-recovery.md) §6 — Tarih · Operatör ·
     Senaryo · RTO · RPO · Reconciliation · pgTAP integrity · Sign-off.
   - **Checklist:** [runbooks/README.md](runbooks/README.md) "Backup + PITR / restore drill" satırı.
   - Alanlar: tarih, migration sayısı (37 beklenir), drift sonucu (OK), pgTAP pass/total, balance
     check (dump verildiyse), RTO (drill süresi).

**Kim yapar:** Agent (Docker hazır olunca).
**Commit:** `disaster-recovery.md` §6 + `README.md` evidence satırları → commit (senin onayınla).

---

## 2. PITR Doğrulama

**Durum:** ⏭️ Free plan — ertelendi
**Ne zaman:** Supabase Pro'ya geçilince (PITR Pro+ özelliğidir).
**Adım:** Supabase dashboard → Settings → Database → Backups → PITR aktif mi doğrula; retention
penceresini not et. Ardından bir restore'u **gerçek bir timestamp'e** geri alarak
[disaster-recovery.md](runbooks/disaster-recovery.md) §4 drill'ini bulut hedefte çalıştır.

**Kim yapar:** Sen (dashboard erişimi gerekli).

---

## 3. Alerting (Sentry)

**Durum:** ❌ Yapılmadı

> **Kod gerçeği (önemli):** Uygulama `SENTRY_DSN`'i **server-only** okur (`instrumentation.ts`,
> `src/instrumentation.ts`, `src/lib/logger/capture.ts`, `src/lib/env.ts`). `NEXT_PUBLIC_SENTRY_DSN`
> DEĞİL — SI-11 gereği DSN client bundle'a girmez. Ayrıca Sentry bugün **no-op**: `@sentry/nextjs`
> Next 16'yı desteklemiyor. Aktif yol: `captureServerError` (ENGINEERING-04) `@sentry/node`'u
> DSN varsa dinamik import eder.

**Adımlar:**

1. sentry.io → yeni proje (Platform: **Node** veya Next.js) → DSN al.
2. **SDK ön koşulu:** ya Next-16-uyumlu `@sentry/nextjs` kur, ya da `@sentry/node` ekle (böylece
   `captureServerError`'ın dinamik import yolu çalışsın).
3. Env (server-only): `SENTRY_DSN=...` (+ opsiyonel `SENTRY_ENV=production`). `.env.local`'e
   ekle; Vercel **production** → Environment Variables'a aynı key'i ekle. `NEXT_PUBLIC_` kullanma.
4. Test hatası tetikle: bir Server Action / route handler içinde `throw new Error('sentry-test')`
   (INTERNAL DomainError / unhandled server error → `captureServerError` tetiklenir).
5. Sentry dashboard'da event/alert'in geldiğini doğrula → ekran görüntüsü al.
6. Uptime monitörü + reconciliation-CRITICAL alert'i de kur ([slo.md](runbooks/slo.md) §4-5).
7. Evidence: [slo.md](runbooks/slo.md) §6 + [README.md](runbooks/README.md) "Alerting live" satırı.

**Kim yapar:** Agent (DSN + Vercel key'i sen sağla; kod tarafı: SDK kurulumu + tetikleyici) + Sen
(Sentry dashboard doğrulama).

---

## 4. Credential Rotation Drill

**Durum:** ❌ Yapılmadı

**Evidence log:** [runbooks/rotation-evidence.md](runbooks/rotation-evidence.md) (özel).
**Script:** `scripts/credential-rotation-drill.sh` — dry-run checklist (`STAGING_CONFIRMED=1 bash
scripts/credential-rotation-drill.sh`) veya `--apply` ile adım-adım yönlendirme; hiçbir secret'ı
okumaz/loglamaz (SI-11).

**Adımlar:**

1. Supabase dashboard → Settings → Database → **Reset database password** → yeni şifre al.
2. GitHub → Settings → Environments → `production` → `SUPABASE_DB_PASSWORD` secret'ını güncelle.
3. `deploy.yml`'i **dry-run** ile tetikle (`workflow_dispatch`, `apply=false`) → `supabase db push
   --dry-run` başarılı mı doğrula (yeni şifreyle link + preview çalışıyor).
4. Eski şifrenin artık çalışmadığını teyit et (rotation ancak yeni key kullanıldı + eski öldü diye
   kanıtlanır — [incident-response.md](runbooks/incident-response.md) §4).
5. Evidence: [incident-response.md](runbooks/incident-response.md) §6 + [README.md](runbooks/README.md)
   "Credential rotation drill" satırı.

**Kim yapar:** Sen (canlı credential — agent erişemez / SI-11).

---

## 5. Deletion Dry-Run + Legal İmza

**Durum:** ❌ Yapılmadı

**Script:** `scripts/deletion-dry-run.sh` (staging/local only — `STAGING_CONFIRMED=1` +
`TARGET_DB_URL` zorunlu; prod-benzeri URL `PRODUCTION_OVERRIDE=yes` ister). Ledger/audit/snapshot
**asla silinmez** (yalnız sayılır + uyarılır).
**Evidence konumu:** [data-lifecycle.md](runbooks/data-lifecycle.md) §7 (drill evidence) + §8
(legal/HR/finance sign-off checklist); doğrulama §6. **`--apply` bir non-dev DB'de çalıştırılmadan
önce §8 sign-off checklist'i tamamlanmış olmalıdır.**

> **Kapsam notu:** Yıkıcı silme **kod olarak yok** (bilinçli — KVKK legal-review + append-only
> ledger/audit; [data-lifecycle.md](runbooks/data-lifecycle.md)). Bu bir *prosedür* dry-run'ıdır.

**Adımlar:**

1. Supabase **staging**'de bir test org/kullanıcı oluştur.
2. Soft-delete: üyeliği `deactivated` yap / org'u pasif işaretle; erişimin kesildiğini doğrula.
3. Finansal güvenlik kontrolü: açık dönem / un-exported-un-paid payout / açık dispute yok;
   reconciliation temiz ([data-lifecycle.md](runbooks/data-lifecycle.md) §5).
4. Hard-delete/anonymization simülasyonu: silinebilir sınıfları say → sil/anonimleştir → doğrula;
   ledger/audit (immutable) korunuyor ([data-lifecycle.md](runbooks/data-lifecycle.md) §6 checklist).
5. KVKK / veri saklama politikasını (retention süreleri) hukuk/HR/finans'a sun → **imza**.
6. Evidence: [data-lifecycle.md](runbooks/data-lifecycle.md) §6 + [README.md](runbooks/README.md)
   "Deletion-verification" satırı.

**Kim yapar:** Agent (staging script/sorgular) + Sen (legal imza, canlı staging).

---

## Sıradaki Adım

1. **Docker Desktop yeniden başlat** → Restore Drill (Madde 1) agent tarafından yapılabilir hale gelir.
2. Paralelde **Sentry DSN temin et** (Madde 3) → alerting kurulabilir.
3. Rotation (Madde 4) ve Deletion dry-run (Madde 5) senin canlı erişimini gerektiriyor; PITR
   (Madde 2) Pro'ya geçince.

Tüm satırlar kanıtlanınca ENGINEERING-12 tam "done" olur ve **Product Management fazı** başlar.
