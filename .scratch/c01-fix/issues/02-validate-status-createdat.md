# 02: Validasi status + createdAt ISO ketat

**What to build:** sebagai admin saya ditolak dengan 400 saat mengirim status arbitrer atau createdAt non-ISO, sehingga hanya `draft|published` yang tersimpan dan override createdAt hanya untuk ISO valid oleh admin.

**Blocked by:** None (can start immediately, paralel dengan 01).

**Status:** ready-for-agent

- [ ] `create` menolak `status=archived` (dan nilai di luar whitelist) dengan 400, sama seperti `update`
- [ ] `list ?status=archived` divalidasi (400 atau fallback published yang terdokumentasi, konsisten memory + drizzle)
- [ ] `createdAt` override admin hanya lolos untuk ISO-8601 eksplisit (`new Date` longgar tidak cukup); non-admin diabaikan server-owned
- [ ] Berlaku untuk create + update, memory + drizzle path
