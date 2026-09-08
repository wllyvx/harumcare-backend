import { describe, it, expect } from 'vitest';
import { createContentModule } from '../src/modules/content/index.js';
import { createFakeDb, createFakeMedia, createFakeYoutubeFetcher } from './fakes.js';
import { ValidationError, ForbiddenError } from '../src/modules/content/errors.js';

// Seam under test: contentModule create (ticket 04).
// Vocabulary per CONTEXT.md: PublishableContent, ContentType, Slug,
// Author, Campaign, CampaignRef.

function seedDb() {
  const users = [
    { id: 'u1', nama: 'Admin Satu', username: 'admin1' },
    { id: 'u2', nama: 'Author Dua', username: 'author2' },
  ];
  const campaigns = [
    { id: 'camp1', title: 'Campaign Satu', imageUrl: 'https://img/c1.webp' },
  ];
  return createFakeDb({ users, campaigns, news: [], blogs: [], kajians: [] });
}

function mod(db) {
  return createContentModule({ db, media: createFakeMedia(), youtubeFetcher: createFakeYoutubeFetcher() });
}

const admin = { userId: 'u1', nama: 'Admin Satu', username: 'admin1', role: 'admin' };
const author = { userId: 'u2', nama: 'Author Dua', username: 'author2', role: 'user' };

const newsDto = (overrides = {}) => ({
  title: 'Berita Baru',
  content: 'isi berita',
  category: 'umum',
  status: 'published',
  ...overrides,
});

describe('contentModule create slug loop', () => {
  it('generates Slug via slugify', async () => {
    const m = mod(seedDb());
    const item = await m.create('news', newsDto({ title: 'Hello World!!' }), author);
    expect(item.slug).toBe('hello-world');
  });

  it('uniques duplicates as base-2/base-3 without unique-constraint 400', async () => {
    const m = mod(seedDb());
    const a = await m.create('news', newsDto({ title: 'Berita Sama' }), author);
    const b = await m.create('news', newsDto({ title: 'Berita Sama' }), author);
    const c = await m.create('news', newsDto({ title: 'Berita Sama' }), author);
    expect(a.slug).toBe('berita-sama');
    expect(b.slug).toBe('berita-sama-2');
    expect(c.slug).toBe('berita-sama-3');
  });

  it('rejects titles that slugify to empty', async () => {
    const m = mod(seedDb());
    await expect(m.create('news', newsDto({ title: '!!!' }), author)).rejects.toThrow(ValidationError);
  });
});

describe('contentModule create campaign link', () => {
  it('stores campaignId as FK string and returns CampaignRef', async () => {
    const m = mod(seedDb());
    const item = await m.create('news', newsDto({ campaignId: 'camp1' }), author);
    expect(item.campaignId).toBe('camp1');
    expect(typeof item.campaignId).toBe('string');
    expect(item.campaign).toEqual({ title: 'Campaign Satu', imageUrl: 'https://img/c1.webp' });
  });

  it('stores null link with null CampaignRef when no campaignId', async () => {
    const m = mod(seedDb());
    const item = await m.create('news', newsDto(), author);
    expect(item.campaignId).toBeNull();
    expect(item.campaign).toBeNull();
  });

  it('rejects unknown campaignId with Validation 400', async () => {
    const m = mod(seedDb());
    await expect(m.create('news', newsDto({ campaignId: 'nope' }), author)).rejects.toThrow(ValidationError);
    try {
      await m.create('news', newsDto({ campaignId: 'nope' }), author);
    } catch (e) {
      expect(e.statusCode).toBe(400);
    }
  });
});

describe('contentModule create timestamp ownership', () => {
  it('ignores body createdAt for non-admin (server-owned)', async () => {
    const m = mod(seedDb());
    const before = Date.now();
    const item = await m.create('news', newsDto({ createdAt: '2000-01-01T00:00:00.000Z' }), author);
    const created = new Date(item.createdAt).getTime();
    expect(created).toBeGreaterThanOrEqual(before);
    expect(item.createdAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect(new Date(item.updatedAt).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('honors valid ISO createdAt for admin', async () => {
    const m = mod(seedDb());
    const item = await m.create('news', newsDto({ createdAt: '2020-05-01T00:00:00.000Z' }), admin);
    expect(new Date(item.createdAt).toISOString()).toBe('2020-05-01T00:00:00.000Z');
  });

  it('rejects invalid createdAt for admin with Validation 400', async () => {
    const m = mod(seedDb());
    await expect(
      m.create('news', newsDto({ createdAt: 'bukan-tanggal' }), admin),
    ).rejects.toThrow(ValidationError);
  });
});

describe('contentModule create author + validation', () => {
  it('populates Author from caller', async () => {
    const m = mod(seedDb());
    const item = await m.create('news', newsDto(), author);
    expect(item.authorId).toBe('u2');
    expect(item.author).toEqual({ nama: 'Author Dua', username: 'author2' });
  });

  it('requires authentication', async () => {
    const m = mod(seedDb());
    await expect(m.create('news', newsDto(), null)).rejects.toThrow(ForbiddenError);
  });

  it('requires title/content/category/status', async () => {
    const m = mod(seedDb());
    await expect(m.create('news', newsDto({ title: '' }), author)).rejects.toThrow(ValidationError);
    await expect(m.create('news', newsDto({ content: undefined }), author)).rejects.toThrow(ValidationError);
    await expect(m.create('news', newsDto({ category: '' }), author)).rejects.toThrow(ValidationError);
    await expect(m.create('news', newsDto({ status: '' }), author)).rejects.toThrow(ValidationError);
  });

  it('kajian requires youtubeLink (format + fetch land in ticket 06)', async () => {
    const m = mod(seedDb());
    const dto = { title: 'Kajian', description: 'deskripsi', category: 'fikih', status: 'published' };
    await expect(m.create('kajian', dto, author)).rejects.toThrow(ValidationError);
    const item = await m.create('kajian', { ...dto, youtubeLink: 'https://youtu.be/abc123' }, author);
    expect(item.youtubeLink).toBe('https://youtu.be/abc123');
    expect(item.campaign).toBeNull();
  });

  it('works through for(type) bound seam too', async () => {
    const m = mod(seedDb());
    const item = await m.for('blog').create(newsDto({ title: 'Blog Bound' }), author);
    expect(item.slug).toBe('blog-bound');
    expect(item.author).toEqual({ nama: 'Author Dua', username: 'author2' });
  });
});
