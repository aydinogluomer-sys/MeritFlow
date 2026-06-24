# 10 — Test Strategy

## Purpose

MeritFlow MVP için, her güvenlik kuralı ve her kritik iş kuralının testle kanıtlandığı bir test
stratejisi tanımlamak. Test dosyaları bu fazda **yazılmaz**; bu doküman test kapsamını ve
senaryolarını planlar.

## Scope

- Kapsam: business-logic, permission/RLS, anti-gaming, bonus calculation, dispute, E2E, security test kategorileri + Decision Lock (D + AD) eşlemesi.
- Kapsam dışı: load/performance test detayı (V1), test implementasyonu.

## Assumptions

- `Assumption:` Unit/integration için Vitest, E2E için Playwright (context stack).
- `Assumption:` RLS testleri gerçek Postgres (staging/dev) üzerinde, rol bazlı bağlantılarla çalışır.

## Non-negotiable rules

- Cross-tenant ve self-approval testleri **bloklayıcı**; geçmeden ilgili modül "done" değil.
- Her Decision Lock kararı (D1–D12 + AD1–AD10) en az bir teste bağlanır.
- Business logic testsiz merge edilmez.

## Detailed specification

### 1. Business logic tests
- task submitted → final puan vermez.
- task approved → tam bir point ledger entry.
- task rejected → puan yok.
- quality=poor → approve reddedilir (D3).
- policy version locked after period start (değişmez — AD7).
- manual override → reason zorunlu + audit + ayrı entry.
- period lock → mutation engellenir.
- dispute adjustment → ledger entry + yeni snapshot.
- bonus calculation → immutable snapshot (faktörleri kaydeder — AD7).
- Σadjusted=0 → dağıtım yok.
- T_org=0 → payout yok.
- cap applied → allocation cap'i aşmaz; cap residual undistributed (D6).
- quality threshold uygulanır.
- rounding doğru (kuruş, largest-remainder, tie-break employee_id) + `09` worked example.
- clawback → approval gerektirir (otomatik kesinti yok — D2).
- scoring determinizm (sabit girdi → sabit çıktı).
- approve idempotency (çift approve → tek kazanç).
- bonus calculation idempotency (çift run → tek snapshot).

### 2. Permission / RLS tests
- employee ≠ başka employee bonus/point satırı.
- employee ≠ kendi görevini approve.
- manager ≠ HR-approved bonus pool düzenleme.
- finance ≠ task score / raw points / comp (view-only).
- auditor read-only (her write reddedilir).
- cross-tenant access engellenir (her tablo için).
- service role client-side expose edilmez.
- support access yalnız aktif grant ile + audit.
- compensation_records: yalnız HR/Finance min yetki; employee göremez (D7).
- **AD1:** JWT claim manipülasyonu yetki kazandırmaz (authz DB'den).
- **AD2:** her membership tek primary_role; (multi-role gelirse explicit deny > allow).
- **AD3:** employee comp audit payload göremez; raw comp payload yalnız yetki+gerekçe ile; erişim audit üretir.

### 3. Anti-gaming tests (5 kural)
- self-approval blocked (hard).
- duplicate task flag (pozitif/negatif).
- tiny-task splitting flag.
- same-reviewer concentration flag.
- period-end spike flag.
- confirmed flag otomatik ceza üretmez.

### 4. Bonus calculation tests
- worked example (`09`) birebir.
- Σfinal + undistributed_remainder = pool.
- cap'li / cap'siz / T_org'lu / tek-eligible / herkes-cap senaryoları.
- eligibility 15 gün eşiği + proration cap (D10).
- **AD6:** cap basis yok → `pending_missing_cap_basis`; export bloklanır; unlimited cap yok.
- **AD7:** snapshot tüm faktörleri içerir; period lock sonrası faktör değişmez.
- **AD8:** T_org=1.2 + top-up yok → distributable = approved pool; top-up var → 1.2 uygulanır.
- **AD9:** team_factor primary_team'den.
- **AD10:** pool locked before calculation; lock sonrası değişiklik new version + recalculation gerektirir.

### 5. Scoring timeliness/collaboration tests
- **AD4:** geç manager onayı timeliness'i düşürmez (submitted_at baz); needs_revision sonrası son submission baz alınır.
- **AD5:** farklı collaboration_score aynı final_points üretir.

### 6. Dispute flow tests
- open → assign(HR) → resolve.
- manager kendi kararına final veremez (D9).
- accepted-puan → ledger adjustment; accepted-prim → yeni snapshot.
- SLA due_at + aşım eskalasyonu (5 iş günü — D9).

### 7. E2E tests
- employee submits → manager approves → points appear.
- monthly period closes → bonus calculation generated.
- employee views bonus breakdown.
- employee opens dispute → HR resolves → recalculation snapshot.
- finance exports payout → mark paid.
- auditor reviews audit trail.

### 8. Security tests
- RLS negatif suite (yukarıdaki #2).
- authz server-side enforcement (client/JWT bypass denemesi reddedilir — AD1).
- audit coverage: her zorunlu aksiyon audit üretir (comp maskeli — AD3).
- secret/service-role sızıntı kontrolü (client bundle taraması).

## Edge cases

- Boş dönem (görev yok) E2E.
- Çoklu-org kullanıcı bağlam testi.
- Period unlock sonrası recalculation tutarlılığı.
- cap basis sonradan tamamlanınca export açılması (AD6).

## Acceptance criteria

- Her Decision Lock kararı (D + AD) ≥1 testle eşlenmiş.
- Cross-tenant + self-approval suite yeşil olmadan release yok.
- `09` worked example otomatik testle reproduce ediliyor.
- Audit coverage testi tüm zorunlu aksiyonları kapsıyor (comp maskeli).

## Test implications

- Bu doküman test envanterinin kaynağıdır; implementation fazında test ID'lerine dönüştürülür.

## Open questions

- OQ-TS-1: RLS testleri için ayrı test tenant seed seti otomatik mi üretilir? (Öneri: evet, seed script.)
- OQ-TS-2: Performance/load testleri MVP'de hangi eşikte gerekir? (Öneri: V1; MVP'de yalnız temel index doğrulama.)
