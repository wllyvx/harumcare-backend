import { describe, it, expect } from 'vitest';
import {
  createMedia,
  sanitizeFilename,
  buildKey,
  extractKey,
  isR2Url,
  urlFor,
} from '../src/modules/media/index.js';

function fakeBucket() {
  const map = new Map();
  return {
    _map: map,
    async put(key, bytes) {
      map.set(key, bytes);
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

describe('media seam sanitize', () => {
  it('strips directories and ../ traversal', () => {
    expect(sanitizeFilename('../../etc/passwd.jpg')).not.toContain('..');
    expect(sanitizeFilename('../../etc/passwd.jpg')).not.toContain('/');
    expect(sanitizeFilename('a/b/c.png')).toBe('c.png');
    expect(sanitizeFilename('..\\windows\\evil.gif')).not.toContain('..');
  });

  it('slugifies the base but preserves extension', () => {
    expect(sanitizeFilename('Hello World!!.JPG')).toBe('hello-world.jpg');
    expect(sanitizeFilename('My  Image@#$.webp')).toBe('my-image.webp');
  });

  it('falls back to file for empty input', () => {
    expect(sanitizeFilename('')).toBe('file');
    expect(sanitizeFilename(null)).toBe('file');
    expect(sanitizeFilename('...')).toBe('file');
  });
});

describe('media seam key generation', () => {
  it('builds Date.now()-random-sanitized keys', () => {
    const key = buildKey('My Photo.jpg', { now: 123, rand: 456 });
    expect(key).toBe('123-456-my-photo.jpg');
  });

  it('store sanitizes hint into the stored key', async () => {
    const bucket = fakeBucket();
    const media = createMedia({ bucket });
    const key = await media.store('bytes', '../../evil Name.JPG');
    expect(key).not.toContain('..');
    expect(key).not.toContain('/');
    expect(key).toMatch(/-evil-name\.jpg$/);
    expect(bucket._map.has(key)).toBe(true);
  });

  it('store rejects unsupported mime types', async () => {
    const media = createMedia({ bucket: fakeBucket() });
    await expect(media.store('x', 'a.jpg', { contentType: 'application/x-sh' })).rejects.toThrow(
      /Unsupported media type/,
    );
  });
});

describe('media seam remove without Hono leak', () => {
  it('parses keys from R2 urls and no-ops on foreign urls', async () => {
    const bucket = fakeBucket();
    bucket._map.set('old-key.jpg', 'bytes');
    const media = createMedia({ bucket });
    expect(isR2Url('https://cdn/api/upload/image/old-key.jpg')).toBe(true);
    expect(extractKey('https://cdn/api/upload/image/old-key.jpg')).toBe('old-key.jpg');
    expect(await media.remove('https://cdn/api/upload/image/old-key.jpg')).toBe(true);
    expect(bucket._map.has('old-key.jpg')).toBe(false);
    expect(await media.remove('https://other-cdn/image.jpg')).toBe(false);
    expect(await media.remove(null)).toBe(false);
  });

  it('rejects traversal keys', () => {
    expect(extractKey('https://cdn/api/upload/image/../secret')).toBeNull();
    expect(isR2Url('https://cdn/api/upload/image/../secret')).toBe(false);
  });

  it('exposes urlFor to build compat urls', () => {
    expect(urlFor('k.jpg', 'https://cdn/')).toBe('https://cdn/api/upload/image/k.jpg');
  });

  it('takes only {bucket} — no Hono context', () => {
    const media = createMedia({ bucket: fakeBucket() });
    for (const fn of ['store', 'remove']) {
      expect(media[fn].length).toBeLessThanOrEqual(3);
    }
    const src = createMedia.toString();
    expect(src).not.toMatch(/c\.env/);
    expect(src).not.toMatch(/c\.get/);
  });
});
