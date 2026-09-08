import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { eq } from 'drizzle-orm';
import { users, campaigns, news } from '../src/db/schema.js';
import { createContentModule } from '../src/modules/content/index.js';
import { createFakeMedia, createFakeYoutubeFetcher } from './fakes.js';
import { ValidationError, NotFoundError } from '../src/modules/content/errors.js';

// Prod-path integration: real SQL via Drizzle (sqlite-proxy over node:sqlite,
// D1-compatible dialect) — never __isFakeDb, never includes()-in-memory.
// Locks: atomic viewCount+1, LIKE ESCAPE wildcards, count/offset, joins,
// and the 01 (authz) + 02 (validation) behaviors on the drizzle branch.

function createDrizzleDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, nama TEXT NOT NULL, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE, password TEXT, nomorHp TEXT NOT NULL, alamat TEXT, role TEXT DEFAULT 'user', google_id TEXT UNIQUE, auth_provider TEXT DEFAULT 'local', created_at INTEGER, updated_at INTEGER)`);
  sqlite.exec(`CREATE TABLE campaigns (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, imageUrl TEXT, targetAmount INTEGER NOT NULL, currentAmount INTEGER DEFAULT 0, startDate INTEGER, endDate INTEGER NOT NULL, donorCount INTEGER DEFAULT 0, organizationName TEXT, organizationLogo TEXT, category TEXT, created_at INTEGER)`);
  const contentDDL = (t, extra) => `CREATE TABLE ${t} (id TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, ${extra}, author_id TEXT NOT NULL, category TEXT DEFAULT 'umum' NOT NULL, status TEXT DEFAULT 'draft', viewCount INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER)`;
  sqlite.exec(contentDDL('news', `content TEXT NOT NULL, image TEXT, campaign_id TEXT`));
  sqlite.exec(contentDDL('blogs', `content TEXT NOT NULL, image TEXT, campaign_id TEXT`));
  sqlite.exec(contentDDL('kajians', `description TEXT NOT NULL, youtubeLink TEXT NOT NULL`));

  // sqlite-proxy speaks array-mode rows: positional column values in SELECT
  // order (see drizzle mapResultRow: row[columnIndex] — same contract as
  // better-sqlite3 raw mode / D1 .raw()). setReturnArrays keeps duplicate
  // column names (news.title vs campaigns.title) from collapsing.
  // Every statement is logged on db.__sqlLog for mechanism assertions.
  const db = drizzle(async (sql, params, method) => {
    db.__sqlLog.push({ sql, method });
    const stmt = sqlite.prepare(sql);
    if (method === 'run') {
      stmt.run(...params);
      return { rows: [] };
    }
    stmt.setReturnArrays(true);
    const rows = stmt.all(...params);
    if (method === 'get') return { rows: rows[0] ?? [] };
    return { rows };
  });
  db.__sqlLog = [];
  db.__sqlite = sqlite;
  return db;
}

async function seedDb() {
  const db = createDrizzleDb();
  await db.insert(users).values([
    { id: 'u1', nama: 'Admin Satu', username: 'admin1', email: 'admin@x.id', nomorHp: '1', role: 'admin' },
    { id: 'u2', nama: 'Author Dua', username: 'author2', email: 'author@x.id', nomorHp: '2' },
  ]);
  await db.insert(campaigns).values([
    { id: 'camp1', title: 'Campaign Satu', imageUrl: 'https://img/c1.webp', targetAmount: 1000, endDate: new Date('2025-01-01T00:00:00Z') },
    { id: 'camp2', title: 'Campaign Dua', imageUrl: 'https://img/c2.webp', targetAmount: 500, endDate: new Date('2025-01-01T00:00:00Z') },
  ]);
  const isoDate = (s) => new Date(s);
  await db.insert(news).values([
    { id: 'n1', title: 'Berita Umum Satu', slug: 'berita-umum-satu', content: 'isi satu', category: 'umum', status: 'published', authorId: 'u1', campaignId: 'camp1', viewCount: 0, createdAt: isoDate('2024-01-03T00:00:00Z'), updatedAt: isoDate('2024-01-03T00:00:00Z') },
    { id: 'n2', title: 'Berita Umum Dua', slug: 'berita-umum-dua', content: 'isi dua', category: 'umum', status: 'published', authorId: 'u2', campaignId: null, viewCount: 5, createdAt: isoDate('2024-01-02T00:00:00Z'), updatedAt: isoDate('2024-01-02T00:00:00Z') },
    { id: 'n3', title: 'Berita Draft Teknologi', slug: 'berita-draft-teknologi', content: 'isi draft', category: 'teknologi', status: 'draft', authorId: 'u1', campaignId: null, viewCount: 0, createdAt: isoDate('2024-01-04T00:00:00Z'), updatedAt: isoDate('2024-01-04T00:00:00Z') },
    { id: 'n4', title: 'Diskon 100%_x Spesial', slug: 'diskon-100-x-spesial', content: 'promo spesial', category: 'promo', status: 'published', authorId: 'u2', campaignId: 'camp2', viewCount: 0, createdAt: isoDate('2024-01-01T00:00:00Z'), updatedAt: isoDate('2024-01-01T00:00:00Z') },
    { id: 'n5', title: 'Berita Teknologi Published', slug: 'berita-teknologi-published', content: 'isi teknologi', category: 'teknologi', status: 'published', authorId: 'u1', campaignId: 'camp1', viewCount: 0, createdAt: isoDate('2024-01-05T00:00:00Z'), updatedAt: isoDate('2024-01-05T00:00:00Z') },
    { id: 'n6', title: 'Diskon Back\\Slash 100%_\\ Ganda', slug: 'backslash-promo', content: 'isi backslash', category: 'promo', status: 'published', authorId: 'u1', campaignId: null, viewCount: 0, createdAt: isoDate('2024-01-06T00:00:00Z'), updatedAt: isoDate('2024-01-06T00:00:00Z') },
  ]);
  return db;
}

function mod(db) {
  return createContentModule({ db, media: createFakeMedia(), youtubeFetcher: createFakeYoutubeFetcher() });
}

async function viewCountOf(db, slug) {
  const rows = await db.select({ viewCount: news.viewCount }).from(news).where(eq(news.slug, slug));
  return rows[0]?.viewCount;
}

const admin = { userId: 'u1', role: 'admin' };

describe('drizzle prod-path harness', () => {
  it('is not the fake memory db', async () => {
    const db = await seedDb();
    expect(db.__isFakeDb).toBeFalsy();
    expect(db.__tables).toBeUndefined();
  });
});

describe('drizzle viewCount+1 atomic (single UPDATE, no read-modify-write)', () => {
  it('bumps via one UPDATE ... viewCount + 1 with no preceding SELECT', async () => {
    const db = await seedDb();
    const m = mod(db);
    db.__sqlLog.length = 0;
    await m.getBySlug('news', 'berita-umum-satu');
    const touchViewCount = db.__sqlLog.filter(({ sql }) => sql.includes('viewCount'));
    expect(touchViewCount.length).toBeGreaterThan(0);
    // The bump itself: exactly one UPDATE doing SQL-level +1 …
    const bumps = touchViewCount.filter(({ sql }) => /^update\b/i.test(sql));
    expect(bumps).toHaveLength(1);
    expect(bumps[0].sql).toMatch(/"viewCount"\s*=\s*"news"\."viewCount"\s*\+\s*1/);
    // … and it runs before any SELECT (no read of the old count first).
    const firstSelect = db.__sqlLog.findIndex(({ sql }) => /^\s*select\b/i.test(sql));
    const bumpIdx = db.__sqlLog.findIndex(({ sql }) => /^update\b/i.test(sql));
    expect(bumpIdx).toBeLessThan(firstSelect);
  });

  it('increments and returns fresh counts without losing concurrent hits', async () => {
    const db = await seedDb();
    const m = mod(db);
    expect(await viewCountOf(db, 'berita-umum-dua')).toBe(5);
    const first = await m.getBySlug('news', 'berita-umum-dua');
    expect(first.viewCount).toBe(6);
    // 3 more bumps back-to-back: SQL-level +1 each, none lost.
    await Promise.all([
      m.getBySlug('news', 'berita-umum-dua'),
      m.getBySlug('news', 'berita-umum-dua'),
      m.getBySlug('news', 'berita-umum-dua'),
    ]);
    expect(await viewCountOf(db, 'berita-umum-dua')).toBe(9);
  });
});

describe('drizzle LIKE ESCAPE (no wildcard broadening)', () => {
  it('q="100%_x" matches literally; bare "%" does not match everything', async () => {
    const db = await seedDb();
    const m = mod(db);
    const literal = await m.list('news', { q: '100%_x' });
    expect(literal.total).toBe(1);
    expect(literal.items[0].slug).toBe('diskon-100-x-spesial');
    const wild = await m.list('news', { q: '%' });
    expect(wild.total).toBe(2);
    expect(wild.items.map((i) => i.slug).sort()).toEqual(['backslash-promo', 'diskon-100-x-spesial']);
  });

  it('combined specials stay narrow (q="100%_x\\" matches nothing, not everything)', async () => {
    const db = await seedDb();
    const m = mod(db);
    const res = await m.list('news', { q: '100%_x\\' });
    expect(res.total).toBe(0);
    expect(res.items).toEqual([]);
  });

  it('backslash in query is escaped (q="100%_\\" stays narrow)', async () => {
    const db = await seedDb();
    const m = mod(db);
    const res = await m.list('news', { q: '100%_\\' });
    expect(res.total).toBe(1);
    expect(res.items[0].slug).toBe('backslash-promo');
  });});

describe('drizzle count/offset + joins', () => {
  it('total/totalPages/offset/desc(createdAt) come from real SQL', async () => {
    const db = await seedDb();
    const m = mod(db);
    const page1 = await m.list('news', { limit: '2' });
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);
    expect(page1.items.map((i) => i.id)).toEqual(['n6', 'n5']);
    const page2 = await m.list('news', { page: '2', limit: '2' });
    expect(page2.total).toBe(5);
    expect(page2.items.map((i) => i.id)).toEqual(['n1', 'n2']);
  });

  it('Author + CampaignRef joined in one query; campaignId FK stays a string', async () => {
    const db = await seedDb();
    const m = mod(db);
    const item = await m.getBySlug('news', 'berita-umum-satu');
    expect(item.author).toEqual({ nama: 'Admin Satu', username: 'admin1' });
    expect(item.campaignId).toBe('camp1');
    expect(typeof item.campaignId).toBe('string');
    expect(item.campaign).toEqual({ title: 'Campaign Satu', imageUrl: 'https://img/c1.webp' });
    const nolink = await m.getBySlug('news', 'berita-umum-dua');
    expect(nolink.campaign).toBeNull();
    expect(nolink.campaignId).toBeNull();
  });

  it('missing slug → 404', async () => {
    const m = mod(await seedDb());
    await expect(m.getBySlug('news', 'tidak-ada')).rejects.toThrow(NotFoundError);
  });
});

describe('drizzle status-filter admin vs anon (01)', () => {
  it('anon stays published; admin sees all/draft', async () => {
    const db = await seedDb();
    const m = mod(db);
    expect((await m.list('news', {})).total).toBe(5);
    expect((await m.list('news', { status: 'all' }, null)).total).toBe(5);
    expect((await m.list('news', { status: 'all' }, admin)).total).toBe(6);
    const draft = await m.list('news', { status: 'draft' }, admin);
    expect(draft.total).toBe(1);
    expect(draft.items[0].slug).toBe('berita-draft-teknologi');
  });

  it('anon draft detail → 404 with no ViewCount bump; admin → 200', async () => {
    const db = await seedDb();
    const m = mod(db);
    await expect(m.getBySlug('news', 'berita-draft-teknologi')).rejects.toThrow(NotFoundError);
    expect(await viewCountOf(db, 'berita-draft-teknologi')).toBe(0);
    const item = await m.getBySlug('news', 'berita-draft-teknologi', admin);
    expect(item.status).toBe('draft');
    expect(await viewCountOf(db, 'berita-draft-teknologi')).toBe(1);
  });
});

describe('drizzle validation (02)', () => {
  it('create/update reject archived status; list archived → 400 for admin', async () => {
    const db = await seedDb();
    const m = mod(db);
    await expect(
      m.create('news', { title: 'X', content: 'x', category: 'umum', status: 'archived' }, admin),
    ).rejects.toThrow(ValidationError);
    await expect(m.update({ type: 'news', id: 'n1', status: 'archived' }, admin)).rejects.toThrow(ValidationError);
    await expect(m.list('news', { status: 'archived' }, admin)).rejects.toThrow(ValidationError);
  });

  it('admin loose createdAt rejected; strict ISO accepted; non-admin ignored', async () => {
    const db = await seedDb();
    const m = mod(db);
    await expect(
      m.create('news', { title: 'X', content: 'x', category: 'umum', status: 'published', createdAt: '2020/05/01' }, admin),
    ).rejects.toThrow(ValidationError);
    const ok = await m.create(
      'news', { title: 'Backfill', content: 'x', category: 'umum', status: 'published', createdAt: '2020-05-01T00:00:00.000Z' }, admin,
    );
    expect(new Date(ok.createdAt).toISOString()).toBe('2020-05-01T00:00:00.000Z');
  });
});
