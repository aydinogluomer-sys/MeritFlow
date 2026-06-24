# User Flows

## Flow 1 — Görev Oluşturma ve Atama

1. Manager yeni görev oluşturur.
2. Title, description, due date, priority, complexity, impact, acceptance criteria girer.
3. Sistem tahmini base point önerir.
4. Manager görevi employee’ye atar.
5. Employee notification alır.
6. Görev status: assigned olur.

## Flow 2 — Görev Teslimi

1. Employee görevi açar.
2. Çalışmasını tamamlar.
3. Evidence veya not ekler.
4. Submit eder.
5. Görev status: submitted olur.
6. Henüz final puan verilmez.

## Flow 3 — Manager Review

1. Manager review queue’da görevi görür.
2. Evidence, acceptance criteria ve kaliteyi inceler.
3. Seçenekler:
   - approve
   - needs_revision
   - reject
4. Approve ise sistem scoring policy ile final points hesaplar.
5. Point ledger entry oluşur.
6. Audit log oluşur.
7. Employee puan breakdown görür.

## Flow 4 — Bonus Period Close

1. HR dönem kapatma başlatır.
2. Sistem pending task ve disputes kontrol eder.
3. Dönem lock edilir.
4. Bonus calculation run oluşturulur.
5. Snapshot alınır.
6. HR sonucu inceler.
7. Finance ödeme export’u alır.

## Flow 5 — Dispute

1. Employee puan/bonus sonucuna itiraz eder.
2. Dispute type seçer.
3. Açıklama ve evidence ekler.
4. HR veya bağımsız reviewer inceler.
5. Karar verilir.
6. Gerekirse point ledger adjustment oluşur.
7. Bonus recalculation snapshot oluşur.

---
