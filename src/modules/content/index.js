import { and, or, eq, count, desc, sql } from 'drizzle-orm';
import { users as usersTable, campaigns as campaignsTable } from '../../db/schema.js';
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from './errors.js';
import { getAdapter } from './adapters.js';
import { clampPageLimit, escapeLike, slugify } from './helpers.js';

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

  function normalizeDetailArgs(typeOrSlug, slugOrUndefined) {
    let type;
    let slug;
    if (typeof typeOrSlug === 'object' && typeOrSlug !== null) {
      type = typeOrSlug.type;
      slug = typeOrSlug.slug;
    } else if (slugOrUndefined !== undefined) {
      type = typeOrSlug;
      slug = slugOrUndefined;
    } else {
      slug = typeOrSlug;
      type = undefined;
    }
    if (!type || typeof slug !== 'string' || slug === '') {
      throw new ValidationError('ContentType and Slug required');
    }
    return { type, slug };
  }

  function memoryGetBySlug(adapter, slug) {
    const rows = db.__tables[adapter.tableName] || [];
    const row = rows.find((r) => r.slug === slug);
    if (!row) throw new NotFoundError(`${adapter.type} not found`);
    // Atomic in-memory bump: find + increment run synchronously with no
    // await in between, so concurrent getBySlug calls cannot lose hits.
    row.viewCount = (row.viewCount || 0) + 1;

    const tables = db.__tables;
    const u = (tables.users || []).find((x) => String(x.id) === String(row.authorId)) || null;
    const camp =
      adapter.withCampaign && row.campaignId
        ? (tables.campaigns || []).find((x) => String(x.id) === String(row.campaignId)) || null
        : null;
    return adapter.mapRow({
      [adapter.alias]: row,
      users: u ? { nama: u.nama, username: u.username } : null,
      campaigns: camp ? { title: camp.title, imageUrl: camp.imageUrl } : null,
    });
  }

  async function drizzleGetBySlug(adapter, slug) {
    const table = adapter.table;
    // Atomic ViewCount bump: single UPDATE with sql increment, no read-modify-write.
    const updated = await db
      .update(table)
      .set({ viewCount: sql`${table.viewCount} + 1` })
      .where(eq(table.slug, slug))
      .returning({ id: table.id });
    if (!updated || updated.length === 0) throw new NotFoundError(`${adapter.type} not found`);

    // Single joined select for Author + CampaignRef (no extra campaign select).
    // Kajian skips the Campaign join entirely.
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
        .where(eq(table.slug, slug))
        .limit(1);
    } else {
      rows = await db
        .select({
          [adapter.alias]: table,
          users: { nama: usersTable.nama, username: usersTable.username },
        })
        .from(table)
        .leftJoin(usersTable, eq(table.authorId, usersTable.id))
        .where(eq(table.slug, slug))
        .limit(1);
    }
    const row = rows[0];
    if (!row) throw new NotFoundError(`${adapter.type} not found`);
    return adapter.mapRow(row);
  }

  async function getBySlug(typeOrSlug, slugOrUndefined) {
    const { type, slug } = normalizeDetailArgs(typeOrSlug, slugOrUndefined);
    const adapter = getAdapter(type);
    if (isMemoryDb) return memoryGetBySlug(adapter, slug);
    return drizzleGetBySlug(adapter, slug);
  }

  function normalizeCreateArgs(typeOrDto, dtoOrUser, maybeUser) {
    let type;
    let dto;
    let user;
    if (typeof typeOrDto === 'string') {
      type = typeOrDto;
      dto = dtoOrUser || {};
      user = maybeUser ?? null;
    } else {
      dto = typeOrDto || {};
      type = dto.type;
      user = dtoOrUser ?? dto.user ?? null;
    }
    if (!type) throw new ValidationError('ContentType required');
    if (!dto || typeof dto !== 'object') throw new ValidationError('Invalid payload');
    return { type, dto, user };
  }

  function requireNonEmpty(dto, field, label) {
    const v = dto[field];
    if (typeof v !== 'string' || v.trim() === '') throw new ValidationError(`${label} required`);
    return v;
  }

  function resolveCreateAuthorId(user) {
    if (!user || user.userId === undefined || user.userId === null || String(user.userId) === '') {
      throw new ForbiddenError('Authentication required');
    }
    return String(user.userId);
  }

  function validateCreateDto(adapter, dto) {
    requireNonEmpty(dto, 'title', 'Title');
    if (adapter.type === 'kajian') {
      requireNonEmpty(dto, 'description', 'Description');
      requireNonEmpty(dto, 'youtubeLink', 'YoutubeLink');
    } else {
      requireNonEmpty(dto, 'content', 'Content');
    }
    requireNonEmpty(dto, 'category', 'Category');
    requireNonEmpty(dto, 'status', 'Status');
  }

  function normalizeCreateCampaignId(adapter, dto) {
    if (!adapter.withCampaign) return null;
    const raw = dto.campaignId;
    if (raw === undefined || raw === null || raw === '') return null;
    return String(raw);
  }

  // Server-owned timestamps: body createdAt is ignored unless the caller is
  // admin with a valid ISO date (import/backfill case); an admin-supplied
  // invalid value is Validation 400. updatedAt is always server-owned.
  function resolveCreateCreatedAt(dto, user) {
    const raw = dto.createdAt;
    if (raw === undefined || raw === null || raw === '') return new Date();
    if (user?.role === 'admin') {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) throw new ValidationError('Invalid createdAt: must be a valid date');
      return d;
    }
    return new Date();
  }

  function authorFromCallerOrRow(user, rowAuthor) {
    if (
      user &&
      typeof user.nama === 'string' && user.nama !== '' &&
      typeof user.username === 'string' && user.username !== ''
    ) {
      return { nama: user.nama, username: user.username };
    }
    return rowAuthor;
  }

  async function campaignExists(campaignId) {
    if (isMemoryDb) {
      return (db.__tables.campaigns || []).some((c) => String(c.id) === String(campaignId));
    }
    const rows = await db
      .select({ id: campaignsTable.id })
      .from(campaignsTable)
      .where(eq(campaignsTable.id, campaignId))
      .limit(1);
    return rows.length > 0;
  }

  async function slugExists(adapter, slug) {
    if (isMemoryDb) {
      return (db.__tables[adapter.tableName] || []).some((r) => r.slug === slug);
    }
    const rows = await db
      .select({ id: adapter.table.id })
      .from(adapter.table)
      .where(eq(adapter.table.slug, slug))
      .limit(1);
    return rows.length > 0;
  }

  function isSlugUniqueViolation(e) {
    const msg = e && typeof e.message === 'string' ? e.message : '';
    return /unique/i.test(msg) && /slug/i.test(msg);
  }

  function buildCreateValues(adapter, dto, { authorId, campaignId, slug, createdAt }) {
    const now = new Date();
    const values = {
      title: dto.title,
      slug,
      category: dto.category,
      status: dto.status,
      authorId,
      viewCount: 0,
      createdAt,
      updatedAt: now,
    };
    if (adapter.type === 'kajian') {
      values.description = dto.description;
      values.youtubeLink = dto.youtubeLink;
    } else {
      values.content = dto.content;
      values.image = dto.image || 'images/empty-image-placeholder.webp';
      values.campaignId = campaignId;
    }
    return values;
  }

  function memoryCreateInsert(adapter, values) {
    const row = {
      id: typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...values,
    };
    db.__tables[adapter.tableName].push(row);
    const tables = db.__tables;
    const u = (tables.users || []).find((x) => String(x.id) === String(row.authorId)) || null;
    const camp =
      adapter.withCampaign && row.campaignId
        ? (tables.campaigns || []).find((x) => String(x.id) === String(row.campaignId)) || null
        : null;
    return adapter.mapRow({
      [adapter.alias]: row,
      users: u ? { nama: u.nama, username: u.username } : null,
      campaigns: camp ? { title: camp.title, imageUrl: camp.imageUrl } : null,
    });
  }

  async function drizzleCreateInsert(adapter, values) {
    const table = adapter.table;
    const [inserted] = await db.insert(table).values(values).returning();
    // Single joined fetch for Author + CampaignRef (one row, not N+1).
    // Kajian skips the Campaign join entirely.
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
        .where(eq(table.id, inserted.id))
        .limit(1);
    } else {
      rows = await db
        .select({
          [adapter.alias]: table,
          users: { nama: usersTable.nama, username: usersTable.username },
        })
        .from(table)
        .leftJoin(usersTable, eq(table.authorId, usersTable.id))
        .where(eq(table.id, inserted.id))
        .limit(1);
    }
    return adapter.mapRow(rows[0]);
  }

  async function create(typeOrDto, dtoOrUser, maybeUser) {
    const { type, dto, user } = normalizeCreateArgs(typeOrDto, dtoOrUser, maybeUser);
    const adapter = getAdapter(type);
    const authorId = resolveCreateAuthorId(user);
    validateCreateDto(adapter, dto);
    const campaignId = normalizeCreateCampaignId(adapter, dto);
    if (campaignId && !(await campaignExists(campaignId))) {
      throw new ValidationError('Campaign not found');
    }
    const createdAt = resolveCreateCreatedAt(dto, user);

    const base = slugify(dto.title);
    if (!base) throw new ValidationError('Title must produce a valid slug');

    // Slug uniqueness loop: base, base-2, base-3 … up to 100 attempts, so a
    // duplicate title never surfaces a unique-constraint 400. The insert is
    // also guarded: on a slug race the loop continues with the next candidate.
    for (let attempt = 1; attempt <= 100; attempt++) {
      const slug = attempt === 1 ? base : `${base}-${attempt}`;
      if (await slugExists(adapter, slug)) continue;
      const values = buildCreateValues(adapter, dto, { authorId, campaignId, slug, createdAt });
      try {
        const item =
          isMemoryDb
            ? memoryCreateInsert(adapter, values)
            : await drizzleCreateInsert(adapter, values);
        item.author = authorFromCallerOrRow(user, item.author);
        return item;
      } catch (e) {
        if (!isMemoryDb && isSlugUniqueViolation(e)) continue;
        throw e;
      }
    }
    throw new ConflictError('Could not generate a unique slug');
  }

  const VALID_UPDATE_STATUSES = ['draft', 'published'];

  function extractVideoId(url) {
    if (typeof url !== 'string') return null;
    const patterns = [
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([^&\n?#]+)/,
      /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([^&\n?#]+)/,
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/live\/([^&\n?#]+)/,
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  function normalizeUpdateArgs(argId, argDto, argUser) {
    const rawArgs = Array.from(arguments);
    // 4-arg form: update(type, id, dto, user) — used by forType binding.
    if (rawArgs.length >= 4 && typeof rawArgs[0] === 'string') {
      const [type, id, dto, user] = rawArgs;
      if (!type) throw new ValidationError('ContentType required');
      if (id === undefined || id === null || id === '') throw new ValidationError('id required');
      return { type, id: String(id), dto: dto || {}, user: user ?? null };
    }
    // 3-arg with (type, {id,...dto}, user)
    if (typeof argId === 'string' && argDto && typeof argDto === 'object' && !Array.isArray(argDto) && 'id' in argDto && !('type' in argDto)) {
      const { id, ...rest } = argDto;
      if (!argId) throw new ValidationError('ContentType required');
      if (id === undefined || id === null || id === '') throw new ValidationError('id required');
      return { type: argId, id: String(id), dto: rest, user: argUser ?? null };
    }
    // 3-arg with (id, {type,...dto}, user)
    if (typeof argId === 'string' && argDto && typeof argDto === 'object' && !Array.isArray(argDto) && 'type' in argDto) {
      const { type, ...rest } = argDto;
      if (!type) throw new ValidationError('ContentType required');
      if (argId === '') throw new ValidationError('id required');
      return { type, id: String(argId), dto: rest, user: argUser ?? null };
    }
    // Object form: update({type, id, ...dto}, user)
    if (argId && typeof argId === 'object' && !Array.isArray(argId)) {
      const { type, id, ...rest } = argId;
      const user = argDto ?? null;
      if (!type) throw new ValidationError('ContentType required');
      if (id === undefined || id === null || id === '') throw new ValidationError('id required');
      return { type, id: String(id), dto: rest, user };
    }
    throw new ValidationError('ContentType and id required');
  }

  function normalizeRemoveArgs(argId, argUser) {
    const rawArgs = Array.from(arguments);
    // 3-arg form: remove(type, id, user) — used by forType binding.
    if (rawArgs.length >= 3 && typeof rawArgs[0] === 'string') {
      const [type, id, user] = rawArgs;
      if (!type) throw new ValidationError('ContentType required');
      if (id === undefined || id === null || id === '') throw new ValidationError('id required');
      return { type, id: String(id), user: user ?? null };
    }
    // Object form: remove({type, id}, user)
    if (argId && typeof argId === 'object' && !Array.isArray(argId)) {
      const { type, id } = argId;
      if (!type) throw new ValidationError('ContentType required');
      if (id === undefined || id === null || id === '') throw new ValidationError('id required');
      return { type, id: String(id), user: argUser ?? null };
    }
    // (id, user) without type cannot resolve ContentType — require object form.
    throw new ValidationError('ContentType and id required');
  }

  function assertCanMutate(row, user) {
    if (!user || user.userId === undefined || user.userId === null || String(user.userId) === '') {
      throw new ForbiddenError('Authentication required');
    }
    if (String(row.authorId) !== String(user.userId) && user.role !== 'admin') {
      throw new ForbiddenError('Not allowed to modify this content');
    }
  }

  function validateUpdateDto(adapter, dto) {
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) {
      throw new ValidationError('Invalid payload');
    }
    const checkNonEmpty = (field, label) => {
      const v = dto[field];
      if (v === undefined) return;
      if (typeof v !== 'string' || v.trim() === '') {
        throw new ValidationError(`${label} must be a non-empty string`);
      }
    };
    checkNonEmpty('title', 'Title');
    checkNonEmpty('category', 'Category');
    if (adapter.type === 'kajian') {
      checkNonEmpty('description', 'Description');
      if (dto.youtubeLink !== undefined) {
        if (typeof dto.youtubeLink !== 'string' || dto.youtubeLink.trim() === '') {
          throw new ValidationError('YoutubeLink must be a non-empty string');
        }
        if (!extractVideoId(dto.youtubeLink)) {
          throw new ValidationError('Invalid youtubeLink');
        }
      }
    } else {
      checkNonEmpty('content', 'Content');
      if (dto.image !== undefined) {
        if (typeof dto.image !== 'string' || dto.image.trim() === '') {
          throw new ValidationError('Image must be a non-empty string');
        }
      }
    }
    if (dto.status !== undefined) {
      if (!VALID_UPDATE_STATUSES.includes(dto.status)) {
        throw new ValidationError('Invalid status: must be draft or published');
      }
    }
    if (dto.campaignId !== undefined && adapter.withCampaign) {
      const raw = dto.campaignId;
      if (!(raw === null || raw === '' || typeof raw === 'string')) {
        throw new ValidationError('Invalid campaignId');
      }
    }
  }

  async function bestEffortMediaRemove(url) {
    if (!url || typeof url !== 'string' || url === '') return;
    try {
      await media.remove(url);
    } catch (e) {
      console.warn(`best-effort media.remove failed for ${url}: ${e?.message || e}`);
    }
  }

  function buildUpdateValues(adapter, dto, user) {
    const values = {};
    if (dto.title !== undefined) values.title = dto.title;
    if (adapter.type === 'kajian') {
      if (dto.description !== undefined) values.description = dto.description;
      if (dto.youtubeLink !== undefined) values.youtubeLink = dto.youtubeLink;
    } else {
      if (dto.content !== undefined) values.content = dto.content;
      if (dto.image !== undefined) values.image = dto.image;
      if (dto.campaignId !== undefined) {
        const raw = dto.campaignId;
        values.campaignId = raw === null || raw === '' ? null : String(raw);
      }
    }
    if (dto.category !== undefined) values.category = dto.category;
    if (dto.status !== undefined) values.status = dto.status;
    // createdAt stays server-owned: only admin with valid ISO may backfill.
    if (dto.createdAt !== undefined && dto.createdAt !== null && dto.createdAt !== '') {
      if (user?.role === 'admin') {
        const d = new Date(dto.createdAt);
        if (Number.isNaN(d.getTime())) throw new ValidationError('Invalid createdAt: must be a valid date');
        values.createdAt = d;
      }
    }
    // updatedAt always server-owned; client value ignored.
    values.updatedAt = new Date();
    return values;
  }

  function mapJoinedById(adapter, row) {
    const tables = db.__tables;
    const u = (tables.users || []).find((x) => String(x.id) === String(row.authorId)) || null;
    const camp =
      adapter.withCampaign && row.campaignId
        ? (tables.campaigns || []).find((x) => String(x.id) === String(row.campaignId)) || null
        : null;
    return adapter.mapRow({
      [adapter.alias]: row,
      users: u ? { nama: u.nama, username: u.username } : null,
      campaigns: camp ? { title: camp.title, imageUrl: camp.imageUrl } : null,
    });
  }

  async function drizzleFetchJoinedById(adapter, id) {
    const table = adapter.table;
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
        .where(eq(table.id, id))
        .limit(1);
    } else {
      rows = await db
        .select({
          [adapter.alias]: table,
          users: { nama: usersTable.nama, username: usersTable.username },
        })
        .from(table)
        .leftJoin(usersTable, eq(table.authorId, usersTable.id))
        .where(eq(table.id, id))
        .limit(1);
    }
    if (!rows[0]) return null;
    return adapter.mapRow(rows[0]);
  }

  async function memoryUpdate(adapter, id, dto, user) {
    const rows = db.__tables[adapter.tableName] || [];
    const row = rows.find((r) => String(r.id) === String(id));
    if (!row) throw new NotFoundError(`${adapter.type} not found`);
    assertCanMutate(row, user);
    validateUpdateDto(adapter, dto);
    if (dto.campaignId !== undefined && adapter.withCampaign) {
      const raw = dto.campaignId;
      const campaignId = raw === null || raw === '' ? null : String(raw);
      if (campaignId && !(await campaignExists(campaignId))) {
        throw new ValidationError('Campaign not found');
      }
    }
    const oldImage = row.image;
    const values = buildUpdateValues(adapter, dto, user);
    Object.assign(row, values);
    const newImage = row.image;
    if (adapter.withCampaign && dto.image !== undefined && newImage !== oldImage && oldImage) {
      await bestEffortMediaRemove(oldImage);
    }
    return mapJoinedById(adapter, row);
  }

  async function drizzleUpdate(adapter, id, dto, user) {
    const table = adapter.table;
    const existingRows = await db.select().from(table).where(eq(table.id, id)).limit(1);
    const existing = existingRows[0];
    if (!existing) throw new NotFoundError(`${adapter.type} not found`);
    assertCanMutate(existing, user);
    validateUpdateDto(adapter, dto);
    if (dto.campaignId !== undefined && adapter.withCampaign) {
      const raw = dto.campaignId;
      const campaignId = raw === null || raw === '' ? null : String(raw);
      if (campaignId && !(await campaignExists(campaignId))) {
        throw new ValidationError('Campaign not found');
      }
    }
    const oldImage = existing.image;
    const values = buildUpdateValues(adapter, dto, user);
    const [updated] = await db.update(table).set(values).where(eq(table.id, id)).returning();
    if (!updated) throw new NotFoundError(`${adapter.type} not found`);
    if (adapter.withCampaign && dto.image !== undefined && updated.image !== oldImage && oldImage) {
      await bestEffortMediaRemove(oldImage);
    }
    const joined = await drizzleFetchJoinedById(adapter, id);
    return joined ?? adapter.mapRow({ [adapter.alias]: updated, users: null, campaigns: null });
  }

  async function update(id, dto, user) {
    const { type, id: rowId, dto: payload, user: caller } = normalizeUpdateArgs(...Array.from(arguments));
    const adapter = getAdapter(type);
    if (isMemoryDb) return memoryUpdate(adapter, rowId, payload, caller);
    return drizzleUpdate(adapter, rowId, payload, caller);
  }

  async function memoryRemove(adapter, id, user) {
    const rows = db.__tables[adapter.tableName] || [];
    const idx = rows.findIndex((r) => String(r.id) === String(id));
    if (idx === -1) throw new NotFoundError(`${adapter.type} not found`);
    const row = rows[idx];
    assertCanMutate(row, user);
    const oldImage = row.image;
    rows.splice(idx, 1);
    if (oldImage) await bestEffortMediaRemove(oldImage);
  }

  async function drizzleRemove(adapter, id, user) {
    const table = adapter.table;
    const existingRows = await db.select().from(table).where(eq(table.id, id)).limit(1);
    const existing = existingRows[0];
    if (!existing) throw new NotFoundError(`${adapter.type} not found`);
    assertCanMutate(existing, user);
    const oldImage = existing.image;
    await db.delete(table).where(eq(table.id, id));
    if (oldImage) await bestEffortMediaRemove(oldImage);
  }

  async function remove(id, user) {
    const { type, id: rowId, user: caller } = normalizeRemoveArgs(...Array.from(arguments));
    const adapter = getAdapter(type);
    if (isMemoryDb) return memoryRemove(adapter, rowId, caller);
    return drizzleRemove(adapter, rowId, caller);
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
      getBySlug: (slugOrObj) =>
        slugOrObj && typeof slugOrObj === 'object'
          ? getBySlug({ ...slugOrObj, type })
          : getBySlug(type, slugOrObj),
      create: (dto, user) =>
        dto && typeof dto === 'object' ? create({ ...dto, type }, user) : create(type, dto, user),
      update: (rowId, payload, caller) => update(type, rowId, payload, caller),
      remove: (rowId, caller) => remove(type, rowId, caller),
      categories: () => categories(type),
    };
  }

  return { list, getBySlug, create, update, remove, categories, for: forType, forType };
}

export { ValidationError, NotFoundError, ForbiddenError, ConflictError };
