import { vi } from 'vitest';

export function createFakeDb(seed = {}) {
  const tables = {
    users: [...(seed.users || [])],
    campaigns: [...(seed.campaigns || [])],
    news: [...(seed.news || [])],
    blogs: [...(seed.blogs || [])],
    kajians: [...(seed.kajians || [])],
  };
  const chain = () => ({
    from: () => chain(),
    where: () => chain(),
    leftJoin: () => chain(),
    orderBy: () => chain(),
    limit: () => chain(),
    offset: () => chain(),
    then: (resolve) => Promise.resolve([]).then(resolve),
  });
  return {
    __isFakeDb: true,
    __tables: tables,
    select: () => chain(),
    selectDistinct: () => chain(),
    insert: () => ({ values: () => ({ returning: async () => [] }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
    delete: () => ({ where: async () => {} }),
  };
}

export function createFakeMedia() {
  const map = new Map();
  return {
    _map: map,
    async store(bytes, hint) {
      const key = `${Date.now()}-${hint}`;
      map.set(key, bytes);
      return `https://fake.r2/api/upload/image/${key}`;
    },
    async remove(url) {
      if (!url || typeof url !== 'string') return false;
      if (!url.includes('/api/upload/image/')) return false;
      const key = url.split('/api/upload/image/').pop();
      map.delete(key);
      return true;
    },
  };
}

export function createFakeYoutubeFetcher(overrides = {}) {
  const fn = vi.fn(async (videoId) => ({ title: `Title ${videoId}`, description: `Desc ${videoId}` }));
  Object.assign(fn, overrides);
  return fn;
}
