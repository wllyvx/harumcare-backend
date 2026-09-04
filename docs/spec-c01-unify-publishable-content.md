# Spec: C01 — Unify Publishable Content Triple

> Source: `harumcare-backend/docs/architecture-candidates.md` C01 + grill-with-docs rounds Q1–Q12
> Glossary: `harumcare-backend/CONTEXT.md` (PublishableContent, ContentType, Slug, ViewCount, Author, Campaign, CampaignRef)
> ADR: `harumcare-backend/docs/adr/0001-unify-publishable-content-module.md`
> Report: `C:\Users\ASUS\AppData\Local\Temp\architecture-review-20260904-105649.html`

## Problem Statement

Sebagai admin/editor HarumCare, saya mengelola tiga jenis terbitan — news, blog, dan kajian — yang masing-masing punya daftar, detail slug, kategori, status, pencarian, dan pembuatan/ubah/hapus. Saat ini ketiganya diimplementasi sebagai tiga controller terpisah dengan duplikasi 70–90% (pagination, filter, join, slug, ViewCount), ditambah inkonsistensi status, race ViewCount, dan YouTube fetch yang tidak testable di kajian. Akibatnya perbaikan bug harus diulang tiga kali, perubahan kolom schema menyebar ke 3 controller + helper, dan error slug/search sulit dilokalisasi.

Sebagai pengunjung publik, saya melihat daftar dan detail PublishableContent yang seharusnya hanya menampilkan yang published, dengan pencarian yang aman dan ViewCount yang akurat.

## Solution

Satukan ketiga PublishableContent di belakang satu deep Content module dengan interface kecil dan ContentType adapter. Perbaikan pagination/slug/search/ViewCount/status dilakukan sekali dan berlaku untuk semua ContentType. Route publik tetap di path yang sama (`/api/news`, `/api/blog`, `/api/kajian`) sebagai thin adapter, sementara logika berat (atomik increment, slug collision loop, escape wildcard, DI media/youtube) disembunyikan di dalam module. Kajian tetap punya kemampuan YouTube via adapter yang di-inject, tanpa membebani news/blog.

## User Stories

1. As an admin, I want to list news with pagination (page/limit) so that I can browse large collections without overload
2. As an admin, I want to list blogs with pagination so that I can browse large collections without overload
3. As an admin, I want to list kajian with pagination so that I can browse large collections without overload
4. As a public visitor, I want to list only published PublishableContent by default so that I never see drafts
5. As an admin, I want to list drafts and `status=all` so that I can moderate unpublished items
6. As an admin, I want category filtering on list so that I can narrow by topic
7. As an admin, I want campaign filtering on list so that I can see content linked to a specific Campaign
8. As a public visitor, I want to search by `q` on title/content (news/blog) and title/description (kajian) so that I can find relevant items
9. As an admin, I want search to escape `%`/`_`/`\` so that wildcard injection cannot broaden results
10. As a content reader, I want to get detail by Slug so that I can share stable URLs
11. As a content reader, I want ViewCount to increment atomically on each detail view so that counts are not lost under concurrency
12. As an admin, I want to see Author (`nama`, `username`) populated on list and detail so that attribution is visible
13. As an admin, I want to see CampaignRef (`title`, `imageUrl`) populated as `campaign` (not overloaded `campaignId`) so that linked Campaign is recognizable
14. As an admin, I want `relatedCampaign` extra-query dihapus dan diganti join tunggal so that detail tidak melakukan N+1
15. As an admin, I want to create PublishableContent with title/content|description/category/status so that I can publish new items
16. As an admin, I want Slug auto-generated from title and uniqued (`slug`, `slug-2`, `slug-3`) so that duplicate titles do not explode via unique constraint
17. As an admin, I want `campaignId` as FK string on create/update so that content can be linked to a Campaign
18. As an admin, I want `createdAt`/`updatedAt` server-owned so that client cannot spoof timestamps
19. As an admin (import case), I want `createdAt` override only if I am admin and value is valid ISO so that backfill remains possible but safe
20. As an author, I want to update only my own PublishableContent (or admin can update any) so that ownership is enforced
21. As an author, I want image change to trigger `media.remove(oldUrl)` best-effort so that orphan files do not accumulate
22. As an author, I want `media.remove` to not block DB update if R2 fails so that content save is not lost due to storage
23. As an admin, I want to delete PublishableContent with ownership check so that unauthorized deletion is blocked
24. As an admin, I want delete to remove associated R2 image best-effort so that storage is reclaimed
25. As a public visitor, I want `GET /latest?limit&campaignId` so that homepage can show recent published items
26. As a public visitor, I want `GET /categories` distinct per ContentType so that filter UI can populate options
27. As a public visitor, I want `GET /campaign/:campaignId` paginated so that campaign detail pages can list linked content
28. As a kajian author, I want to create kajian with `youtubeLink` validated (watch/youtu.be/live patterns) so that invalid links are rejected early
29. As a kajian author, I want title/description auto-fetched from YouTube when not provided so that I do not need to copy metadata manually
30. As a kajian author, I want YouTube fetch isolated via `youtubeFetcher` DI so that it can be mocked and does not leak `c.env`/`c` into module
31. As a kajian author, I want YouTube fetch failure to warn and continue (or require manual title/description) so that publish is not blocked by API outage
32. As a public visitor, I want `GET /kajian/fetchYouTubeData?videoId` capability preserved via adapter so that client can preview metadata
33. As an admin, I want invalid `page`/`limit` (NaN, negative, huge) to clamp or 400 so that DB is not abused
34. As an admin, I want pagination meta `{page,total,totalPages}` consistently so that UI can paginate correctly (legacy keys `news/blogs/kajians`/`totalNews` mapped in adapter)
35. As a developer, I want one seam `contentModule` with DI `db`/`media`/`youtubeFetcher` so that tests do not need Hono/`c`/`c.env.BUCKET`
36. As a developer, I want error shapes typed (`NotFound`→404, `Validation`→400, `Forbidden`→403, `Conflict`→409) mapped by adapter so that HTTP codes are consistent
37. As a developer, I want 4 priority tests to pass: `getBySlug` atomik `+1`, `list status=all` anon stays published, slug collision loop, search escape

## Implementation Decisions

- **Single deep seam**: `createContentModule({db, media, youtubeFetcher})` is the sole seam. `db` is D1/Drizzle client, `media` exposes `remove(url)`/`store(bytes,hint)`, `youtubeFetcher` is `(videoId)=>{title,description}` injected only for `kajianAdapter`. No `c`/`c.env` leaks into module. Existing seams `dbHelpers.js` (`authorSelect`/`mapJoinedRow`) are retired; `r2.js` `deleteFromR2(c, url)` replaced by `media.remove`.
- **Adapter pattern behind seam**: `adapters.js` exports `newsAdapter`, `blogAdapter`, `kajianAdapter`. Each carries `table` (news/blogs/kajians Drizzle table), `withCampaign` boolean (news/blog true, kajian false), `withYouTube` boolean (kajian true), and `mapRow` (replaces `mapJoinedRow`/`mapBlogResult`/`mapKajianResult`). List/detail join uses `authorCampaignSelect` only when `withCampaign`.
- **Interface (module)**: `list(query:{page,limit,search,category,status,campaignId,authorId}): {items,total,page,totalPages}`; `getBySlug(slug): PublishableContent|null` (atomik `viewCount+1` inside); `create(dto, user): PublishableContent`; `update(id, dto, user): PublishableContent`; `remove(id, user): void` (best-effort `media.remove`); `categories(type): string[]`. Thin controller `forType(type)` maps HTTP→module.
- **Pagination/search hardening inside module**: clamp `page 1..1000`, `limit 1..50 default 10`, non-numeric → Validation 400; `totalPages = ceil(total/limit)`; `whereClause = and(...filters)`; search `q` escaped via `q.replace(/[%_\\]/g,'\\$&')` before `like('%q%')`; `status` default `published` for anon, `all`/`draft` only if `user.role==='admin'` else forced `published`.
- **Slug uniqueness loop**: `slug = slugify(title)` (`toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)+/g,'')`), then `while(await exists(slug)) slug = base + '-' + ++suffix` up to 100 attempts → Conflict if exhausted. Unique constraint violation no longer surfaces as 400.
- **ViewCount atomik**: `getBySlug` does `sql`viewCount+1`` update atomically then returns fresh row; removes read-modify-write race (`data.viewCount++` + update).
- **Campaign typing fix**: module returns `campaign: CampaignRef|null` (`{title,imageUrl}`) separate from `campaignId: string|null` FK. `mapRow` no longer overloads `campaignId`. Detail no longer does extra `select campaigns where id=...` for `relatedCampaign`; join result is used.
- **Timestamp ownership**: `createdAt`/`updatedAt` server-owned (`new Date()`). Body `createdAt` ignored unless `user.role==='admin'` and valid ISO → else Validation 400.
- **Media semantics**: `media.remove(url)` parses key from url, no-ops if not R2 url, `try/catch warn` not blocking tx. `store` sanitizes hint (strip `../`, slugify), validates mime allowlist, key `Date.now()-random-slug.ext`. `filename = Date.now()+file.name` without sanitization removed.
- **YouTube isolation**: `fetchYouTubeVideoInfo` + `extractVideoId` (watch/youtu.be/live) moved into `kajianAdapter` via `youtubeFetcher` DI; error only `console.warn` removed, replaced by typed throw mapped to 400/500. News/blog adapters have no youtube capability.
- **Envelope compat**: module returns generic `{items,total,page,totalPages}`; route adapter maps to legacy keys (`news`/`totalNews`, `blogs`/`totalBlogs`, `kajians`/`totalKajians`) to avoid FE break. Generic keys are the contract for future clients.
- **Routing**: `src/routes/news.js`, `blog.js`, `kajian.js` stay mounted at `/api/news|blog|kajian` in `src/index.js`; handlers replaced with `content.for('news').list` etc. `GET /`, `/latest`, `/categories`, `/campaign/:campaignId`, `/:slug`, `POST /`, `PUT /:id`, `DELETE /:id` paths unchanged. Auth via `authenticateToken` unchanged.
- **Schema**: no migration in this iteration. Tables `news`/`blogs`/`kajians` remain 3 tables (ADR-0001). Future single `contents` + `type` enum noted as follow-up, not blocking.
- **Glossary adherence**: use `PublishableContent`/`ContentType`/`Slug`/`ViewCount`/`Author`/`Campaign`/`CampaignRef` everywhere; avoid `Content`/`Article`/`Post`/`views`/`writer`/`campaignId object`/`relatedCampaign`.
- **Module location**: `src/modules/content/` with `index.js` (factory), `adapters.js`, `helpers.js` (slug, escape, pagination). Controller `src/controllers/contentController.js` is thin `forType` factory only.

## Testing Decisions

- **What makes a good test**: test external behavior at the highest seam (`contentModule` interface), not implementation details. Do not assert internal SQL strings, adapter branching, or Hono wiring; assert `list`/`getBySlug`/`create` observable results and HTTP status via adapter mapping. Prefer real D1 fake over mocks where possible; mock only `youtubeFetcher` and `media`.
- **Which modules will be tested**: `contentModule` (all 6 methods) is the primary test surface. Route adapters get smoke tests for envelope mapping and auth guard (author vs admin) but not business logic. No separate helper unit tests unless helpers are pure (slugify/escape).
- **Prior art**: repo currently has no `npm test`/`vitest` harness (`package.json` without test script, per architecture-candidates cross-cutting notes). This spec introduces `vitest` + in-memory D1 fake + `media` Map fake + `youtubeFetcher` mock as the first harness. No existing test patterns to reuse; new tests set the precedent.
- **Priority test cases (must pass before merge)**:
  - `getBySlug` increments `ViewCount` atomically and returns fresh count; concurrent calls do not lose hits
  - `list` with `status=all` as anon/public returns only `published`; as admin returns all; `status=draft` anon forced to `published`
  - `create` with duplicate title produces `slug-2`, `slug-3` loop without unique-constraint 400
  - `list` with `q="100%_x"` escapes wildcards; results do not broaden
  - `search` + `category` + `campaignId` combined filters produce correct `total` and paginated `items`
  - `page=NaN`/`limit=9999`/`limit=-1` clamps or 400s; `offset` correct
  - `kajian create` with `youtubeFetcher` throwing still validates or requires title/description; success path populates from fetcher
  - `update`/`remove` ownership: author can, non-author non-admin → 403, admin → allowed
  - `media.remove` called best-effort on image change/delete; R2 failure does not fail DB tx
  - `categories` distinct per ContentType
  - `CampaignRef` shape: `campaign: {title,imageUrl}|null` separate from `campaignId` string
- **Seams**: one seam `contentModule` is sufficient. Higher seam (HTTP via Hono) not needed for core logic; lower seams (helpers) not tested in isolation. `youtubeFetcher` and `media` are the only injected fakes.

## Out of Scope

- Migrasi schema ke single `contents` + `type` enum dan backfill data (follow-up ADR-0001, tidak blok iterasi ini)
- C02 donation→campaign transactional seam, C03 auth deepening, C04 media module standalone, C05 request boundary/Zod validation — each is a separate candidate
- Perubahan URL mount (`/api/news|blog|kajian`) atau method; FE contract legacy keys dipertahankan via adapter mapping
- Rate limiting, caching headers (`max-age=31536000` hardcode) di `GET /image/:key`, dan sanitasi filename upload di luar content flow
- `getLatest`/`getByCampaign` sebagai method terpisah — dicakup sebagai `list` dengan filter/sort/limit

## Further Notes

- **Security note (pre-existing, not in C01 scope but recorded)**: `wrangler.jsonc` vars contain `JWT_SECRET`/`YOUTUBE_API_KEY` plaintext — rotate via `wrangler secret put` separately. `JWT_SECRET` leak enables token forgery.
- Deletion test: removing one ContentType adapter does not hide complexity — fix must be in shared `list`/`getBySlug`/`create` to pass.
- Benefits per ADR-0001: locality (fix once, 3 ContentType benefit), leverage (1 interface × 3 type + N tests), ~600 LOC duplication removed, YouTube mockable.
- Steps from candidate (reference): extract `createContentModule`, parametrize `table`, override `mapRow`/youtube per adapter, `sql viewCount+1`, slug loop, thin routes.

