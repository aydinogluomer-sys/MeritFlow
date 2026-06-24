# ADR-004 — Supabase RLS Strategy

## Status
Accepted (Decision Lock AD1, AD2)

## Context
Yetkilendirme client'a güvenilerek yapılamaz. Supabase RLS, tenant izolasyonu ve satır görünürlüğü için
birincil mekanizmadır; ancak kolon-seviyesi gizlilik (Finance) ve recursive RLS gibi tuzaklar vardır.

## Decision
Her tabloda RLS **ENABLED + FORCE**; her policy `organization_id = current_org()` ile başlar. Rol/izin
**DB'den** okunur (`memberships`/`role_permissions`); **JWT yalnız identity** (AD1). Helper'lar
`SECURITY DEFINER` + sabit search_path. Finance kolon gizliliği için dedicated `v_finance_*` view'lar.
comp audit maskeleme (AD3) uygulanır.

## Alternatives considered
- Yalnız uygulama katmanı authz: reddedildi (defense-in-depth gerekir).
- JWT claim'de rol taşımak: reddedildi (stale/manipülasyon riski — AD1).

## Consequences
- Güçlü tenant izolasyonu + satır gizliliği; kolon gizliliği view ile.
- Service role kullanan server fonksiyonları authz'i ayrıca doğrular.

## Risks
- Recursive RLS (membership) → SECURITY DEFINER ile kırılır.
- View bakımı yükü.

## Implementation notes
- `03_PERMISSION_RLS_STRATEGY` policy intent'leri; `security_invoker` view'lar.

## Test implications
- RLS negatif suite; JWT-bypass testi; Finance view kolon testi; comp audit testi (AD3).
