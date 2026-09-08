import { describe, it, expect, vi } from 'vitest';
import { createContentModule } from '../src/modules/content/index.js';
import { createFakeDb, createFakeMedia, createFakeYoutubeFetcher } from './fakes.js';
import { ValidationError } from '../src/modules/content/errors.js';
import { newsAdapter, blogAdapter, kajianAdapter } from '../src/modules/content/adapters.js';

// Seam under test: kajian YouTube capability via DI (ticket 06).
// Vocabulary per CONTEXT.md: PublishableContent, ContentType.

function seedDb() {
  const users = [{ id: 'u1', nama: 'Author Satu', username: 'author1' }];
  return createFakeDb({ users, campaigns: [], news: [], blogs: [], kajians: [] });
}

const author = { userId: 'u1', nama: 'Author Satu', username: 'author1', role: 'user' };

describe('kajianAdapter youtube capability isolation', () => {
  it('kajianAdapter alone carries withYouTube', () => {
    expect(kajianAdapter.withYouTube).toBe(true);
    expect(newsAdapter.withYouTube).toBe(false);
    expect(blogAdapter.withYouTube).toBe(false);
    expect('withYouTube' in newsAdapter).toBe(true);
    expect('withYouTube' in blogAdapter).toBe(true);
  });

  it('news/blog create never calls youtubeFetcher', async () => {
    const db = seedDb();
    const ytf = createFakeYoutubeFetcher();
    const m = createContentModule({ db, media: createFakeMedia(), youtubeFetcher: ytf });
    await m.create('news', { title: 'N', content: 'c', category: 'umum', status: 'published' }, author);
    await m.create('blog', { title: 'B', content: 'c', category: 'umum', status: 'published' }, author);
    expect(ytf).not.toHaveBeenCalled();
  });
});

describe('kajian youtubeLink validation', () => {
  it.each([
    ['https://www.youtube.com/watch?v=abc123'],
    ['https://youtube.com/watch?v=abc123&list=xyz'],
    ['https://youtu.be/abc123'],
    ['https://www.youtube.com/live/abc123'],
  ])('accepts %s', async (youtubeLink) => {
    const m = createContentModule({ db: seedDb(), media: createFakeMedia(), youtubeFetcher: createFakeYoutubeFetcher() });
    const item = await m.create(
      'kajian',
      { title: 'Kajian', description: 'desc', youtubeLink, category: 'fikih', status: 'published' },
      author,
    );
    expect(item.youtubeLink).toBe(youtubeLink);
  });

  it.each([
    ['https://example.com/video'],
    ['not a url'],
    ['https://www.youtube.com/watch'],
    ['https://www.youtube.com/embed/abc123'],
    [''],
  ])('rejects %s with Validation 400', async (youtubeLink) => {
    const m = createContentModule({ db: seedDb(), media: createFakeMedia(), youtubeFetcher: createFakeYoutubeFetcher() });
    await expect(
      m.create('kajian', { title: 'K', description: 'd', youtubeLink, category: 'fikih', status: 'published' }, author),
    ).rejects.toThrow(ValidationError);
    try {
      await m.create('kajian', { title: 'K', description: 'd', youtubeLink, category: 'fikih', status: 'published' }, author);
    } catch (e) {
      expect(e.statusCode).toBe(400);
    }
  });
});

describe('kajian create youtube autofill', () => {
  it('populates missing title/description from fetcher success', async () => {
    const ytf = vi.fn(async (videoId) => ({ title: `Fetched ${videoId}`, description: `Desc ${videoId}` }));
    const m = createContentModule({ db: seedDb(), media: createFakeMedia(), youtubeFetcher: ytf });
    const item = await m.create(
      'kajian',
      { youtubeLink: 'https://youtu.be/vid999', category: 'fikih', status: 'published' },
      author,
    );
    expect(ytf).toHaveBeenCalledWith('vid999');
    expect(item.title).toBe('Fetched vid999');
    expect(item.description).toBe('Desc vid999');
    expect(item.slug).toBe('fetched-vid999');
  });

  it('populates only missing field, keeps provided one', async () => {
    const ytf = vi.fn(async () => ({ title: 'Should Not Override', description: 'Auto Desc' }));
    const m = createContentModule({ db: seedDb(), media: createFakeMedia(), youtubeFetcher: ytf });
    const item = await m.create(
      'kajian',
      { title: 'Manual Title', youtubeLink: 'https://youtu.be/abc1', category: 'fikih', status: 'published' },
      author,
    );
    expect(item.title).toBe('Manual Title');
    expect(item.description).toBe('Auto Desc');
  });

  it('fetcher throw warns and requires manual title/description', async () => {
    const ytf = vi.fn(async () => { throw new Error('YouTube down'); });
    const m = createContentModule({ db: seedDb(), media: createFakeMedia(), youtubeFetcher: ytf });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(
        m.create('kajian', { youtubeLink: 'https://youtu.be/abc1', category: 'fikih', status: 'published' }, author),
      ).rejects.toThrow(ValidationError);
      expect(warn).toHaveBeenCalled();
      expect(ytf).toHaveBeenCalledWith('abc1');
    } finally {
      warn.mockRestore();
    }
  });

  it('does not call fetcher when title and description provided', async () => {
    const ytf = vi.fn(async () => ({ title: 'x', description: 'y' }));
    const m = createContentModule({ db: seedDb(), media: createFakeMedia(), youtubeFetcher: ytf });
    await m.create(
      'kajian',
      { title: 'Manual', description: 'Manual desc', youtubeLink: 'https://youtu.be/abc1', category: 'fikih', status: 'published' },
      author,
    );
    expect(ytf).not.toHaveBeenCalled();
  });

  it('works through for(kajian) bound seam too', async () => {
    const ytf = vi.fn(async (videoId) => ({ title: `T ${videoId}`, description: `D ${videoId}` }));
    const m = createContentModule({ db: seedDb(), media: createFakeMedia(), youtubeFetcher: ytf });
    const item = await m.for('kajian').create(
      { youtubeLink: 'https://youtu.be/bound1', category: 'fikih', status: 'published' },
      author,
    );
    expect(item.title).toBe('T bound1');
  });
});

describe('kajian fetchYouTubeData preview via adapter', () => {
  it('exposes fetchYouTubeData on module and for(kajian)', async () => {
    const m = createContentModule({ db: seedDb(), media: createFakeMedia(), youtubeFetcher: createFakeYoutubeFetcher() });
    expect(typeof m.fetchYouTubeData).toBe('function');
    expect(typeof m.for('kajian').fetchYouTubeData).toBe('function');
  });

  it('success path returns {title,description}', async () => {
    const ytf = vi.fn(async (videoId) => ({ title: `Title ${videoId}`, description: `Desc ${videoId}` }));
    const m = createContentModule({ db: seedDb(), media: createFakeMedia(), youtubeFetcher: ytf });
    const data = await m.for('kajian').fetchYouTubeData('vid123');
    expect(data).toEqual({ title: 'Title vid123', description: 'Desc vid123' });
    expect(ytf).toHaveBeenCalledWith('vid123');
  });

  it('throw path propagates fetcher error', async () => {
    const ytf = vi.fn(async () => { throw new Error('quota exceeded'); });
    const m = createContentModule({ db: seedDb(), media: createFakeMedia(), youtubeFetcher: ytf });
    await expect(m.for('kajian').fetchYouTubeData('vid123')).rejects.toThrow('quota exceeded');
  });

  it('missing videoId maps to Validation 400', async () => {
    const m = createContentModule({ db: seedDb(), media: createFakeMedia(), youtubeFetcher: createFakeYoutubeFetcher() });
    await expect(m.for('kajian').fetchYouTubeData('')).rejects.toThrow(ValidationError);
    await expect(m.for('kajian').fetchYouTubeData()).rejects.toThrow(ValidationError);
  });

  it('news/blog have no youtube preview path', async () => {
    const m = createContentModule({ db: seedDb(), media: createFakeMedia(), youtubeFetcher: createFakeYoutubeFetcher() });
    await expect(m.for('news').fetchYouTubeData('x')).rejects.toThrow(ValidationError);
    await expect(m.for('blog').fetchYouTubeData('x')).rejects.toThrow(ValidationError);
  });
});
