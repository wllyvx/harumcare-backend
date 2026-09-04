# Unify Publishable Content triple behind a deep Content module

`news`/`blogs`/`kajians` duplikat 70–90% pagination/filter/join/slug/viewCount, helper `dbHelpers.js` diabaikan, schema 80% identik. Kita satukan di belakang seam `contentModule` dengan interface kecil (`list`, `getBySlug`, `create`, `update`, `remove`, `categories`) dan `ContentType` adapter (`newsAdapter`, `blogAdapter`, `kajianAdapter`) yang berisi `table`, `mapRow`, `withCampaign`/`withYouTube`. Schema tetap 3 tabel di iterasi pertama (tanpa migrasi ke `contents`), `kajianAdapter` alone bawa `youtubeFetcher` via DI, `viewCount` atomik `sql`viewCount+1``, slug collision loop, `status=all` hanya admin, dan `media`/`db` di-inject bukan `c`.

Considered Options: (A) tetap 3 controller terpisah + tambal helper — ditolak, duplikasi tetap dan fix harus 3×; (B) langsung migrasi single `contents` + `type` enum — ditolak untuk iterasi pertama karena butuh backfill D1 dan risiko downtime, dicatat sebagai follow-up.

Consequences: fix pagination/slug/search sekali untuk 3 type, YouTube terisolasi dan mockable, controller jadi thin adapter; migrasi ke single table tetap mungkin nanti tanpa ubah caller karena seam sudah adapter-based.
