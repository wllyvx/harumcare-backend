import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createContentRouter } from '../src/modules/content/routes.js';
import { createFakeDb, createFakeMedia, createFakeYoutubeFetcher } from './fakes.js';

function seedDb() {
  const users = [{ id: 'u1', nama: 'Admin Satu', username: 'admin1' }];
  const campaigns = [{ id: 'camp1', title: 'Campaign Satu', imageUrl: 'https://img/c1.webp' }];
  const news = [
    {
      id: 'n1', title: 'Berita Satu', slug: 'berita-satu', content: 'isi satu',
      category: 'umum', status: 'published', authorId: 'u1', campaignId: 'camp1',
      image: 'images/empty-image-placeholder.webp', viewCount: 0,
      createdAt: new Date('2024-01-03T00:00:00Z'), updatedAt: new Date('2024-01-03T00:00:00Z'),
    },
  ];
  const blogs = [
    {
      id: 'b1', title: 'Blog Satu', slug: 'blog-satu', content: 'isi blog',
      category: 'edukasi', status: 'published', authorId: 'u1', campaignId: null,
      image: 'images/empty-image-placeholder.webp', viewCount: 0,
      createdAt: new Date('2024-02-01T00:00:00Z'), updatedAt: new Date('2024-02-01T00:00:00Z'),
    },
  ];
  const kajians = [
    {
      id: 'k1', title: 'Kajian Satu', slug: 'kajian-satu', description: 'deskripsi',
      youtubeLink: 'https://youtu.be/abc123', category: 'fikih', status: 'published',
      authorId: 'u1', viewCount: 0,
      createdAt: new Date('2024-03-01T00:00:00Z'), updatedAt: new Date('2024-03-01T00:00:00Z'),
    },
  ];
  return createFakeDb({ users, campaigns, news, blogs, kajians });
}

function testApp(type, db) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.route('/', createContentRouter(type));
  return app;
}

const routesOf = (router) => router.routes.map((r) => `${r.method} ${r.path}`);

describe('thin route wiring preserves mounts + auth guard', () => {
  it('news/blog expose GET /, /latest, /categories, /campaign/:campaignId, /:slug + POST/PUT/DELETE with auth', () => {
    for (const type of ['news', 'blog']) {
      const paths = routesOf(createContentRouter(type));
      expect(paths).toContain('GET /');
      expect(paths).toContain('GET /latest');
      expect(paths).toContain('GET /categories');
      expect(paths).toContain('GET /campaign/:campaignId');
      expect(paths).toContain('GET /:slug');
      expect(paths).toContain('POST /');
      expect(paths).toContain('PUT /:id');
      expect(paths).toContain('DELETE /:id');
    }
  });

  it('kajian exposes /fetch-youtube before /:slug and no /campaign route (no campaign link)', () => {
    const paths = routesOf(createContentRouter('kajian'));
    expect(paths).toContain('GET /fetch-youtube');
    expect(paths).toContain('GET /:slug');
    expect(paths).not.toContain('GET /campaign/:campaignId');
    const fetchIdx = paths.indexOf('GET /fetch-youtube');
    const slugIdx = paths.indexOf('GET /:slug');
    expect(fetchIdx).toBeLessThan(slugIdx);
  });

  it('mutating routes require auth (401 without token)', async () => {
    const app = testApp('news', seedDb());
    for (const [method, path, body] of [
      ['POST', '/', JSON.stringify({ title: 'x' })],
      ['PUT', '/n1', JSON.stringify({ title: 'x' })],
      ['DELETE', '/n1', undefined],
    ]) {
      const res = await app.request(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body,
      });
      expect(res.status).toBe(401);
    }
  });
});

describe('thin route legacy envelope compat via seam', () => {
  it('GET / maps {items,total,page,totalPages} to legacy keys per ContentType', async () => {
    const expectations = [
      ['news', 'news', 'totalNews'],
      ['blog', 'blogs', 'totalBlogs'],
      ['kajian', 'kajians', 'totalKajians'],
    ];
    for (const [type, itemsKey, totalKey] of expectations) {
      const app = testApp(type, seedDb());
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toBeDefined();
      expect(body.total).toBeDefined();
      expect(body.page).toBeDefined();
      expect(body.totalPages).toBeDefined();
      expect(body[itemsKey]).toEqual(body.items);
      expect(body[totalKey]).toBe(body.total);
      expect(body.currentPage).toBe(body.page);
    }
  });

  it('GET /latest returns a raw items array (legacy shape)', async () => {
    const app = testApp('news', seedDb());
    const res = await app.request('/latest');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'n1' })]),
    );
  });

  it('GET /categories returns distinct values via seam', async () => {
    const app = testApp('news', seedDb());
    const res = await app.request('/categories');
    expect(await res.json()).toEqual(['umum']);
  });

  it('GET /campaign/:campaignId paginates with legacy envelope (news/blog)', async () => {
    const app = testApp('news', seedDb());
    const res = await app.request('/campaign/camp1');
    const body = await res.json();
    expect(body.news).toHaveLength(1);
    expect(body.totalNews).toBe(1);
    expect(body.currentPage).toBe(1);
  });

  it('GET /:slug returns legacy detail (relatedCampaign for news/blog, none for kajian)', async () => {
    const newsApp = testApp('news', seedDb());
    const newsDetail = await (await newsApp.request('/berita-satu')).json();
    expect(newsDetail.campaignId).toBe('camp1');
    expect(newsDetail.campaign).toEqual({ title: 'Campaign Satu', imageUrl: 'https://img/c1.webp' });
    expect(newsDetail.relatedCampaign).toEqual(newsDetail.campaign);

    const kajianApp = testApp('kajian', seedDb());
    const kajianDetail = await (await kajianApp.request('/kajian-satu')).json();
    expect(kajianDetail.author).toEqual({ nama: 'Admin Satu', username: 'admin1' });
    expect('relatedCampaign' in kajianDetail).toBe(false);
  });

  it('GET /:slug missing maps to 404 (not 500)', async () => {
    const app = testApp('news', seedDb());
    const res = await app.request('/tidak-ada');
    expect(res.status).toBe(404);
  });

  it('GET / with invalid page maps to 400 Validation (not 500)', async () => {
    const app = testApp('news', seedDb());
    const res = await app.request('/?page=abc');
    expect(res.status).toBe(400);
  });
});

describe('thin route DI wiring across all ContentTypes (no constraint/race regression)', () => {
  it('full vertical path via seam: list→detail→create→update→delete→kajian youtube', async () => {
    const { createContentModule } = await import('../src/modules/content/index.js');
    const db = seedDb();
    const media = createFakeMedia();
    const youtubeFetcher = createFakeYoutubeFetcher();
    const mod = createContentModule({ db, media, youtubeFetcher });
    const author = { userId: 'u1', nama: 'Admin Satu', username: 'admin1', role: 'admin' };

    // list
    const listed = await mod.for('news').list({});
    expect(listed.total).toBe(1);
    // detail bumps ViewCount atomically
    const d1 = await mod.for('news').getBySlug('berita-satu');
    expect(d1.viewCount).toBe(1);
    // create with duplicate title → slug-2 loop (no constraint 400)
    const created = await mod.for('news').create(
      { title: 'Berita Satu', content: 'isi baru', category: 'umum', status: 'published' },
      author,
    );
    expect(created.slug).toBe('berita-satu-2');
    // update + best-effort media path
    const updated = await mod.for('news').update(created.id, { title: 'Berita Satu Revisi' }, author);
    expect(updated.title).toBe('Berita Satu Revisi');
    // delete
    await mod.for('news').remove(created.id, author);
    expect(db.__tables.news.find((r) => r.id === created.id)).toBeUndefined();
    // kajian youtube via DI (mocked, no network)
    const kajian = await mod.for('kajian').create(
      { youtubeLink: 'https://youtu.be/vid1', category: 'fikih', status: 'published' },
      author,
    );
    expect(kajian.title).toBe('Title vid1');
    const preview = await mod.for('kajian').fetchYouTubeData('vid1');
    expect(preview).toEqual({ title: 'Title vid1', description: 'Desc vid1' });
  });

  it('duplicated controllers/helpers removed; adapters own mapRow + CampaignRef', async () => {
    const { existsSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = join(here, '..', 'src');
    for (const gone of [
      'controllers/newsController.js',
      'controllers/blogController.js',
      'controllers/kajianController.js',
      'utils/dbHelpers.js',
      'utils/r2.js',
    ]) {
      expect(existsSync(join(src, gone))).toBe(false);
    }
    const { newsAdapter, blogAdapter, kajianAdapter } = await import(
      '../src/modules/content/adapters.js'
    );
    for (const adapter of [newsAdapter, blogAdapter, kajianAdapter]) {
      expect(typeof adapter.mapRow).toBe('function');
    }
    // CampaignRef shaping: campaign object separate from campaignId FK string
    const mod = (await import('../src/modules/content/index.js')).createContentModule({
      db: seedDb(),
      media: createFakeMedia(),
      youtubeFetcher: createFakeYoutubeFetcher(),
    });
    const item = await mod.for('news').getBySlug('berita-satu');
    expect(typeof item.campaignId).toBe('string');
    expect(item.campaign).toEqual({ title: 'Campaign Satu', imageUrl: 'https://img/c1.webp' });
  });
});
