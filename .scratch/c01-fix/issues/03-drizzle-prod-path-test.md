# 03: Prod-path Drizzle test (atomic, LIKE ESCAPE, count/offset)

**What to build:** sebagai developer saya punya integration test di jalur Drizzle/D1 asli (bukan `__isFakeDb`) yang mengunci increment atomik, escape wildcard, join, count, dan offset agar perilaku produksi tidak hanya diuji via `includes()` in-memory.

**Blocked by:** 01-authz-list-detail, 02-validate-status-createdat (mengunci perilaku benar dulu, baru dikunci test prod-path).

**Status:** ready-for-agent

- [ ] Test memakai SQLite/D1-compatible (mis. better-sqlite3 + drizzle) tanpa `__isFakeDb`
- [ ] Mengunci `viewCount+1` atomik, `q="100%_x\"` tidak melebar, `total/offset` benar, join Author/CampaignRef benar
- [ ] Status-filter admin vs anon (hasil 01) juga terhijau di jalur drizzle
- [ ] Suite `npm test` tetap hijau (memory + drizzle)
