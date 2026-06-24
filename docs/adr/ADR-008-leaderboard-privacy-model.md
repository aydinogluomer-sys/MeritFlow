# ADR-008 — Leaderboard Privacy Model

## Status
Accepted (Decision Lock D12)

## Context
Gamification motivasyon sağlar ama public/teşhir edici leaderboard; psikolojik baskı, "en kötü
çalışan" damgalaması ve KVKK/iş hukuku riskleri üretir. MeritFlow çalışanı baskılamayan, privacy-first
bir model hedefler.

## Decision
MVP'de yalnız **2 leaderboard görünümü** sunulur:
1. **Personal progress** (kişinin kendi ilerlemesi/trendi).
2. **Anonymized percentile / nearby range** (rumuz/avatar ile, anonim yüzdelik veya yakın aralık).

Global public leaderboard **yoktur**; "en kötü çalışan" dili yasaktır; default private. Gelişmiş
leaderboard türleri V1+.

## Alternatives considered
- Public ranked leaderboard: reddedildi (shaming, baskı, hukuki risk — `07` forbidden features).
- Leaderboard'u tamamen kaldırmak: reddedildi (pozitif motivasyon değeri var; anonim form korunur).

## Consequences
- Rekabet pozitif/sakin çerçevede kalır; bireysel kıyas teşhir edilmez.
- Sıralama verisi anonimleştirilerek sunulur (rumuz/avatar; isim ifşası yok).

## Risks
- Küçük takımda "nearby range" dolaylı kimlik ifşası → eşik/aralık genişliği ile k-anonimlik korunur.

## Implementation notes
- `09_UI_UX_INFORMATION_ARCHITECTURE` leaderboard UX kuralları; pozitif dil; default private.

## Test implications
- Yalnız 2 görünüm mevcut; public global leaderboard route yok.
- Anonimlik testi: başka çalışanın ham puanı/ismi sızmaz; küçük grup k-anonimlik kontrolü.
