# 01: Setup harness and pure helpers behind content seam

**What to build:** Establish the deep content seam test harness and pure helpers so every later vertical slice can be verified without Hono or real D1/R2/fetch. After this ticket, `npm test` runs green with in-memory fakes and the content module factory is importable via DI.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Vitest harness runs with in-memory D1 fake, media Map fake, and youtubeFetcher mock; content seam factory callable as `createContentModule({db, media, youtubeFetcher})` without `c`/`c.env`
- [x] Pure helpers `slugify`, `escapeLike`, `clampPageLimit` pass unit cases: slugify lowercases and `[^a-z0-9]+`→`-`, escapeLike escapes `%`/`_`/`\`, clamp enforces page 1..1000 limit 1..50 default 10 and non-numeric → validation error
- [x] Content module interface stubbed: `list`, `getBySlug`, `create`, `update`, `remove`, `categories` exist with correct arity and DI shape (`db`/`media`/`youtubeFetcher`)
- [x] `npm test` passes with no real D1/R2/network dependency
