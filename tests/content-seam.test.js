import { describe, it, expect, vi } from 'vitest';
import { createContentModule } from '../src/modules/content/index.js';
import { createFakeDb, createFakeMedia, createFakeYoutubeFetcher } from './fakes.js';

describe('createContentModule DI seam', () => {
  it('is callable as createContentModule({db, media, youtubeFetcher}) without c/c.env', () => {
    const db = createFakeDb();
    const media = createFakeMedia();
    const youtubeFetcher = createFakeYoutubeFetcher();
    const mod = createContentModule({ db, media, youtubeFetcher });
    expect(mod).toBeDefined();
  });

  it('works without youtubeFetcher (news/blog)', () => {
    const mod = createContentModule({ db: createFakeDb(), media: createFakeMedia() });
    expect(mod).toBeDefined();
  });

  it('requires db and media', () => {
    expect(() => createContentModule({ media: createFakeMedia() })).toThrow(/db/);
    expect(() => createContentModule({ db: createFakeDb() })).toThrow(/media/);
  });

  it('exposes stubbed interface with correct arity and DI shape', () => {
    const mod = createContentModule({ db: createFakeDb(), media: createFakeMedia(), youtubeFetcher: vi.fn() });
    expect(typeof mod.list).toBe('function');
    expect(typeof mod.getBySlug).toBe('function');
    expect(typeof mod.create).toBe('function');
    expect(typeof mod.update).toBe('function');
    expect(typeof mod.remove).toBe('function');
    expect(typeof mod.categories).toBe('function');
    expect(mod.list.length).toBe(1);
    expect(mod.getBySlug.length).toBe(1);
    expect(mod.create.length).toBe(2);
    expect(mod.update.length).toBe(3);
    expect(mod.remove.length).toBe(2);
    expect(mod.categories.length).toBe(1);
  });

  it('media fake is Map-backed and youtubeFetcher is mock', async () => {
    const media = createFakeMedia();
    const ytf = createFakeYoutubeFetcher();
    const mod = createContentModule({ db: createFakeDb(), media, youtubeFetcher: ytf });
    expect(media._map instanceof Map).toBe(true);
    expect(typeof ytf).toBe('function');
    expect(ytf.mock).toBeDefined();
    void mod;
  });

  it('harness isolates from real D1/R2/network', async () => {
    const db = createFakeDb();
    const media = createFakeMedia();
    const ytf = createFakeYoutubeFetcher();
    const mod = createContentModule({ db, media, youtubeFetcher: ytf });
    await expect(mod.list({})).rejects.toThrow(/not implemented/);
    await expect(mod.getBySlug('x')).rejects.toThrow(/not implemented/);
    expect(ytf).not.toHaveBeenCalled();
  });
});
