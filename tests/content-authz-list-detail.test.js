import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { createContentModule } from '../src/modules/content/index.js';
import { createContentRouter } from '../src/modules/content/routes.js';
import { createFakeDb, createFakeMedia, createFakeYoutubeFetcher } from './fakes.js';

// Regression for 01-authz-list-detail: admin sees drafts via optional token,
// anon stays published-only and never bumps ViewCount on drafts.

const SECRET = 'test-authz-list-detail-secret';

function seedDb() {
  return createFakeDb({
    users: [{ id: 'u1', nama: 'Admin Satu', username: 'admin1' }],
    campaigns: [{ id: 'camp1', title: 'Campaign Satu', imageUrl: 'https://img/c1.webp' }],
    news: [
      { id: 'n1', title: 'Berita Published', slug: 'berita-published', content: 'isi', category: 'umum', status: 'published', authorId: 'u1', campaignId: 'camp1', viewCount: 0, createdAt: new Date('2024-01-01T00:00:00Z'), updatedAt: new Date('2024-01-01T00:00:00Z') },
      { id: 'n2', title: 'Berita Draft', slug: 'berita-draft', content: 'isi draft', category: 'umum', status: 'draft', authorId: 'u1', campaignId: null, viewCount: 0, createdAt: new Date('2024-01-02T00:00:00Z'), updatedAt: new Date('2024-01-02T00:00:00Z') },
    ],
    blogs: [],
    kajians: [],
  });
}

function mod(db) {
  return createContentModule({ db, media: createFakeMedia(), youtubeFetcher: createFakeYoutubeFetcher() });
}

function testApp(db) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.route('/', createContentRouter('news'));
  return app;
}

const admin = { userId: 'u1', role: 'admin' };
const adminToken = jwt.sign(admin, SECRET);

describe('authz list: ?status=all/draft', () => {
  it('anon status=all stays published', async () => {
    const m = mod(seedDb());
    const res = await m.list('news', { status: 'all' }, null);
    expect(res.total).toBe(1);
    expect(res.items.every((i) => i.status === 'published')).toBe(true);
  });

  it('admin status=all/draft visible', async () => {
    const m = mod(seedDb());
    expect((await m.list('news', { status: 'all' }, admin)).total).toBe(2);
    const draft = await m.list('news', { status: 'draft' }, admin);
    expect(draft.total).toBe(1);
    expect(draft.items[0].slug).toBe('berita-draft');
  });
});

describe('authz detail: draft slug', () => {
  it('anon draft → 404 with no ViewCount bump', async () => {
    const db = seedDb();
    const m = mod(db);
    await expect(m.getBySlug('news', 'berita-draft')).rejects.toMatchObject({ statusCode: 404 });
    expect(db.__tables.news.find((r) => r.slug === 'berita-draft').viewCount).toBe(0);
  });

  it('admin draft → 200 with ViewCount bump', async () => {
    const m = mod(seedDb());
    const item = await m.getBySlug('news', 'berita-draft', admin);
    expect(item.slug).toBe('berita-draft');
    expect(item.viewCount).toBe(1);
  });
});

describe('authz routes: optional token', () => {
  it('GET / anon 200 published; status=all anon stays published; admin sees all', async () => {
    const app = testApp(seedDb());
    const anon = await (await app.request('/', {}, { JWT_SECRET: SECRET })).json();
    expect(anon.total).toBe(1);
    const anonAll = await (await app.request('/?status=all', {}, { JWT_SECRET: SECRET })).json();
    expect(anonAll.total).toBe(1);
    const adminAll = await (
      await app.request('/?status=all', { headers: { Authorization: `Bearer ${adminToken}` } }, { JWT_SECRET: SECRET })
    ).json();
    expect(adminAll.total).toBe(2);
  });

  it('GET /:slug anon draft 404 no bump; admin 200', async () => {
    const db = seedDb();
    const app = testApp(db);
    const anon = await app.request('/berita-draft', {}, { JWT_SECRET: SECRET });
    expect(anon.status).toBe(404);
    expect(db.__tables.news.find((r) => r.slug === 'berita-draft').viewCount).toBe(0);
    const withAdmin = await app.request('/berita-draft', { headers: { Authorization: `Bearer ${adminToken}` } }, { JWT_SECRET: SECRET });
    expect(withAdmin.status).toBe(200);
  });

  it('GET /latest and /campaign/:campaignId stay published-only for admin', async () => {
    const app = testApp(seedDb());
    const headers = { Authorization: `Bearer ${adminToken}` };
    const latest = await (await app.request('/latest', { headers }, { JWT_SECRET: SECRET })).json();
    expect(latest.map((i) => i.slug)).toEqual(['berita-published']);
    const camp = await (await app.request('/campaign/camp1', { headers }, { JWT_SECRET: SECRET })).json();
    expect(camp.total).toBe(1);
  });
});
