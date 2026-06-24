# ADR-016 — Legal, Privacy & Ethical Guardrails

## Status
Accepted (Decision Lock D8)

## Context
Sistem ücret/prim sonuçlarını etkiler ve çalışan verisi işler. Türkiye'de KVKK ve iş hukuku;
gözetim, otomatik karar ve compensation şeffaflığı açısından ciddi yükümlülükler getirir. Yazılım
hukuki danışmanlığın yerine geçemez.

## Decision
- **Forbidden:** ekran/keystroke/mouse/kamera/mikrofon/GPS izleme, gizli gözetim, incelemesiz otomatik
  ceza, public-shaming leaderboard, gizli prim formülü, sessiz dönem sonu policy değişimi.
- **Privacy ilkeleri:** data minimization, purpose limitation, role-based visibility, right to
  explanation, auditability, export logging, limited retention, support access approval, tenant isolation.
- KVKK / Türkiye iş hukuku konuları **legal-review item**'dir; kesin hukuki hüküm verilmez, uzman
  (legal/HR/finance) onayı production öncesi gereklidir.
- Prim **"takdiri/koşullu"** çerçevelenir; "estimated ≠ vested" her yerde açıktır.

## Alternatives considered
- Üretkenlik gözetimi eklemek: reddedildi (yasak; etik/hukuki risk).
- Hukuki sorumluluğu yazılıma yüklemek: reddedildi (yazılım danışmanlık yerine geçmez).

## Consequences
- Şeffaf hesaplama + dispute + immutable kayıt; gözetimsiz tasarım.
- Production öncesi legal/HR/finance onayı bir kapıdır.

## Risks
- Yargısal yorum değişebilir → legal-review item listesi güncel tutulur; çerçeveleme dili korunur.

## Implementation notes
- `07_SECURITY_PRIVACY_GUARDRAILS` (context) + CLAUDE.md "Privacy / Legal / Ethical guardrails".
- Compensation görünürlüğü ADR-018; audit maskeleme ADR-006/AD3.

## Test implications
- Yasak özelliklerin kod tabanında bulunmadığı kontrolü (surveillance yok).
- Right-to-explanation: her puan/prim breakdown ile açıklanabilir; estimated/final ayrımı testi.
