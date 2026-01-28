import { eq, desc, count, and } from 'drizzle-orm';
import { news, users, campaigns } from '../db/schema.js';
import { deleteFromR2 } from '../utils/r2.js';

// Helper to map join result
const mapNewsResult = (row) => {
    if (!row) return null;
    return {
        ...row.news,
        author: row.users ? {
            nama: row.users.nama,
            username: row.users.username
        } : null,
        campaignId: row.campaigns ? {
            title: row.campaigns.title,
            imageUrl: row.campaigns.imageUrl
        } : null
    };
};

// Get all news with pagination and filters
export const getAllNews = async (c) => {
    try {
        const db = c.get('db');
        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '10');
        const category = c.req.query('category');
        const status = c.req.query('status') || 'published'; // Default to published news
        const campaignId = c.req.query('campaignId');

        const offset = (page - 1) * limit;

        const filters = [eq(news.status, status)];
        if (category) filters.push(eq(news.category, category));
        if (campaignId) filters.push(eq(news.campaignId, campaignId));

        const whereClause = and(...filters);

        // Get total count
        const [totalResult] = await db.select({ count: count() })
            .from(news)
            .where(whereClause);

        const totalNews = totalResult.count;
        const totalPages = Math.ceil(totalNews / limit);

        const rows = await db.select({
            news: news,
            users: {
                nama: users.nama,
                username: users.username
            },
            campaigns: {
                title: campaigns.title,
                imageUrl: campaigns.imageUrl
            }
        })
            .from(news)
            .leftJoin(users, eq(news.authorId, users.id))
            .leftJoin(campaigns, eq(news.campaignId, campaigns.id))
            .where(whereClause)
            .orderBy(desc(news.createdAt))
            .limit(limit)
            .offset(offset);

        return c.json({
            news: rows.map(mapNewsResult),
            currentPage: page,
            totalPages,
            totalNews
        });
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Get single news by slug
export const getNewsBySlug = async (c) => {
    try {
        const db = c.get('db');
        const slugParam = c.req.param('slug');

        const [row] = await db.select({
            news: news,
            users: {
                nama: users.nama,
                username: users.username
            }
        })
            .from(news)
            .leftJoin(users, eq(news.authorId, users.id))
            .where(eq(news.slug, slugParam))
            .limit(1);

        if (!row) {
            return c.json({ error: 'Berita tidak ditemukan' }, 404);
        }

        const newsData = row.news;

        // Increment view count
        newsData.viewCount = (newsData.viewCount || 0) + 1;
        await db.update(news).set({ viewCount: newsData.viewCount }).where(eq(news.id, newsData.id));

        // Get related campaign if news has campaignId
        let relatedCampaign = null;
        if (newsData.campaignId) {
            const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, newsData.campaignId));
            relatedCampaign = camp || null;
        }

        const newsWithCampaign = {
            ...newsData,
            author: row.users ? {
                nama: row.users.nama,
                username: row.users.username
            } : null,
            relatedCampaign
        };

        return c.json(newsWithCampaign);
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Create new news
export const createNews = async (c) => {
    let body = {};
    try {
        const db = c.get('db');
        body = await c.req.json();
        const { title, content, category, image, status, campaignId } = body;

        // Validate required fields
        if (!title || !content || !category || !status) {
            return c.json({ 
                error: 'Field required: title, content, category, status harus diisi' 
            }, 400);
        }

        // Generate slug from title
        const slug = title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)+/g, '');

        const user = c.get('user');
        if (!user || !user.userId) {
            return c.json({ error: 'User tidak terautentikasi dengan benar' }, 401);
        }

        const [savedNews] = await db.insert(news).values({
            title,
            slug,
            content,
            category,
            image: image || 'images/empty-image-placeholder.webp',
            status,
            authorId: user.userId,
            campaignId: campaignId || null
        }).returning();

        // Populate author details
        const responseData = {
            ...savedNews,
            author: {
                nama: user.nama,
                username: user.username
            }
        };

        return c.json(responseData, 201);
    } catch (error) {
        console.error('Create news error details:', {
            message: error.message,
            stack: error.stack,
            body: body,
            user: c.get('user')
        });
        return c.json({ error: `Gagal membuat berita. Pesan error: ${error.message}` }, 400);
    }
};

// Update news
export const updateNews = async (c) => {
    try {
        const db = c.get('db');
        const newsId = c.req.param('id');

        const body = await c.req.json();
        const { title, content, category, image, status, campaignId } = body;

        const [existingNews] = await db.select().from(news).where(eq(news.id, newsId));

        if (!existingNews) {
            return c.json({ error: 'Berita tidak ditemukan' }, 404);
        }

        const user = c.get('user');
        // Check if user is author or admin (authorId is int, userId is int from token)
        if (existingNews.authorId !== user.userId && user.role !== 'admin') {
            return c.json({ error: 'Tidak memiliki izin untuk mengubah berita ini' }, 403);
        }

        const updateData = {};
        if (title) updateData.title = title;
        if (content) updateData.content = content;
        if (category) updateData.category = category;
        if (image) updateData.image = image;
        if (status) updateData.status = status;
        if (campaignId !== undefined) updateData.campaignId = campaignId || null;
        updateData.updatedAt = new Date();

        const [updatedNews] = await db.update(news)
            .set(updateData)
            .where(eq(news.id, newsId))
            .returning();

        if (updatedNews && image && existingNews.image && image !== existingNews.image) {
            await deleteFromR2(c, existingNews.image);
        }

        return c.json(updatedNews);
    } catch (error) {
        return c.json({ error: error.message }, 400);
    }
};

// Delete news
export const deleteNews = async (c) => {
    try {
        const db = c.get('db');
        const newsId = c.req.param('id');

        const [existingNews] = await db.select().from(news).where(eq(news.id, newsId));

        if (!existingNews) {
            return c.json({ error: 'Berita tidak ditemukan' }, 404);
        }

        const user = c.get('user');
        // Check if user is author or admin
        if (existingNews.authorId !== user.userId && user.role !== 'admin') {
            return c.json({ error: 'Tidak memiliki izin untuk menghapus berita ini' }, 403);
        }

        if (existingNews.image) {
            await deleteFromR2(c, existingNews.image);
        }

        await db.delete(news).where(eq(news.id, newsId));
        return c.json({ message: 'Berita berhasil dihapus' });
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Get latest news
export const getLatestNews = async (c) => {
    try {
        const db = c.get('db');
        const limit = parseInt(c.req.query('limit') || '5');
        const campaignId = c.req.query('campaignId');

        const filters = [eq(news.status, 'published')];
        if (campaignId) filters.push(eq(news.campaignId, campaignId));

        const rows = await db.select({
            news: news,
            users: {
                nama: users.nama,
                username: users.username
            },
            campaigns: {
                title: campaigns.title,
                imageUrl: campaigns.imageUrl
            }
        })
            .from(news)
            .leftJoin(users, eq(news.authorId, users.id))
            .leftJoin(campaigns, eq(news.campaignId, campaigns.id))
            .where(and(...filters))
            .orderBy(desc(news.createdAt))
            .limit(limit);

        return c.json(rows.map(mapNewsResult));
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Get news by campaign
export const getNewsByCampaign = async (c) => {
    try {
        const db = c.get('db');
        const campaignId = c.req.param('campaignId');

        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '10');
        const offset = (page - 1) * limit;

        const filters = [
            eq(news.campaignId, campaignId),
            eq(news.status, 'published')
        ];
        const whereClause = and(...filters);

        const [totalResult] = await db.select({ count: count() }).from(news).where(whereClause);
        const totalNews = totalResult.count;
        const totalPages = Math.ceil(totalNews / limit);

        const rows = await db.select({
            news: news,
            users: {
                nama: users.nama,
                username: users.username
            },
            campaigns: {
                title: campaigns.title,
                imageUrl: campaigns.imageUrl
            }
        })
            .from(news)
            .leftJoin(users, eq(news.authorId, users.id))
            .leftJoin(campaigns, eq(news.campaignId, campaigns.id))
            .where(whereClause)
            .orderBy(desc(news.createdAt))
            .limit(limit)
            .offset(offset);

        return c.json({
            news: rows.map(mapNewsResult),
            currentPage: page,
            totalPages,
            totalNews
        });
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Get all categories
export const getCategories = async (c) => {
    try {
        const db = c.get('db');
        const categories = await db.selectDistinct({ category: news.category }).from(news);
        return c.json(categories.map(c => c.category));
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};
