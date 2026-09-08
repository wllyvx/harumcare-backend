import { Hono } from 'hono';
import { getAdapter, toLegacyDetailEnvelope, toLegacyListEnvelope } from './adapters.js';
import { contentForRequest, handleContentError } from '../../controllers/contentController.js';
import { authenticateToken } from '../../middleware/auth.js';

const DELETE_MESSAGES = {
  news: 'Berita berhasil dihapus',
  blog: 'Blog berhasil dihapus',
  kajian: 'Kajian berhasil dihapus',
};

// Thin route adapter: every handler delegates to `content.for(ContentType)`.
// Legacy envelopes preserved for frontend compat:
// - list/campaign → toLegacyListEnvelope (news/totalNews, blogs/totalBlogs, kajians/totalKajians + currentPage)
// - detail → toLegacyDetailEnvelope (relatedCampaign for withCampaign types)
// - latest → raw items array (legacy shape)
export function createContentRouter(type, opts = {}) {
  const adapter = getAdapter(type);
  const router = new Hono();
  const deleteMessage = opts.deleteMessage || DELETE_MESSAGES[adapter.type] || 'Berhasil dihapus';

  const userOf = (c) => c.get('user') ?? null;

  // GET / — paginated list with filters (page/limit/category/status/campaignId/q)
  router.get('/', async (c) => {
    try {
      const content = contentForRequest(c, adapter.type);
      const result = await content.list(c.req.query(), userOf(c));
      return c.json(toLegacyListEnvelope(adapter.type, result));
    } catch (e) {
      return handleContentError(c, e);
    }
  });

  // GET /latest — recent published items (legacy: raw array)
  router.get('/latest', async (c) => {
    try {
      const content = contentForRequest(c, adapter.type);
      const query = c.req.query();
      const result = await content.list(
        {
          limit: query.limit ?? '5',
          campaignId: query.campaignId,
          status: 'published',
        },
        userOf(c),
      );
      return c.json(result.items);
    } catch (e) {
      return handleContentError(c, e);
    }
  });

  // GET /categories — distinct values per ContentType
  router.get('/categories', async (c) => {
    try {
      const content = contentForRequest(c, adapter.type);
      const categories = await content.categories();
      return c.json(categories);
    } catch (e) {
      return handleContentError(c, e);
    }
  });

  // GET /campaign/:campaignId — paginated list scoped to a Campaign (news/blog legacy)
  // Registered only for withCampaign types; kajian has no campaign link.
  if (adapter.withCampaign) {
    router.get('/campaign/:campaignId', async (c) => {
      try {
        const content = contentForRequest(c, adapter.type);
        const query = c.req.query();
        const result = await content.list(
          {
            ...query,
            campaignId: c.req.param('campaignId'),
            status: 'published',
          },
          userOf(c),
        );
        return c.json(toLegacyListEnvelope(adapter.type, result));
      } catch (e) {
        return handleContentError(c, e);
      }
    });
  }

  // GET /fetch-youtube — kajian preview via injected youtubeFetcher.
  // Must precede /:slug so the literal path is not captured as a Slug.
  if (adapter.withYouTube) {
    router.get('/fetch-youtube', async (c) => {
      try {
        const content = contentForRequest(c, adapter.type);
        const data = await content.fetchYouTubeData(c.req.query('videoId'));
        return c.json(data);
      } catch (e) {
        return handleContentError(c, e);
      }
    });
  }

  // GET /:slug — detail with atomic ViewCount + Author/CampaignRef
  router.get('/:slug', async (c) => {
    try {
      const content = contentForRequest(c, adapter.type);
      const item = await content.getBySlug(c.req.param('slug'));
      return c.json(toLegacyDetailEnvelope(adapter.type, item));
    } catch (e) {
      return handleContentError(c, e);
    }
  });

  // POST / — create (auth guard preserved)
  router.post('/', authenticateToken, async (c) => {
    try {
      const content = contentForRequest(c, adapter.type);
      const body = await c.req.json();
      const item = await content.create(body, userOf(c));
      return c.json(item, 201);
    } catch (e) {
      return handleContentError(c, e);
    }
  });

  // PUT /:id — update with ownership (auth guard preserved)
  router.put('/:id', authenticateToken, async (c) => {
    try {
      const content = contentForRequest(c, adapter.type);
      const body = await c.req.json();
      const updated = await content.update(c.req.param('id'), body, userOf(c));
      return c.json(updated);
    } catch (e) {
      return handleContentError(c, e);
    }
  });

  // DELETE /:id — remove with ownership + best-effort media (auth guard preserved)
  router.delete('/:id', authenticateToken, async (c) => {
    try {
      const content = contentForRequest(c, adapter.type);
      await content.remove(c.req.param('id'), userOf(c));
      return c.json({ message: deleteMessage });
    } catch (e) {
      return handleContentError(c, e);
    }
  });

  return router;
}
