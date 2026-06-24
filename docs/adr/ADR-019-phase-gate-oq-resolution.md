# ADR-019 — Phase-Gate Open-Question Resolution (AD1–AD10)

## Status
Accepted (Decision Lock AD1–AD10)

## Context
Phase-gate sırasında planning QA, MVP'yi bloklayan 10 açık soru (OQ) tespit etti: RLS/rol kaynağı,
çoklu rol, compensation audit görünürlüğü, timeliness referansı, collaboration etkisi, eksik cap basis,
policy/factor lock, T_org=1.2 davranışı, çoklu takım ve bonus pool timing. Bunlar bir karar bütünü
olarak kilitlenmeden sonraki fazlara geçilemezdi.

## Decision
On açık soru `Additional Decision Lock — Phase-Gate OQ Resolution` (AD1–AD10) olarak kapatıldı:
- **AD1** authz DB'den, JWT yalnız identity (server-side + RLS).
- **AD2** membership başına tek `primary_role`; multi-role merge V1; gelirse explicit deny > allow.
- **AD3** comp audit: liste masked summary; raw payload yalnız HR/Finance/Auditor + gerekçe; erişim audit'li.
- **AD4** timeliness `submitted_at`'e göre; geç onay cezalandırmaz; son geçerli submission + revision history.
- **AD5** collaboration score puanı/primi etkilemez (V1 multiplier).
- **AD6** geçerli cap basis yoksa `pending_missing_cap_basis`; unlimited cap yok; export bloklanır.
- **AD7** scoring/bonus policy + tüm faktörler period başında kilitlenir, snapshot'a yazılır; silent mutation yasak.
- **AD8** `T_org=1.2` approved pool'u top-up onayı olmadan aşamaz.
- **AD9** her employee her period tek `primary_team` ile değerlendirilir; multi-team V1.
- **AD10** bonus pool calculation öncesi locked; değişiklik new version + audit + recalculation.

## Alternatives considered
- OQ'ları implementation'a bırakmak: reddedildi (faz-gate'i geçemez; tutarsızlık riski).
- Daha esnek (örn. silent unlimited cap, JWT-rol): reddedildi (güvenlik/finans/hukuk riski).

## Consequences
- MVP belirsizliği giderildi; ilgili spec'ler (03/04/05/06/10/12) AD'lerle hizalandı.
- Ertelenenler net V1 kapsamı: multi-role merge, collaboration multiplier, multi-team weighted factor.

## Risks
- AD'ler en kısıtlayıcı/güvenli yorumla uygulanır; çelişki olursa Decision Lock kazanır.

## Implementation notes
- Kaynak: `00_DECISION_LOCK.md` AD1–AD10; ilgili ADR'ler: 004/012 (AD1), 006/018 (AD3/AD6), 007 (AD8),
  scoring AD4/AD5 (`04`), bonus AD7/AD9/AD10 (`05`).
- **AD9 — primary team canonical source (Phase 3A kararı):** primary team'in **tek source of truth**'u
  `team_memberships.is_primary`'dir (partial unique: (`organization_id`,`profile_id`) where is_primary).
  `memberships` tablosu **`primary_team_id` taşımaz** ve ileride eklenmemelidir (duplicate source/drift
  önlemek için). Bonus tablolarındaki `primary_team_id`, bu kaynaktan **türetilmiş** snapshot'tır. Ayrıntı:
  doc 13 "Primary team model", doc 14 (memberships/team_memberships).

## Test implications
- Her AD ≥1 testle eşlenir (`10_TEST_STRATEGY`): JWT-bypass (AD1), comp audit (AD3), geç onay (AD4),
  collaboration-no-effect (AD5), eksik cap basis export bloğu (AD6), faktör lock (AD7), T_org=1.2 top-up
  (AD8), primary_team (AD9), pool lock→recalculation (AD10).
