import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createContentModule } from '../src/modules/content/index.js';
import { createContentRouter } from '../src/modules/content/routes.js';
import { createFakeDb, createFakeMedia, createFakeYoutubeFetcher } from './fakes.js';
import { ValidationError } from '../src/modules/content/errors.js';

// Regression for 02-validate-status-createdat: only draft|published persist,
// admin createdAt override requires strict ISO-8601, non-admin stays server-owned.

function seedDb(news = []) {
  return createFakeDb({
    users: [{ id: 'u1', nama: 'Admin Satu', username: 'admin1' }],
    campaigns: [],
    news,
    blogs: [],
    kajians: [],
  });
}

function mod(db) {
  return createContentModule({ db, media: createFakeMedia(), youtubeFetcher: createFakeYoutubeFetcher() });
}

const admin = { userId: 'u1', role: 'admin' };
const author = { userId: 'u1', role: 'user' };
const dto = (overrides = {}) => ({ title: 'Judul', content: 'isi', category: 'umum', status: 'published', ...overrides });
const row = (overrides = {}) => ({
  id: 'n1', title: 'P', slug: 'p', content: 'x', category: 'umum', status: 'published',
  authorId: 'u1', campaignId: null, viewCount: 0,
  createdAt: new Date('2024-01-01T00:00:00Z'), updatedAt: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

describe('create status whitelist', () => {
  it('rejects status=archived (and arbitrary) with 400 like update', async () => {
    const m = mod(seedDb());
    await expect(m.create('news', dto({ status: 'archived' }), admin)).rejects.toThrow(ValidationError);
    try {
      await m.create('news', dto({ status: 'archived' }), admin);
    } catch (e) {
      expect(e.statusCode).toBe(400);
    }
    await expect(m.create('news', dto({ status: 'deleted' }), admin)).rejects.toThrow(ValidationError);
  });

  it('accepts draft|published', async () => {
    const m = mod(seedDb());
    expect((await m.create('news', dto({ status: 'draft' }), admin)).status).toBe('draft');
    expect((await m.create('news', dto({ status: 'published' }), admin)).status).toBe('published');
  });
});

describe('list status validation', () => {
  it('admin ?status=archived → 400 (memory + drizzle share resolveStatusFilter)', async () => {
    const m = mod(seedDb([row()]));
    await expect(m.list('news', { status: 'archived' }, admin)).rejects.toThrow(ValidationError);
  });

  it('anon ?status=archived falls back to published (documented, never 400)', async () => {
    const m = mod(seedDb([row()]));
    const res = await m.list('news', { status: 'archived' }, null);
    expect(res.total).toBe(1);
  });

  it('maps to HTTP 400 via route (not 500)', async () => {
    const app = new Hono();
    const db = seedDb([row()]);
    app.use('*', async (c, next) => {
      c.set('db', db);
      c.set('user', admin);
      await next();
    });
    app.route('/', createContentRouter('news'));
    const res = await app.request('/?status=archived');
    expect(res.status).toBe(400);
  });
});

describe('createdAt strict ISO-8601', () => {
  it('admin loose values rejected (new Date laxness not enough)', async () => {
    const m = mod(seedDb());
    for (const v of ['May 1, 2020', '2020/05/01', '2020-02-30', '2024-13-01', 1234567890]) {
      await expect(m.create('news', dto({ createdAt: v }), admin)).rejects.toThrow(ValidationError);
    }
  });

  it('admin strict ISO accepted on create + update', async () => {
    const m = mod(seedDb());
    const created = await m.create('news', dto({ createdAt: '2020-05-01T00:00:00.000Z' }), admin);
    expect(new Date(created.createdAt).toISOString()).toBe('2020-05-01T00:00:00.000Z');

    const m2 = mod(seedDb([row()]));
    const updated = await m2.update({ type: 'news', id: 'n1', createdAt: '2020-05-01T00:00:00.000Z' }, admin);
    expect(new Date(updated.createdAt).toISOString()).toBe('2020-05-01T00:00:00.000Z');
    await expect(m2.update({ type: 'news', id: 'n1', createdAt: '2020/05/01' }, admin)).rejects.toThrow(ValidationError);
  });

  it('non-admin createdAt ignored (server-owned, never 400)', async () => {
    const m = mod(seedDb());
    const before = Date.now();
    const created = await m.create('news', dto({ createdAt: '2000-01-01T00:00:00.000Z' }), author);
    expect(new Date(created.createdAt).getTime()).toBeGreaterThanOrEqual(before);

    const m2 = mod(seedDb([row()]));
    const updated = await m2.update({ type: 'news', id: 'n1', title: 'T2', createdAt: 'not-iso-loose' }, author);
    expect(updated.title).toBe('T2');
  });
});
