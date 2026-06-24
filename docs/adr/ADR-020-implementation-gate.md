# ADR-020 — Implementation Gate

## Status
Accepted

## Context
MeritFlow finansal ve hukuki sonuç doğuran bir sistemdir; planlama tamamlanmadan veya açık onay
olmadan koda geçmek; yanlış varsayımların kalıcılaşması ve güvenlik/uyum ihlali riski taşır. Kullanıcı,
implementation'ı açık bir kapıya bağlamıştır.

## Decision
- Implementation **yalnız** kullanıcı tam olarak **`implementation authorized`** dediğinde başlar.
- İzin verilse bile izin **faz-sınırlıdır**: yalnızca onaylanan faz için geçerlidir; sonraki faz **yeni
  onay** ister.
- Kod yazmadan önce **ilgili planning dokümanı ve ADR okunur** (before-coding checklist).
- Bu kapı aşılmadan kod, migration, component, API veya test **implementasyonu** üretilmez (planning/
  doküman üretimi serbesttir).

## Alternatives considered
- Plan onaylanınca tüm fazlara serbest implementation: reddedildi (faz-sınırlı kontrol kaybı).
- İzni opsiyonel/ima edilmiş saymak: reddedildi (açık, tam ifade zorunlu).

## Consequences
- Her faz öncesi bilinçli bir onay kapısı; kapsam kayması (scope creep) engellenir.
- Planlama artefaktları (Decision Lock, spec'ler, ADR'ler) implementation'ın ön koşuludur.

## Risks
- Onay kapısı hızı yavaşlatabilir → net faz tanımları + roadmap (`12`) ile akış hızlandırılır.

## Implementation notes
- CLAUDE.md "Non-negotiable rules" + before/after-coding checklist; `12_IMPLEMENTATION_ROADMAP` fazları.
- Mevcut durum: implementation **gated** (henüz `implementation authorized` verilmedi).

## Test implications
- Doğrudan test edilen bir runtime davranışı değildir; süreç/governance kuralıdır.
- Dolaylı: her fazın acceptance + test kriteri (`10`/`12`) o faz "done" tanımını yönetir.
