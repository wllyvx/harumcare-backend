# Architecture Candidates — harumcare-backend

> Review 2026-09-04 · Hono + D1 + R2 · 22 modules scanned · Hot spots: Video Kajian, Pojok Konsultasi, News, Auth
> Vocabulary: module · interface · implementation · depth · seam · adapter · leverage · locality
> HTML report: `C:\Users\ASUS\AppData\Local\Temp\architecture-review-20260904-105649.html`

---

## C01 — Unify the Publishable Content Triple [Strong | in-process]

### Files
- `src/controllers/newsController.js` (~315 LOC, 8 exports)
- `src/controllers/blogController.js` (~368 LOC, 8 exports)
- `src/controllers/kajianController.js` (~377 LOC, 8 exports + 3 helpers)
- `src/db/schema.js` — tables `news`, `blogs`, `kajians` (80% identical)
- `src/utils/dbHelpers.js` — `authorSelect`, `authorCampaignSelect`, `mapJoinedRow`
- `src/routes/news.js`, `blog.js`, `kajian.js` (masing-masing ~19 LOC)

### Problem (detail)
- Module shallow ×3: interface hampir selebar implementation. Tiap controller expose 8 method dengan signature mirip (`getAll`, `getBySlug`, `create`, `update`, `delete`, `getLatest`, `getByCampaign/getCategories`, `fetchYouTubeData`).
- Duplikasi pagination/filter/join 70-90%: pattern `page/limit/offset` + `filters[]` + `and(...filters)` + `count()` + `leftJoin(users)` + `orderBy(desc(createdAt))` copy-paste di 3 file. Hanya variabel `table` yang ganti.
- `dbHelpers.js` gagal jadi seam: `newsController` pakai `authorSelect`+`mapJoinedRow`, `blog`/`kajian` bikin `mapBlogResult`/`mapKajianResult` inline — helper diabaikan, bug tetap di caller.
- Schema drift: `news`/`blogs` identik kecuali nama tabel, `kajians` beda `youtubeLink` vs `campaignId`. Perubahan kolom harus sentuh 3 controller + schema + helpers.
- Leakage spesifik:
  - Slug `title.toLowerCase().replace(/[^a-z0-9]+/g,'-')` tanpa collision handling → duplicate slug meledak jadi 400 via unique constraint.
  - ViewCount `data.viewCount++` + `update` read-modify-write tidak atomik → race kehilangan hit.
  - Search `like(title, '%${q}%')` tanpa escape `%`/`_` → wildcard injection.
  - `campaignId` overload: kolom FK string vs populated object `campaignId: {title, imageUrl}` bikin tipe membingungkan.
  - `status` default inkonsisten: `news` default `published`, `blog`/`kajian` `!status → published` tapi `status==='all'` skip filter — publik bisa tebak `?status=all` untuk list draft.
  - `kajian` campur YouTube fetch di controller (`fetch` ke `youtube/v3/videos`, `YOUTUBE_API_KEY` via `c.env`) — tidak injectable, error hanya `console.warn`.
- Deletion test gagal: hapus satu module tidak menghilangkan kompleksitas, hanya memindahkan ke 2 sisanya.

### Solution (detail)
- Deepen jadi 1 Content module deep dengan interface kecil:
  ```
  list(query): {page, limit, search, category, status, campaignId, authorId}
  getBySlug(slug): Content | null  (increment viewCount atomik di dalam)
  create(dto, user): Content
  update(id, dto, user): Content
  remove(id, user): void  (hapus R2 jika ada)
  categories(type): string[]
  ```
- Content-type jadi adapter di belakang seam: `newsAdapter`, `blogAdapter`, `kajianAdapter`. Adapter berisi: `table`, `withCampaign` (boolean), `withYouTube` (boolean), `mapRow`.
- Implementation sembunyikan: pagination atomik, slug collision loop (`slug-2`, `slug-3`), `sql\`viewCount+1\``, search escape, author join, YouTube fetch hanya di `kajianAdapter` (di-inject `youtubeFetcher`).
- Controller jadi thin adapter: `routes/news.js` → `contentController('news')` — hanya mapping HTTP ↔ module.
- Schema tetap 3 tabel, tapi akses via adapter. Optional: migrasi `news`/`blogs` ke single `contents` + `type` enum di iterasi berikut (tidak wajib untuk deepening pertama).
- Seam: `contentModule` terima `db` (D1) dan `media` + `youtube` via DI, bukan `c`.

### Benefits
- locality: fix pagination/slug/search sekali, semua content type ikut.
- leverage: satu interface, 3 content type + N test.
- Hapus ~600 LOC duplikasi, 1 tempat test pagination.
- YouTube terisolasi, bisa di-mock.

### Langkah pengerjaan
1. Ekstrak `createContentModule({db, media, youtubeFetcher})` dengan interface di atas.
2. Pindah logic `newsController` sebagai baseline, parametrizasi `table`.
3. Adapter `blog`/`kajian` override `mapRow` dan `youtube` capability.
4. Ganti `viewCount` ke `sql` increment, tambah slug-uniqueness loop.
5. Route jadi `hono.get('/', (c)=> content.list(...))` thin.

### Test surface
- Interface adalah test surface: `list` dengan kombinasi filter, `getBySlug` cek viewCount +1, `create` cek slug collision, `kajian` mock `youtubeFetcher` throw vs success.

---

## C02 — Close the Donation → Campaign Seam [Strong | ports & adapters]

### Files
- `src/controllers/donationController.js` (576 LOC, 10 exports + 2 helpers) — file terbesar
- `src/controllers/campaignController.js` (269 LOC, 6 exports)
- `src/db/schema.js` — `campaigns`, `donations`
- `src/routes/donations.js` (37 LOC), `campaigns.js` (21 LOC, `POST /:id/donate` duplikat)

### Problem (detail)
- Donation status transition leak menyeberang seam ke Campaign stats. `updateCampaignStats` dipanggil di 4 tempat (`updatePaymentStatus`, `updateDonationStatus`, `deleteDonation`, `createDonationByAdmin`) dengan guard copy-paste:
  `(status==='completed' && old!=='completed') || (status!=='completed' && old==='completed')` ×3.
- Non-atomik: `insert donation` → `sum`+`count` → `update campaign` tidak dalam transaction/batch → partial failure bikin stats meleset.
- Campaign delete cascade: loop `for(... await deleteFromR2)` sequential + `delete donations` + `delete campaign` tidak transaksional → orphan rows jika R2 gagal di tengah.
- Duplikasi `createDonation` vs `createDonationByAdmin` 80% validasi + insert sama.
- Inkonistensi seam: `paymentStatus` vs `status` penamaan beda; `POST /campaigns/:id/donate` duplikat `POST /donations` — `campaignId` dari body vs `:id` URL mismatch.
- Leakage lain: `uniqueCode` dipakai `donationController:108` tapi kolom tidak ada di schema → runtime `SqliteError`; `mapDonationResult` dead code; `transactionId` `TRX-${Date.now()}-${random}` tidak collision-proof; `GET /` donations filter `total` sebelum filter valid campaign → count mismatch.
- `PUT /payment-status` publik tanpa auth (webhook) berdampingan `PATCH /:id/status` admin — auth matrix membingungkan.

### Solution (detail)
- Deepen Donation module yang own transaction:
  ```
  create(dto, user): Donation
  complete(id): Donation   // transisi ke completed + recalc
  fail(id): Donation       // transisi ke failed + recalc
  updateProof(id, proofUrl): Donation
  recalcStats(campaignId): {currentAmount, donorCount}
  ```
- Implementation: satu seam transisi, caller tidak re-implement guard. Di dalam pakai `db.batch([update donation, select sum, select count, update campaign])` atomik. Campaign delete jadi `batch([R2 deletes, delete donations, delete campaign])` atau kompensasi.
- Campaign module hanya read stats, tidak pernah write `currentAmount`/`donorCount`. Hapus destructuring `{currentAmount, donorCount, ...}` di `updateCampaign`.
- Route tunggal: `POST /donations` dengan `campaignId` di body; `POST /campaigns/:id/donate` dihapus atau jadi redirect thin adapter.
- Tambah kolom `uniqueCode` di schema atau hapus pemakaian.

### Benefits
- locality: bug transisi di satu module.
- leverage: satu seam, 4 call site fixed.
- Orphan rows hilang (batch), naming konsisten.

### Langkah pengerjaan
1. Buat `donationModule({db, media})` dengan method transisi.
2. Pindah guard `completed?` ke dalam module, hapus duplikasi.
3. Ganti semua `updateCampaignStats` call jadi `complete`/`fail`.
4. Batch write, perbaiki schema `uniqueCode`.
5. Hapus duplikat route.

### Test surface
- `create` → `complete` → cek `campaign.currentAmount` +1, `fail` → -1, `delete` → recalc, batch failure rollback.

---

## C03 — Deepen the Auth Module [Worth exploring | local-substitutable]

### Files
- `src/middleware/auth.js` (32 LOC, `authenticateToken`, `restrictToAdmin`)
- `src/services/AuthService.js` (53 LOC, 4 static methods)
- `src/services/GoogleAuthService.js` (71 LOC, `verifyToken`)
- `src/routes/auth.js` (286 LOC — fat route, controller in disguise)
- `src/routes/users.js` (124 LOC inline)

### Problem (detail)
- Auth module shallow dan terpecah: `AuthService` interface == passthrough `bcryptjs`+`jsonwebtoken` (zero leverage), `verifyToken` duplikat di `middleware/auth.js` vs `AuthService.verifyToken` — drift risk (middleware 403, service throw).
- `routes/auth.js` inline business logic (Google linking, username uniquing `emailPrefix+random` 4-char entropy rendah, JWT generate) — kontras dengan domain lain yang delegate ke controller → seam inkonsisten.
- `GoogleAuthService` paling deep tapi tidak testable: pakai global `fetch`, `crypto.subtle`, `atob`, `TextEncoder` tanpa DI; certs fetch tidak di-cache; clock skew tidak handle; error generic `Invalid Google token: <msg>`.
- Leakage: `c.set('user', decoded)` shape `{userId, role, nama}` tidak divalidasi; `restrictToAdmin` asumsi `authenticateToken` sudah jalan — implicit ordering tanpa guard; `password: ''` untuk Google user vs `null` inkonsisten; `profile updatedAt = new Date()` vs `sql(strftime)` mismatch; `users.js` pakai `bcrypt.hash` raw duplikat `AuthService`.
- Hidden: `authorize Bearer` split tanpa trim, `bcrypt cost 10` hardcode, `expiresIn 24h` hardcode.

### Solution (detail)
- Deepen jadi 1 Auth module deep:
  ```
  hash(pw): hash
  verify(pw, hash): boolean
  issue(user): token
  verifyToken(token): UserPayload
  verifyGoogle(credential): {sub, email, name, picture}
  register(dto): User
  ```
- Implementation sembunyikan: cost, expiry, cert fetch+cache, clock skew leeway, username uniquing loop.
- Dependency di-inject: `jwtSecret`, `googleClientId`, `certFetcher`, `subtle`, `hasher` — bukan global.
- Middleware/routes jadi thin adapter: `authenticateToken = (c,next)=> { user = auth.verifyToken(header); c.set('user', user) }`.
- Dua adapter justify seam: Hono adapter prod, in-memory fake untuk test (tanpa `fetch`/`subtle`).

### Benefits
- locality: bug token di satu module.
- interface menyusut, implementation serap wrapper.
- Google flow cacheable + testable, last-admin guard testable tanpa Hono.

### Langkah
1. Buat `createAuth({jwtSecret, googleClientId, fetcher, subtle})`.
2. Konsolidasi `verifyToken` satu tempat, middleware delegate.
3. Pindah `routes/auth.js` logic ke module, route jadi thin.
4. Inject `fetcher` mock di test, cache certs in-memory 1h.

---

## C04 — Deepen the Media Module [Worth exploring | ports & adapters]

### Files
- `src/utils/r2.js` (41 LOC, `deleteFromR2(c, imageUrl)`)
- `src/routes/upload.js` (84 LOC inline, `POST /`, `GET /image/:key`, `DELETE /:key`)
- `src/controllers/newsController.js`, `blogController.js`, `campaignController.js`, `kajianController.js` (path delete masing-masing)

### Problem (detail)
- Module shallow: interface adalah string split `'/api/upload/image/'`, implementation leak `c` (Hono context) ke util — `deleteFromR2` butuh `c.env.BUCKET` + `c` bukan `bucket`.
- `upload.js` inline semua, duplikat cek `if(!c.env.BUCKET) 500` ×3, `baseUrl = c.req.url.split('/api/upload')[0]` asumsi deployment shape — pecah di proxy/CDN.
- 4 controller duplikat guard `if(existing.image && image !== ...) deleteFromR2(c, existing.image)` — invariant scattered.
- Return `false` untuk skip dan error — caller tidak bisa bedakan.
- Leakage: `filename = Date.now()+file.name` tanpa sanitasi → path traversal risk; `GET /image/:key` `max-age=31536000` hardcode tanpa content-type check; `DELETE /:key` butuh auth tapi `GET` publik.

### Solution (detail)
- Deepen Media module, seam di `bucket+baseUrl` bukan `c`:
  ```
  store(bytes, hint): url   // sanitize hint, validate mime, generate key
  remove(url): void         // parse key dari url, delete, no-op jika bukan R2 url
  urlFor(key): url
  ```
- Implementation: `createMedia({bucket, baseUrl})` — sanitize `hint` (slugify, strip `../`), validasi `image/*` atau allowlist, key `Date.now()-random-slug.ext`.
- Dua adapter justify seam: R2 adapter prod, in-memory Map adapter test.
- `upload.js` delegate ke `media.store`, controller cukup `await media.remove(oldUrl)` satu baris tanpa branching.

### Benefits
- locality: perubahan URL shape di satu module.
- leak hilang: util tidak terima `c`.
- leverage: satu `remove()` untuk 4 domain.

### Langkah
1. Buat `createMedia`, pindah split logic ke `urlFor`/`remove`.
2. Ganti `r2.js` call di 4 controller jadi `media.remove`.
3. `upload.js` thin adapter, tambah mime check + filename sanitize.

---

## C05 — Harden the Request Boundary [Speculative | in-process]

### Files
- `src/controllers/*` semua
- `src/routes/*` semua
- `package.json` (tanpa test/lint script), `wrangler.jsonc`

### Problem (detail)
- Tidak ada seam validasi: tiap controller re-implement cek ad-hoc. Interface adalah scattered `if`.
- Slug collision → 500, search `like` tanpa escape, `status=all` bypass publik (4 tempat), `createdAt` dari body bisa di-spoof, viewCount race.
- Tidak ada schema lib (Zod), tidak ada `npm test`.

### Solution (detail)
- Deepen Input module di seam request:
  ```
  parse(schema, raw): dto | throw 400
  validate(schema) // Hono middleware
  ```
- Zod schema per domain (`newsCreate`, `donationCreate`, ...), controller terima `dto` typed, unknown field stripped.
- ViewCount ganti `sql\`viewCount+1\``, `createdAt` diisi server, `status` allowlist.
- Bukan deep sendiri — deepening semua module lain dengan menyusutkan interface mereka.

### Benefits
- locality: fix validasi satu tempat.
- leverage: satu schema per domain reuse.
- Deletion test: hapus Input, validasi scatter lagi.
- Test: `dto in, error out` tanpa mock Hono.

---

## Top Recommendation

**Mulai C01** — hot spot Video Kajian + news paling sering berubah, deletion test lolos jelas, leverage terbesar (1 interface × 3 type). Pasangkan dengan **C02** berikutnya — seam transaksional dengan bug risk real.

## Cross-cutting Notes

- Tidak ada `CONTEXT.md` / `docs/adr` — rekam keputusan Content unification & Donation transaction sebagai ADR saat eksekusi.
- **Security — normal prose:** `wrangler.jsonc` vars berisi `JWT_SECRET`, `YOUTUBE_API_KEY` plaintext. Pindah ke `wrangler secret put` dan rotate segera. `JWT_SECRET` bocor memungkinkan token forgery.
- Tidak ada test harness — tambah `vitest` + `npm test` sebelum deepening agar seam bisa diuji.
