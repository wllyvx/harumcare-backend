import { describe, it, expect } from 'vitest';
import { createContentModule } from '../src/modules/content/index.js';
import { createFakeDb, createFakeMedia, createFakeYoutubeFetcher } from './fakes.js';
import { ValidationError } from '../src/modules/content/errors.js';

// Seam under test: contentModule list + categories (ticket 02).
// Vocabulary per CONTEXT.md: PublishableContent, ContentType, Author, CampaignRef.

function seedDb() {
  const users = [
    { id: 'u1', nama: 'Admin Satu', username: 'admin1' },
    { id: 'u2', nama: 'Author Dua', username: 'author2' },
  ];
  const campaigns = [
    { id: 'camp1', title: 'Campaign Satu', imageUrl: 'https://img/c1.webp' },
    { id: 'camp2', title: 'Campaign Dua', imageUrl: 'https://img/c2.webp' },
  ];
  const news = [
    { id: 'n1', title: 'Berita Umum Satu', slug: 'berita-umum-satu', content: 'isi satu', category: 'umum', status: 'published', authorId: 'u1', campaignId: 'camp1', viewCount: 0, createdAt: new Date('2024-01-03T00:00:00Z'), updatedAt: new Date('2024-01-03T00:00:00Z') },
    { id: 'n2', title: 'Berita Umum Dua', slug: 'berita-umum-dua', content: 'isi dua', category: 'umum', status: 'published', authorId: 'u2', campaignId: null, viewCount: 0, createdAt: new Date('2024-01-02T00:00:00Z'), updatedAt: new Date('2024-01-02T00:00:00Z') },
    { id: 'n3', title: 'Berita Draft Teknologi', slug: 'berita-draft-teknologi', content: 'isi draft', category: 'teknologi', status: 'draft', authorId: 'u1', campaignId: null, viewCount: 0, createdAt: new Date('2024-01-04T00:00:00Z'), updatedAt: new Date('2024-01-04T00:00:00Z') },
    { id: 'n4', title: 'Diskon 100%_x Spesial', slug: 'diskon-100-x-spesial', content: 'promo spesial', category: 'promo', status: 'published', authorId: 'u2', campaignId: 'camp2', viewCount: 0, createdAt: new Date('2024-01-01T00:00:00Z'), updatedAt: new Date('2024-01-01T00:00:00Z') },
    { id: 'n5', title: 'Berita Teknologi Published', slug: 'berita-teknologi-published', content: 'isi teknologi', category: 'teknologi', status: 'published', authorId: 'u1', campaignId: 'camp1', viewCount: 0, createdAt: new Date('2024-01-05T00:00:00Z'), updatedAt: new Date('2024-01-05T00:00:00Z') },
  ];
  return createFakeDb({ users, campaigns, news, blogs: [], kajians: [] });
}

function mod(db) {
  return createContentModule({ db, media: createFakeMedia(), youtubeFetcher: createFakeYoutubeFetcher() });
}

const admin = { userId: 'u1', role: 'admin' };

describe('contentModule list pagination', () => {
  it('defaults page 1 limit 10 and returns {items,total,page,totalPages} with ceil + offset + desc(createdAt)', async () => {
    const m = mod(seedDb());
    const res = await m.list('news', {});
    // 4 published news (n1,n2,n4,n5); draft n3 excluded for anon
    expect(res.total).toBe(4);
    expect(res.page).toBe(1);
    expect(res.totalPages).toBe(1);
    expect(res.items).toHaveLength(4);
    // desc(createdAt): n5 (01-05), n1 (01-03), n2 (01-02), n4 (01-01)
    expect(res.items.map((i) => i.id)).toEqual(['n5', 'n1', 'n2', 'n4']);
  });

  it('paginates with offset: page 2 limit 2', async () => {
    const m = mod(seedDb());
    const res = await m.list('news', { page: '2', limit: '2' });
    expect(res.total).toBe(4);
    expect(res.page).toBe(2);
    expect(res.totalPages).toBe(2);
    expect(res.items.map((i) => i.id)).toEqual(['n2', 'n4']);
  });

  it('clamps page 1..1000 and limit 1..50', async () => {
    const m = mod(seedDb());
    const a = await m.list('news', { page: '0', limit: '9999' });
    expect(a.page).toBe(1);
    // limit clamped to 50 -> totalPages ceil(4/50)=1
    expect(a.totalPages).toBe(1);
    const b = await m.list('news', { page: '5000', limit: '1' });
    expect(b.page).toBe(1000);
    expect(b.totalPages).toBe(4);
    expect(b.items).toEqual([]);
  });

  it('rejects non-numeric/Infinity page/limit with Validation 400', async () => {
    const m = mod(seedDb());
    await expect(m.list('news', { page: 'abc' })).rejects.toThrow(ValidationError);
    await expect(m.list('news', { page: 'NaN' })).rejects.toThrow(ValidationError);
    await expect(m.list('news', { page: 'Infinity' })).rejects.toThrow(ValidationError);
    await expect(m.list('news', { limit: 'Infinity' })).rejects.toThrow(ValidationError);
    try {
      await m.list('news', { page: 'abc' });
    } catch (e) {
      expect(e.statusCode).toBe(400);
    }
  });
});

describe('contentModule list status gating', () => {
  it('defaults to published for anon/public', async () => {
    const m = mod(seedDb());
    const res = await m.list('news', {});
    expect(res.items.every((i) => i.status === 'published')).toBe(true);
  });

  it('forces published for non-admin even with status=all|draft', async () => {
    const m = mod(seedDb());
    const all = await m.list('news', { status: 'all' }, { userId: 'u2', role: 'user' });
    expect(all.total).toBe(4);
    const draft = await m.list('news', { status: 'draft' }, null);
    expect(draft.total).toBe(4);
    expect(draft.items.every((i) => i.status === 'published')).toBe(true);
  });

  it('honors status=all and status=draft only for admin', async () => {
    const m = mod(seedDb());
    const all = await m.list('news', { status: 'all' }, admin);
    expect(all.total).toBe(5);
    const draft = await m.list('news', { status: 'draft' }, admin);
    expect(draft.total).toBe(1);
    expect(draft.items[0].id).toBe('n3');
  });
});

describe('contentModule list filters + join shaping', () => {
  it('combines search+category+campaignId into correct total/items', async () => {
    const m = mod(seedDb());
    const res = await m.list('news', { search: 'teknologi', category: 'teknologi', campaignId: 'camp1' }, admin);
    // n5 matches all three; n3 is draft+no campaign so excluded
    expect(res.total).toBe(1);
    expect(res.items[0].id).toBe('n5');
  });

  it('supports q alias and escapes %_\\ wildcards (no broadening)', async () => {
    const m = mod(seedDb());
    const res = await m.list('news', { q: '100%_x' });
    expect(res.total).toBe(1);
    expect(res.items[0].id).toBe('n4');
    // wildcard-only query must not broaden: literal % matches only the promo row, not everything
    const wild = await m.list('news', { q: '%' });
    expect(wild.total).toBe(1);
    expect(wild.items[0].id).toBe('n4');
  });

  it('populates Author {nama,username} and CampaignRef {title,imageUrl} with campaignId FK preserved', async () => {
    const m = mod(seedDb());
    const res = await m.list('news', { campaignId: 'camp1' });
    expect(res.total).toBe(2);
    const first = res.items.find((i) => i.id === 'n5');
    expect(first.author).toEqual({ nama: 'Admin Satu', username: 'admin1' });
    expect(first.campaignId).toBe('camp1');
    expect(first.campaign).toEqual({ title: 'Campaign Satu', imageUrl: 'https://img/c1.webp' });
    const nocamp = (await m.list('news', { search: 'Umum Dua' })).items[0];
    expect(nocamp.campaign).toBeNull();
    expect(nocamp.campaignId).toBeNull();
  });

  it('works through for(type) bound seam too', async () => {
    const m = mod(seedDb());
    const res = await m.for('news').list({ page: 1, limit: 10 });
    expect(res.total).toBe(4);
  });
});

describe('contentModule categories', () => {
  it('returns distinct values per ContentType', async () => {
    const db = seedDb();
    db.__tables.blogs.push(
      { id: 'b1', title: 'Blog Edukasi', slug: 'blog-edukasi', content: 'x', category: 'edukasi', status: 'published', authorId: 'u1', campaignId: null, viewCount: 0, createdAt: new Date('2024-02-01T00:00:00Z'), updatedAt: new Date('2024-02-01T00:00:00Z') },
      { id: 'b2', title: 'Blog Edukasi Dua', slug: 'blog-edukasi-dua', content: 'y', category: 'edukasi', status: 'published', authorId: 'u1', campaignId: null, viewCount: 0, createdAt: new Date('2024-02-02T00:00:00Z'), updatedAt: new Date('2024-02-02T00:00:00Z') },
    );
    const m = mod(db);
    expect(await m.categories('news')).toEqual(expect.arrayContaining(['umum', 'teknologi', 'promo']));
    expect((await m.categories('news'))).toHaveLength(3);
    expect(await m.categories('blog')).toEqual(['edukasi']);
  });
});

describe('legacy envelope compat', () => {
  it('adapter maps items/total to news/totalNews etc', async () => {
    const { toLegacyListEnvelope } = await import('../src/modules/content/adapters.js');
    const m = mod(seedDb());
    const res = await m.list('news', { limit: 2 });
    const legacy = toLegacyListEnvelope('news', res);
    expect(legacy.news).toBe(res.items);
    expect(legacy.totalNews).toBe(res.total);
    expect(legacy.currentPage).toBe(res.page);
    expect(legacy.totalPages).toBe(res.totalPages);
    const blogLegacy = toLegacyListEnvelope('blog', { items: [], total: 0, page: 1, totalPages: 0 });
    expect(blogLegacy.blogs).toEqual([]);
    expect(blogLegacy.totalBlogs).toBe(0);
    const kajianLegacy = toLegacyListEnvelope('kajian', { items: [], total: 0, page: 1, totalPages: 0 });
    expect(kajianLegacy.kajians).toEqual([]);
    expect(kajianLegacy.totalKajians).toBe(0);
  });
});
