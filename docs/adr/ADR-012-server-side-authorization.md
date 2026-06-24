# ADR-012 — Server-Side Authorization

## Status
Accepted (Decision Lock AD1)

## Context
Client'a güvenilerek yapılan yetkilendirme manipüle edilebilir. JWT claim'inde taşınan rol; stale
(rol değişince geç güncellenir) ve sahtelenebilir bir source of truth oluşturur. Yetki kararı
güvenilir bir katmanda verilmelidir.

## Decision
Authorization **server-side + RLS** ile yapılır. Rol ve izinler **DB'den** (`memberships` /
`role_permissions` / RBAC kayıtları) okunur; **JWT yalnız identity** için kullanılır, authorization
source of truth **değildir** (AD1). Her Server Action / API, işlemi yapmadan önce DB tabanlı izinleri
doğrular; RLS ikinci savunma hattıdır (defense-in-depth). Service role kullanan fonksiyonlar RLS'i
bypass ettiğinden authz'i uygulama katmanında **ayrıca** doğrular.

## Alternatives considered
- JWT claim'de rol taşıyıp ona güvenmek: reddedildi (stale + manipülasyon riski).
- Yalnız uygulama katmanı authz (RLS'siz): reddedildi (tek hata noktası; tenant sızıntı riski).

## Consequences
- Rol değişimi bir sonraki yetki kontrolünde anında etki eder (stale yetki yok).
- İki katmanlı güvence (server check + RLS); client bypass denemeleri reddedilir.

## Risks
- Her istekte DB izin okuması maliyeti → stable helper + (V1) cache; ama otorite her zaman DB.

## Implementation notes
- `03_PERMISSION_RLS_STRATEGY` helper'ları (`has_role`, `has_permission`) DB lookup yapar; `SECURITY DEFINER`.
- Bkz. ADR-004 (RLS), ADR-014 (service role/secret).

## Test implications
- AD1: manipüle edilmiş JWT claim yetki kazandırmaz (authz DB'den).
- Client/route bypass denemesi server'da reddedilir; service role yolu authz'i tekrar doğrular.
