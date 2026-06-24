# ADR-014 — MCP & Tooling Security

## Status
Accepted

## Context
Ajan/otomasyon araçları (MCP sunucuları, CI, secret'lar) güçlü erişimler sağlar. Yanlış yapılandırma;
production veri kaybı, secret sızıntısı veya yetkisiz mutation riskleri üretir. Özellikle Supabase MCP
ve service role anahtarı yüksek risklidir.

## Decision
- **Minimum privilege** her araç için varsayılan.
- GitHub MCP **read-only** başlar; yazma yetkisi yalnız açık ihtiyaçla ve sınırlı.
- **Supabase MCP production'a yasak**; yalnız staging/dev'de kullanılır.
- **Service role key** environment secret'tır; client bundle'a **girmez**, loglanmaz, asla client'a sızdırılmaz.
- Playwright yalnız E2E için.
- MCP secret/token kullanımı audit'lenir; Context7 tek doğruluk kaynağı değildir.

## Alternatives considered
- MCP'ye geniş yetki vermek: reddedildi (üretim riski, yanlış mutation).
- Supabase MCP'yi production'da kullanmak: reddedildi (geri alınamaz veri riski).

## Consequences
- Otomasyon güçlü ama sınırlı/denetlenebilir; production veri bütünlüğü korunur.
- Secret sızıntısı yüzeyi daraltılır (env-only, log-free).

## Risks
- Yanlışlıkla prod credential MCP'ye verilmesi → policy + checklist + audit ile engellenir.

## Implementation notes
- CLAUDE.md "MCP / tooling rules" ile birebir; secret yönetimi env üzerinden; bkz. ADR-012/ADR-004.

## Test implications
- Client bundle taramasında service role / secret bulunmaz.
- Supabase MCP prod erişim denemesi engellenir (policy); MCP secret kullanımı audit üretir.
