# 01: Authz list + detail — admin bisa lihat draft, publik hanya published

**What to build:** sebagai admin saya bisa list `?status=all/draft` dan buka detail draft dengan token, sementara pengunjung publik tanpa token tetap hanya melihat published dan tidak menaikkan ViewCount saat draft diakses anonim.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] `GET /` meneruskan token admin opsional ke module (publik tanpa token tetap 200, `?status=all` anon tetap published, admin `status=all/draft` terlihat)
- [ ] `GET /:slug` anon atas slug draft → 404 dan ViewCount tidak bertambah; dengan token admin → 200
- [ ] `GET /latest`, `/campaign/:campaignId` tetap published-only
- [ ] Priority test `list status=all anon stays published` + `getBySlug` tetap hijau, ditambah regresi draft-detail
