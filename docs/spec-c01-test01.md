**Temuan**

1. **High: admin tidak bisa melihat draft lewat endpoint list.**  
   Route `GET /` tidak memasang autentikasi, sehingga `userOf(c)` selalu `null`. Akibatnya `?status=all` dari halaman admin dipaksa menjadi `published`.  
   Referensi: `routes.js:25`, `index.astro:560`, `index.astro:560`, `index.astro:354`.  
   Perlu optional authentication middleware: publik tetap boleh tanpa token, tetapi token admin harus diteruskan ke module.

2. **High: detail publik masih dapat membuka draft berdasarkan slug.**  
   `getBySlug` hanya mencari slug dan menaikkan `viewCount`, tanpa filter `status='published'`. Ini bertentangan dengan problem statement bahwa publik hanya melihat konten published.  
   Referensi: `index.js:184`, `routes.js:102`.  
   Tambahkan status filter untuk request anonim, atau bedakan akses detail admin dan publik.

3. **Medium: create menerima status arbitrer.**  
   `update` sudah membatasi status ke `draft|published`, tetapi `create` hanya memeriksa status tidak kosong. Nilai seperti `archived` dapat masuk ke database.  
   Referensi: `index.js:284`.  
   Gunakan validasi status yang sama pada create dan, idealnya, validasi `status` query list juga.

4. **Medium: validasi `createdAt` belum benar-benar membatasi ISO.**  
   `new Date(raw)` menerima format non-ISO tertentu. Spec meminta override admin hanya untuk nilai ISO valid.  
   Referensi: `index.js:309`.  
   Tambahkan pemeriksaan format ISO eksplisit sebelum membuat `Date`.

5. **Medium: test utama belum menjalankan jalur Drizzle/D1.**  
   Semua fake DB ditandai `__isFakeDb`, sehingga implementasi produksi untuk atomic SQL increment, `LIKE ... ESCAPE`, join, `count`, dan offset tidak pernah diuji. Test search escape saat ini hanya menguji `includes()` di memory path.  
   Referensi: `fakes.js`, `index.js:98`.  
   Tambahkan minimal integration test dengan SQLite/D1-compatible database.

**Yang sudah tercakup**

Module bersama, adapter tiga ContentType, DI media/YouTube, slug collision, CampaignRef, ownership, best-effort media deletion, pagination clamp, envelope legacy, dan sebagian besar priority tests sudah tersedia.