# 07: Thin route wiring with envelope compat and cleanup

**What to build:** Wire the unified content seam behind the existing public route mounts as thin adapters, preserve the legacy envelope for frontend compat, and remove the duplicated controllers and helpers. After this ticket, all of `/api/news|blog|kajian` serve through `content.for(ContentType)` at the same paths and the old copy-paste code is gone.

**Blocked by:** 02: List and categories through content seam, 03: Detail by Slug with atomic ViewCount and CampaignRef, 04: Create PublishableContent with Slug loop and server-owned timestamps, 05: Update and remove with ownership and best-effort media, 06: Kajian YouTube capability via DI

**Status:** ready-for-agent

- [ ] News, blog, and kajian routes delegate via `content.for(ContentType)` thin adapter at unchanged mounts (`/api/news|blog|kajian` with `GET /`, `/latest`, `/categories`, `/campaign/:campaignId`, `/:slug`, `POST /`, `PUT /:id`, `DELETE /:id`) and existing auth guard; module generic `{items,total,page,totalPages}` mapped to legacy `news/totalNews` etc.
- [ ] Duplicated news/blog/kajian controllers and inline `mapBlogResult`/`mapKajianResult` plus shared `dbHelpers` overload removed; adapters own `mapRow` and CampaignRef shaping
- [ ] Media seam owns sanitize and key generation and no longer leaks Hono context; DI wiring verified across all ContentTypes
- [ ] Full vertical path green: list→detail→create→update→delete→kajian youtube via seam with no constraint or race regression
