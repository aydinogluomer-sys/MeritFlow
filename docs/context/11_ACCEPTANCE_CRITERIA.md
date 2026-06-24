# Acceptance Criteria

## Product Planning Acceptance

Plan kabul edilebilir sayılmak için şunları içermeli:

- PRD
- MVP/V1/V2 ayrımı
- User roles
- Permission matrix
- Domain model
- Task workflow
- Scoring engine
- Bonus engine
- Zero factor
- Malus/clawback
- Point ledger
- Bonus ledger
- Audit log
- Dispute workflow
- Anti-gaming strategy
- Leaderboard privacy model
- Database schema
- RLS strategy
- API/server action plan
- UI/UX screen plan
- Test strategy
- Implementation roadmap
- Open questions
- ADRs
- CLAUDE.md draft
- Claude skills
- Claude subagents

## Non-Negotiable Requirements

- Pure tournament model default olamaz.
- Employee monitoring yok.
- Puan client’tan alınamaz.
- Puan approved task üzerinden hesaplanır.
- Point ledger append-only olmalı.
- Bonus calculation snapshot immutable olmalı.
- RLS zorunlu.
- Cross-tenant access engellenmeli.
- Manual adjustment audit log ister.
- Dispute sistemi olmalı.
- Bonus breakdown açıklanabilir olmalı.
- Leaderboard privacy-first olmalı.
- Kodlama başlamadan önce plan onayı alınmalı.

## Test Requirements

- Business logic tests
- Permission tests
- RLS tests
- E2E tests
- Security tests
- Anti-gaming tests
- Bonus calculation tests
- Dispute flow tests

## Final Quality Gate

Claude'un üreteceği plan şu kontrolleri geçmelidir:

1. Ürün basit todo app gibi ele alınmamış olmalı.
2. Prim sistemi finansal/hukuki riskleriyle beraber düşünülmüş olmalı.
3. RLS ve multi-tenant güvenlik geçiştirilmemiş olmalı.
4. Bonus calculation snapshot zorunlu tutulmuş olmalı.
5. Puan mutable toplam alan olarak değil ledger üzerinden modellenmiş olmalı.
6. Leaderboard çalışanı utandıran bir yapıya dönüşmemeli.
7. Anti-gaming sistemi otomatik ceza değil, flag/review/dispute akışıyla tasarlanmalı.
8. MCP/tool kullanımı minimum privilege prensibine bağlanmalı.
9. MVP ve enterprise architecture ayrı değerlendirilmiş olmalı.
10. Kodlama yapılmadan önce açık plan ve acceptance criteria üretilmiş olmalı.
