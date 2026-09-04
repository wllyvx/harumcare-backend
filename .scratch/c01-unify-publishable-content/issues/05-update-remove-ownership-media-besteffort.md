# 05: Update and remove with ownership and best-effort media

**What to build:** Make update and deletion of PublishableContent work with ownership enforcement and best-effort media cleanup. After this ticket, only the Author or an admin can mutate or delete, and image swaps/deletes reclaim R2 storage without failing the DB transaction.

**Blocked by:** 04: Create PublishableContent with Slug loop and server-owned timestamps

**Status:** ready-for-agent

- [ ] Update and remove enforce Author-or-admin: non-author non-admin → 403, admin → allowed
- [ ] Image change triggers `media.remove(oldUrl)` via DI best-effort; R2 failure is warned not blocking DB update
- [ ] Delete removes DB row and best-effort `media.remove`; storage failure does not rollback content deletion
- [ ] Status/category validation honored on update; updatedAt server-owned
