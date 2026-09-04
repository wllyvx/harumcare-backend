# 04: Create PublishableContent with Slug loop and server-owned timestamps

**What to build:** Make creation of PublishableContent work through the seam with Slug uniqueness and timestamp ownership. After this ticket, publishing a new item with a duplicate title succeeds with `slug-2`/`slug-3` instead of constraint failure, and client-supplied `createdAt` cannot spoof history.

**Blocked by:** 02: List and categories through content seam

**Status:** ready-for-agent

- [ ] Slug generated via slugify and uniqued with loop `base`, `base-2`, `base-3` up to 100 attempts; duplicate title does not surface unique-constraint 400
- [ ] `campaignId` stored as FK string link, validated as existing Campaign when provided
- [ ] `createdAt`/`updatedAt` server-owned (`new Date()`); body `createdAt` ignored unless caller is admin with valid ISO, otherwise Validation 400
- [ ] Creation populates Author from caller and returns CampaignRef shape correctly
