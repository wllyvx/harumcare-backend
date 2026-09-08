import { and, or, eq, count, desc, sql } from 'drizzle-orm';
import { users as usersTable, campaigns as campaignsTable } from '../../db/schema.js';
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from './errors.js';
import { getAdapter } from './adapters.js';
import { clampPageLimit, escapeLike } from './helpers.js';

export function createContentModule({ db, media, youtubeFetcher } = {}) {
  if (!db) throw new Error('createContentModule requires db');
  if (!media) throw new Error('createContentModule requires media');

  const isMemoryDb = !!db.__isFakeDb && !!db.__tables;

  function normalizeListArgs(typeOrQuery, queryOrUser, maybeUser) {
    let type;
    let query;
    let user;
    if (typeof typeOrQuery === 'string') {
      type = typeOrQuery;
      query = queryOrUser || {};
      user = maybeUser ?? null;
    } else {
      query = typeOrQuery || {};
      type = query.type;
      user = queryOrUser ?? query.user ?? null;
    }
    if (!type) throw new ValidationError('ContentType required');
    return { type, query, user };
  }

  function resolveStatusFilter(statusParam, user) {
    const isAdmin = user?.role === 'admin';
    if (!isAdmin) return 'published';
    if (statusParam === undefined || statusParam === null || statusParam === '') return 'published';
    if (statusParam === 'all') return 'all';
    return statusParam;
  }

  function memoryList(adapter, query, user, page, limit) {
    const tables = db.__tables;
    const rows = [...(tables[adapter.tableName] || [])];
    const searchRaw = query.search ?? query.q;
    const search = typeof searchRaw === 'string' && searchRaw !== '' ? searchRaw : undefined;
    const category = query.category || undefined;
    const campaignId = query.campaignId || undefined;
    const authorId = query.authorId || undefined;
    const statusFilter = resolveStatusFilter(query.status, user);

    let filtered = rows;
    if (statusFilter !== 'all') filtered = filtered.filter((r) => r.status === statusFilter);
    if (category !== undefined) filtered = filtered.filter((r) => r.category === category);
    if (campaignId !== undefined && adapter.withCampaign) {
      filtered = filtered.filter((r) => r.campaignId === campaignId);
    }
    if (authorId !== undefined) filtered = filtered.filter((r) => r.authorId === authorId);
    if (search !== undefined) {
      const needle = search.toLowerCase();
      filtered = filtered.filter((r) =>
        adapter.searchFields.some((f) => String(r[f] ?? '').toLowerCase().includes(needle)),
      );
    }

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit);
    const sorted = [...filtered].sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return tb - ta;
    });
    const offset = (page - 1) * limit;
    const pageRows = sorted.slice(offset, offset + limit);

    const usersById = new Map((tables.users || []).map((u) => [String(u.id), u]));
    const campaignsById = new Map((tables.campaigns || []).map((c) => [String(c.id), c]));
    const items = pageRows.map((item) => {
      const u = usersById.get(String(item.authorId)) || null;
      const camp =
        adapter.withCampaign && item.campaignId
          ? campaignsById.get(String(item.campaignId)) || null
          : null;
      return adapter.mapRow({
        [adapter.alias]: item,
        users: u ? { nama: u.nama, username: u.username } : null,
        campaigns: camp ? { title: camp.title, imageUrl: camp.imageUrl } : null,
      });
    });

    return { items, total, page, totalPages };
  }

  async function drizzleList(adapter, query, user, page, limit) {
    const table = adapter.table;
    const searchRaw = query.search ?? query.q;
    const search = typeof searchRaw === 'string' && searchRaw !== '' ? searchRaw : undefined;
    const category = query.category || undefined;
    const campaignId = query.campaignId || undefined;
    const authorId = query.authorId || undefined;
    const statusFilter = resolveStatusFilter(query.status, user);

    const filters = [];
    if (statusFilter !== 'all') filters.push(eq(table.status, statusFilter));
    if (category !== undefined) filters.push(eq(table.category, category));
    if (campaignId !== undefined && adapter.withCampaign) {
      filters.push(eq(table.campaignId, campaignId));
    }
    if (authorId !== undefined) filters.push(eq(table.authorId, authorId));
    if (search !== undefined) {
      const pattern = `%${escapeLike(search)}%`;
      const conds = adapter.searchFields.map(
        (f) => sql`${table[f]} LIKE ${pattern} ESCAPE '\\'`,
      );
      filters.push(conds.length === 1 ? conds[0] : or(...conds));
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const [totalRow] = await db.select({ count: count() }).from(table).where(whereClause);
    const total = totalRow?.count ?? 0;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;

    let rows;
    if (adapter.withCampaign) {
      rows = await db
        .select({
          [adapter.alias]: table,
          users: { nama: usersTable.nama, username: usersTable.username },
          campaigns: { title: campaignsTable.title, imageUrl: campaignsTable.imageUrl },
        })
        .from(table)
        .leftJoin(usersTable, eq(table.authorId, usersTable.id))
        .leftJoin(campaignsTable, eq(table.campaignId, campaignsTable.id))
        .where(whereClause)
        .orderBy(desc(table.createdAt))
        .limit(limit)
        .offset(offset);
    } else {
      rows = await db
        .select({
          [adapter.alias]: table,
          users: { nama: usersTable.nama, username: usersTable.username },
        })
        .from(table)
        .leftJoin(usersTable, eq(table.authorId, usersTable.id))
        .where(whereClause)
        .orderBy(desc(table.createdAt))
        .limit(limit)
        .offset(offset);
    }

    const items = rows.map((r) => adapter.mapRow(r));
    return { items, total, page, totalPages };
  }

  async function list(typeOrQuery, queryOrUser, maybeUser) {
    const { type, query, user } = normalizeListArgs(typeOrQuery, queryOrUser, maybeUser);
    const adapter = getAdapter(type);
    const { page, limit } = clampPageLimit(query);
    if (isMemoryDb) return memoryList(adapter, query, user, page, limit);
    return drizzleList(adapter, query, user, page, limit);
  }

  async function getBySlug(slug) {
    throw new Error('not implemented: getBySlug');
  }

  async function create(dto, user) {
    throw new Error('not implemented: create');
  }

  async function update(id, dto, user) {
    throw new Error('not implemented: update');
  }

  async function remove(id, user) {
    throw new Error('not implemented: remove');
  }

  async function categories(type) {
    const adapter = getAdapter(type);
    if (isMemoryDb) {
      const seen = [];
      const set = new Set();
      for (const row of db.__tables[adapter.tableName] || []) {
        const c = row.category;
        if (c === undefined || c === null) continue;
        if (!set.has(c)) {
          set.add(c);
          seen.push(c);
        }
      }
      return seen;
    }
    const rows = await db.selectDistinct({ category: adapter.table.category }).from(adapter.table);
    return rows.map((r) => r.category);
  }

  function forType(type) {
    getAdapter(type);
    return {
      list: (query, user) => list(type, query, user),
      getBySlug: (...args) => getBySlug(...args),
      create: (...args) => create(...args),
      update: (...args) => update(...args),
      remove: (...args) => remove(...args),
      categories: () => categories(type),
    };
  }

  return { list, getBySlug, create, update, remove, categories, for: forType, forType };
}

export { ValidationError, NotFoundError, ForbiddenError, ConflictError };
