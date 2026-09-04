# 03: Detail by Slug with atomic ViewCount and CampaignRef

**What to build:** Make detail by Slug work through the seam with atomic ViewCount increment and correct Author/CampaignRef population. After this ticket, opening a PublishableContent detail reliably bumps ViewCount without race loss and shows attribution without N+1 queries.

**Blocked by:** 02: List and categories through content seam

**Status:** ready-for-agent

- [ ] `getBySlug` increments ViewCount atomically (sql increment) and returns fresh count; concurrent calls do not lose hits
- [ ] Detail returns Author `{nama, username}` populated via join and `campaign: CampaignRef|null` (`{title,imageUrl}`) separate from `campaignId` FK string; no overloaded `campaignId` object
- [ ] Related Campaign fetched via single join, not extra select; kajian detail skips Campaign join
- [ ] Not-found Slug maps to 404 via adapter; success envelope uses legacy detail shape per ContentType
