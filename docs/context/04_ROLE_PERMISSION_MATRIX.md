# Role Permission Matrix

## Organization Owner

- Organization settings görebilir/değiştirebilir
- Admin atayabilir
- Bonus policy oluşturabilir
- Audit logs görebilir
- Kullanıcı davet edebilir
- Prim dönemini başlatabilir/kapatabilir
- Production support access verebilir

## Admin

- Kullanıcı ve takım yönetebilir
- Görev kategorileri ve scoring policy taslağı oluşturabilir
- Audit log görebilir
- Finance payout onayı veremez

## HR Manager

- Çalışan performans ve dispute ekranlarını görebilir
- Bonus period yönetebilir
- Bonus calculation approve edebilir
- Dispute resolve edebilir
- Görevlerin teknik içeriğini değiştiremez

## Finance Manager

- Bonus pool oluşturabilir
- Bonus allocation görebilir
- Payment export alabilir
- Görev puanı değiştiremez
- Çalışanların tüm görev detaylarını göremez, sadece ödeme için gerekli özetleri görür

## Department Manager

- Kendi departmanındaki görevleri görebilir
- Takım liderlerini görebilir
- Takım performansını görebilir
- Görev review edebilir
- Bonus pool final onayı veremez

## Team Lead / Manager

- Kendi takımına görev atayabilir
- Kendi takımındaki görevleri review edebilir
- Kendi görevini approve edemez
- Manual point override yapamaz veya ikinci onay gerektirir
- Dispute kararında tek başına nihai karar veremez

## Employee

- Kendi görevlerini görebilir
- Kendi görevini submit edebilir
- Kendi puan breakdown’unu görebilir
- Kendi bonus estimate’ini görebilir
- Dispute açabilir
- Başka çalışanların bonus detayını göremez
- Görev puanı değiştiremez

## Auditor

- Read-only erişim
- Audit logs görebilir
- Calculation snapshots görebilir
- Export logs görebilir
- Veri değiştiremez

## Super Admin / SaaS Support

- Varsayılan olarak tenant verisine erişemez
- Sadece support access grant ile sınırlı ve süreli erişim alabilir
- Tüm erişimler audit log’a düşer

---
