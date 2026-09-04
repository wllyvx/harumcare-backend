# 02: List and categories through content seam

**What to build:** Make public and admin listing of PublishableContent work through the unified content seam, including pagination, filtering, search, and categories. After this ticket, browsing `/api/news|blog|kajian` with filters returns correct paginated results and distinct categories per ContentType.

**Blocked by:** 01: Setup harness and pure helpers behind content seam

**Status:** ready-for-agent

- [ ] `list` enforces clamp page 1..1000 limit 1..50 default 10, non-numeric/infinite → Validation 400, and returns `{items,total,page,totalPages}` with correct offset and `ceil(total/limit)`
- [ ] `status` defaults to `published` for anon/public; `status=all` or `draft` only honored when caller role is admin, otherwise forced to `published`
- [ ] Combined filters `search` (`q` escaped for `%`/`_`/`\` before like), `category`, `campaignId` produce correct `total` and `items` via single `and(...filters)` count+select with `leftJoin` Author/CampaignRef and `orderBy desc(createdAt)`
- [ ] `categories` returns distinct values per ContentType
- [ ] Legacy envelope mapping verified: adapter maps `items→news/blogs/kajians` and `total→totalNews/totalBlogs/totalKajians` so existing path behavior stays green
