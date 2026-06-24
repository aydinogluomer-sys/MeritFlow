# MeritFlow Context Pack

Bu klasör Claude Code'a verilecek parçalı context dosyalarını içerir.

## Kullanım

Claude Code'a şu mesajı yaz:

```txt
/docs/context klasöründeki tüm dosyaları sırayla oku. Kod yazma.

Önce dosyalar arasında çelişki, eksik, risk ve güçlendirme alanlarını çıkar.
Sonra 00_MASTER_PROMPT_v2.md içindeki output formatına göre tam planlama paketini üret.

Kodlama yapma. Implementation ancak ben ayrıca “implementation authorized” dersem başlayacak.
```

## Önerilen Okuma Sırası

1. 00_MASTER_PROMPT_v2.md
2. 01_PRODUCT_BRIEF.md
3. 02_MVP_SCOPE.md
4. 03_PRIM_SCORING_RULES.md
5. 04_ROLE_PERMISSION_MATRIX.md
6. 05_USER_FLOWS.md
7. 06_DATABASE_REQUIREMENTS.md
8. 07_SECURITY_PRIVACY_GUARDRAILS.md
9. 08_UI_UX_DIRECTION.md
10. 09_SAMPLE_DATA_AND_CALCULATIONS.md
11. 10_REFERENCES_TO_REVIEW.md
12. 11_ACCEPTANCE_CRITERIA.md
