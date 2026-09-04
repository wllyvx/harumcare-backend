# 06: Kajian YouTube capability via DI

**What to build:** Give the kajian ContentType its YouTube capability exclusively through the injected youtubeFetcher, without leaking fetch or `c.env` into the shared module. After this ticket, creating a kajian can auto-populate title/description from YouTube and the preview endpoint works, while news/blog remain unaffected.

**Blocked by:** 04: Create PublishableContent with Slug loop and server-owned timestamps

**Status:** ready-for-agent

- [ ] `kajianAdapter` alone carries `withYouTube` and uses injected `youtubeFetcher(videoId)→{title,description}`; news/blog adapters have no youtube path
- [ ] `youtubeLink` validated against watch/youtu.be/live patterns; invalid link → Validation 400
- [ ] When title or description missing, fetcher called; fetcher throw → warn and require manual title/description, fetcher success → populates missing fields
- [ ] Preview capability `fetchYouTubeData?videoId` preserved via adapter with fetcher mock covering throw vs success
