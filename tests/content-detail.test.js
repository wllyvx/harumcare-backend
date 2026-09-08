import { describe, it, expect } from 'vitest';
import { createContentModule } from '../src/modules/content/index.js';
import { createFakeDb, createFakeMedia, createFakeYoutubeFetcher } from './fakes.js';
import { NotFoundError, ValidationError } from '../src/modules/content/errors.js';

// Seam under test: contentModule getBySlug detail (ticket 03).
// Vocabulary per CONTEXT.md: PublishableContent, ContentType, Slug,
// ViewCount, Author, Campaign, CampaignRef.

function seedDb() {
  const users = [
    { id: 'u1', nama: 'Admin Satu', username: 'admin1' },
    { id: 'u2', nama: 'Author Dua', username: 'author2' },
  ];
  const campaigns = [
    { id: 'camp1', title: 'Campaign Satu', imageUrl: 'https://img/c1.webp' },
  ];
  const news = [
    { id: 'n1', title: 'Berita Satu', slug: 'berita-satu', content: 'isi satu', category: 'umum', status: 'published', authorId: 'u1', campaignId: 'camp1', viewCount: 0, createdAt: new Date('2024-01-03T00:00:00Z'), updatedAt: new Date('2024-01-03T00:00:00Z') },
    { id: 'n2', title: 'Berita Dua', slug: 'berita-dua', content: 'isi dua', category: 'umum', status: 'published', authorId: 'u2', campaignId: null, viewCount: 5, createdAt: new Date('2024-01-02T00:00:00Z'), updatedAt: new Date('2024-01-02T00:00:00Z') },
  ];
  const blogs = [
    { id: 'b1', title: 'Blog Satu', slug: 'blog-satu', content: 'isi blog', category: 'edukasi', status: 'published', authorId: 'u1', campaignId: 'camp1', viewCount: 2, createdAt: new Date('2024-02-01T00:00:00Z'), updatedAt: new Date('2024-02-01T00:00:00Z') },
  ];
  const kajians = [
    { id: 'k1', title: 'Kajian Satu', slug: 'kajian-satu', description: 'deskripsi kajian', youtubeLink: 'https://youtu.be/abc123', category: 'fikih', status: 'published', authorId: 'u2', viewCount: 3, createdAt: new Date('2024-03-01T00:00:00Z'), updatedAt: new Date('2024-03-01T00:00:00Z') },
  ];
  return createFakeDb({ users, campaigns, news, blogs, kajians });
}

function mod(db) {
  return createContentModule({ db, media: createFakeMedia(), youtubeFetcher: createFakeYoutubeFetcher() });
}

describe('contentModule getBySlug viewCount atomic', () => {
  it('increments ViewCount and returns fresh count', async () => {
    const m = mod(seedDb());
    const first = await m.getBySlug('news', 'berita-satu');
    expect(first.viewCount).toBe(1);
    const second = await m.getBySlug('news', 'berita-satu');
    expect(second.viewCount).toBe(2);
  });

  it('does not lose hits on concurrent calls', async () => {
    const db = seedDb();
    const m = mod(db);
    const results = await Promise.all([
      m.getBySlug('news', 'berita-dua'),
      m.getBySlug('news', 'berita-dua'),
      m.getBySlug('news', 'berita-dua'),
    ]);
    // started at 5, +3 concurrent => 8
    expect(db.__tables.news.find((r) => r.slug === 'berita-dua').viewCount).toBe(8);
    expect(results.map((r) => r.viewCount).sort()).toEqual([6, 7, 8]);
  });
});

describe('contentModule getBySlug author + campaignRef', () => {
  it('populates Author {nama,username} and campaign CampaignRef separate from campaignId FK', async () => {
    const m = mod(seedDb());
    const item = await m.getBySlug('news', 'berita-satu');
    expect(item.author).toEqual({ nama: 'Admin Satu', username: 'admin1' });
    // campaignId stays a FK string, never an overloaded object
    expect(item.campaignId).toBe('camp1');
    expect(typeof item.campaignId).toBe('string');
    expect(item.campaign).toEqual({ title: 'Campaign Satu', imageUrl: 'https://img/c1.webp' });
  });

  it('returns campaign null when no link, preserving null FK', async () => {
    const m = mod(seedDb());
    const item = await m.getBySlug('news', 'berita-dua');
    expect(item.campaign).toBeNull();
    expect(item.campaignId).toBeNull();
  });

  it('kajian detail skips Campaign join (campaign null)', async () => {
    const m = mod(seedDb());
    const item = await m.getBySlug('kajian', 'kajian-satu');
    expect(item.author).toEqual({ nama: 'Author Dua', username: 'author2' });
    expect(item.campaign).toBeNull();
  });

  it('works through for(type) bound seam too', async () => {
    const m = mod(seedDb());
    const item = await m.for('blog').getBySlug('blog-satu');
    expect(item.author).toEqual({ nama: 'Admin Satu', username: 'admin1' });
    expect(item.campaign).toEqual({ title: 'Campaign Satu', imageUrl: 'https://img/c1.webp' });
  });
});

describe('contentModule getBySlug not-found + validation', () => {
  it('missing Slug throws NotFoundError with 404 statusCode', async () => {
    const m = mod(seedDb());
    await expect(m.getBySlug('news', 'tidak-ada')).rejects.toThrow(NotFoundError);
    try {
      await m.getBySlug('news', 'tidak-ada');
    } catch (e) {
      expect(e.statusCode).toBe(404);
    }
  });

  it('requires ContentType and Slug', async () => {
    const m = mod(seedDb());
    await expect(m.getBySlug('news', '')).rejects.toThrow(ValidationError);
    await expect(m.getBySlug('unknown-type', 'x')).rejects.toThrow(ValidationError);
  });
});

describe('legacy detail envelope compat', () => {
  it('adapter maps campaign to relatedCampaign for news/blog, kajian has no relatedCampaign', async () => {
    const { toLegacyDetailEnvelope } = await import('../src/modules/content/adapters.js');
    const m = mod(seedDb());
    const newsItem = await m.getBySlug('news', 'berita-satu');
    const newsLegacy = toLegacyDetailEnvelope('news', newsItem);
    expect(newsLegacy.relatedCampaign).toEqual(newsItem.campaign);
    expect(newsLegacy.campaignId).toBe('camp1');
    expect(newsLegacy.campaign).toEqual(newsItem.campaign);

    const blogLegacy = toLegacyDetailEnvelope('blog', await m.getBySlug('blog', 'blog-satu'));
    expect(blogLegacy.relatedCampaign).toEqual({ title: 'Campaign Satu', imageUrl: 'https://img/c1.webp' });

    const kajianItem = await m.getBySlug('kajian', 'kajian-satu');
    const kajianLegacy = toLegacyDetailEnvelope('kajian', kajianItem);
    expect(kajianLegacy.author).toEqual({ nama: 'Author Dua', username: 'author2' });
    expect('relatedCampaign' in kajianLegacy).toBe(false);
  });
});
