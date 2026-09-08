import { describe, it, expect, vi } from 'vitest';
import { createContentModule } from '../src/modules/content/index.js';
import { createFakeDb, createFakeMedia, createFakeYoutubeFetcher } from './fakes.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../src/modules/content/errors.js';

// Seam under test: contentModule update + remove (ticket 05).
// Vocabulary per CONTEXT.md: PublishableContent, ContentType, Slug,
// ViewCount, Author, Campaign, CampaignRef.

function seedDb() {
  const users = [
    { id: 'u1', nama: 'Admin Satu', username: 'admin1' },
    { id: 'u2', nama: 'Author Dua', username: 'author2' },
    { id: 'u3', nama: 'Other Tiga', username: 'other3' },
  ];
  const campaigns = [
    { id: 'camp1', title: 'Campaign Satu', imageUrl: 'https://img/c1.webp' },
    { id: 'camp2', title: 'Campaign Dua', imageUrl: 'https://img/c2.webp' },
  ];
  const news = [
    {
      id: 'n1', title: 'Berita Satu', slug: 'berita-satu', content: 'isi satu',
      category: 'umum', status: 'published', authorId: 'u2', campaignId: 'camp1',
      image: 'https://fake.r2/api/upload/image/old-key.jpg',
      viewCount: 0, createdAt: new Date('2024-01-03T00:00:00Z'), updatedAt: new Date('2024-01-03T00:00:00Z'),
    },
  ];
  return createFakeDb({ users, campaigns, news, blogs: [], kajians: [] });
}

function mod(db, mediaOverrides) {
  const media = createFakeMedia();
  if (mediaOverrides) Object.assign(media, mediaOverrides);
  return { mod: createContentModule({ db, media, youtubeFetcher: createFakeYoutubeFetcher() }), media };
}

const admin = { userId: 'u1', nama: 'Admin Satu', username: 'admin1', role: 'admin' };
const author = { userId: 'u2', nama: 'Author Dua', username: 'author2', role: 'user' };
const other = { userId: 'u3', nama: 'Other Tiga', username: 'other3', role: 'user' };

describe('contentModule update ownership', () => {
  it('author can update own PublishableContent', async () => {
    const db = seedDb();
    const { mod: m } = mod(db);
    const updated = await m.update({ type: 'news', id: 'n1', title: 'Berita Satu Revisi' }, author);
    expect(updated.title).toBe('Berita Satu Revisi');
    expect(updated.id).toBe('n1');
  });

  it('non-author non-admin gets 403 Forbidden', async () => {
    const db = seedDb();
    const { mod: m } = mod(db);
    await expect(
      m.update({ type: 'news', id: 'n1', title: 'Hacked' }, other),
    ).rejects.toThrow(ForbiddenError);
    try {
      await m.update({ type: 'news', id: 'n1', title: 'Hacked' }, other);
    } catch (e) {
      expect(e.statusCode).toBe(403);
    }
  });

  it('admin can update any PublishableContent', async () => {
    const db = seedDb();
    const { mod: m } = mod(db);
    const updated = await m.update({ type: 'news', id: 'n1', title: 'Admin Edit' }, admin);
    expect(updated.title).toBe('Admin Edit');
  });

  it('missing PublishableContent maps to 404', async () => {
    const db = seedDb();
    const { mod: m } = mod(db);
    await expect(m.update({ type: 'news', id: 'nope', title: 'x' }, admin)).rejects.toThrow(NotFoundError);
  });

  it('works through for(type) bound seam', async () => {
    const db = seedDb();
    const { mod: m } = mod(db);
    const updated = await m.for('news').update('n1', { title: 'Bound Edit' }, author);
    expect(updated.title).toBe('Bound Edit');
    await expect(m.for('news').update('n1', { title: 'x' }, other)).rejects.toThrow(ForbiddenError);
  });
});

describe('contentModule update validation + timestamps', () => {
  it('honors status/category validation on update', async () => {
    const db = seedDb();
    const { mod: m } = mod(db);
    await expect(
      m.update({ type: 'news', id: 'n1', status: 'archived' }, author),
    ).rejects.toThrow(ValidationError);
    await expect(
      m.update({ type: 'news', id: 'n1', category: '' }, author),
    ).rejects.toThrow(ValidationError);
    const ok = await m.update({ type: 'news', id: 'n1', status: 'draft', category: 'teknologi' }, author);
    expect(ok.status).toBe('draft');
    expect(ok.category).toBe('teknologi');
  });

  it('updatedAt is server-owned (client value ignored)', async () => {
    const db = seedDb();
    const { mod: m } = mod(db);
    const before = Date.now();
    const updated = await m.update(
      { type: 'news', id: 'n1', title: 'Revisi', updatedAt: '2000-01-01T00:00:00.000Z', createdAt: '2000-01-01T00:00:00.000Z' },
      author,
    );
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(updated.updatedAt).not.toBe('2000-01-01T00:00:00.000Z');
  });

  it('rejects unknown campaignId on update', async () => {
    const db = seedDb();
    const { mod: m } = mod(db);
    await expect(
      m.update({ type: 'news', id: 'n1', campaignId: 'nope' }, author),
    ).rejects.toThrow(ValidationError);
  });
});

describe('contentModule update media best-effort', () => {
  it('image change triggers media.remove(oldUrl) via DI', async () => {
    const db = seedDb();
    const { mod: m, media } = mod(db);
    const spy = vi.spyOn(media, 'remove');
    await m.update({ type: 'news', id: 'n1', image: 'https://fake.r2/api/upload/image/new-key.jpg' }, author);
    expect(spy).toHaveBeenCalledWith('https://fake.r2/api/upload/image/old-key.jpg');
    expect(db.__tables.news.find((r) => r.id === 'n1').image).toBe('https://fake.r2/api/upload/image/new-key.jpg');
  });

  it('R2 failure warns but does not block DB update', async () => {
    const db = seedDb();
    const { mod: m } = mod(db, {
      remove: async () => { throw new Error('R2 down'); },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const updated = await m.update({ type: 'news', id: 'n1', image: 'https://fake.r2/api/upload/image/new2.jpg' }, author);
      expect(updated.image).toBe('https://fake.r2/api/upload/image/new2.jpg');
      expect(db.__tables.news.find((r) => r.id === 'n1').image).toBe('https://fake.r2/api/upload/image/new2.jpg');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('same image does not trigger media.remove', async () => {
    const db = seedDb();
    const { mod: m, media } = mod(db);
    const spy = vi.spyOn(media, 'remove');
    await m.update({ type: 'news', id: 'n1', title: 'Only title' }, author);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('contentModule remove ownership + media best-effort', () => {
  it('author can remove own, non-author non-admin 403, admin allowed', async () => {
    const { mod: m1 } = mod(seedDb());
    await expect(m1.remove({ type: 'news', id: 'n1' }, other)).rejects.toThrow(ForbiddenError);

    const db2 = seedDb();
    const { mod: m2 } = mod(db2);
    await m2.remove({ type: 'news', id: 'n1' }, author);
    expect(db2.__tables.news.find((r) => r.id === 'n1')).toBeUndefined();

    const db3 = seedDb();
    const { mod: m3 } = mod(db3);
    await m3.remove({ type: 'news', id: 'n1' }, admin);
    expect(db3.__tables.news.find((r) => r.id === 'n1')).toBeUndefined();
  });

  it('missing row maps to 404', async () => {
    const db = seedDb();
    const { mod: m } = mod(db);
    await expect(m.remove({ type: 'news', id: 'nope' }, admin)).rejects.toThrow(NotFoundError);
  });

  it('delete best-effort media.remove; storage failure does not rollback deletion', async () => {
    const db = seedDb();
    const { mod: m, media } = mod(db);
    const spy = vi.spyOn(media, 'remove');
    await m.remove({ type: 'news', id: 'n1' }, author);
    expect(spy).toHaveBeenCalledWith('https://fake.r2/api/upload/image/old-key.jpg');

    const db2 = seedDb();
    const { mod: m2 } = mod(db2, {
      remove: async () => { throw new Error('R2 down'); },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await m2.remove({ type: 'news', id: 'n1' }, author);
      expect(db2.__tables.news.find((r) => r.id === 'n1')).toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('works through for(type) bound seam', async () => {
    const db = seedDb();
    const { mod: m } = mod(db);
    await m.for('news').remove('n1', author);
    expect(db.__tables.news).toHaveLength(0);
  });
});
