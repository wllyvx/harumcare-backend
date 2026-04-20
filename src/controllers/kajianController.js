import { eq, desc, count, and, or, like } from 'drizzle-orm';
import { kajians, users } from '../db/schema.js';

// Helper to map join result
const mapKajianResult = (row) => {
    if (!row) return null;
    return {
        ...row.kajians,
        author: row.users ? {
            nama: row.users.nama,
            username: row.users.username
        } : null
    };
};

// Function to extract video ID from YouTube URL
const extractVideoId = (url) => {
    const patterns = [
        /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([^&\n?#]+)/,
        /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([^&\n?#]+)/,
        /(?:https?:\/\/)?(?:www\.)?youtube\.com\/live\/([^&\n?#]+)/
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
};

// Function to fetch video info from YouTube API
const fetchYouTubeVideoInfo = async (videoId, apiKey) => {
    try {
        const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${apiKey}&part=snippet`);
        const data = await response.json();
        if (data.items && data.items.length > 0) {
            const snippet = data.items[0].snippet;
            return {
                title: snippet.title,
                description: snippet.description
            };
        }
        throw new Error('Video not found or private');
    } catch (error) {
        throw new Error(`Failed to fetch YouTube data: ${error.message}`);
    }
};

// Get all kajians with pagination and filters
export const getAllKajians = async (c) => {
    try {
        const db = c.get('db');
        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '10');
        const category = c.req.query('category');
        const status = c.req.query('status');
        const searchQuery = c.req.query('q');

        const offset = (page - 1) * limit;

        const filters = [];
        // Only filter by status if provided, otherwise show all
        if (status && status !== 'all') {
            filters.push(eq(kajians.status, status));
        } else if (!status) {
            // Default to published for public access
            filters.push(eq(kajians.status, 'published'));
        }
        if (category) filters.push(eq(kajians.category, category));
        if (searchQuery) {
            filters.push(or(
                like(kajians.title, `%${searchQuery}%`),
                like(kajians.description, `%${searchQuery}%`)
            ));
        }

        const whereClause = filters.length > 0 ? and(...filters) : undefined;

        // Get total count
        const [totalResult] = await db.select({ count: count() })
            .from(kajians)
            .where(whereClause);

        const totalKajians = totalResult.count;
        const totalPages = Math.ceil(totalKajians / limit);

        const rows = await db.select({
            kajians: kajians,
            users: {
                nama: users.nama,
                username: users.username
            }
        })
            .from(kajians)
            .leftJoin(users, eq(kajians.authorId, users.id))
            .where(whereClause)
            .orderBy(desc(kajians.createdAt))
            .limit(limit)
            .offset(offset);

        return c.json({
            kajians: rows.map(mapKajianResult),
            currentPage: page,
            totalPages,
            totalKajians
        });
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Get single kajian by slug
export const getKajianBySlug = async (c) => {
    try {
        const db = c.get('db');
        const slugParam = c.req.param('slug');

        const [row] = await db.select({
            kajians: kajians,
            users: {
                nama: users.nama,
                username: users.username
            }
        })
            .from(kajians)
            .leftJoin(users, eq(kajians.authorId, users.id))
            .where(eq(kajians.slug, slugParam))
            .limit(1);

        if (!row) {
            return c.json({ error: 'Kajian tidak ditemukan' }, 404);
        }

        const kajianData = row.kajians;

        // Increment view count
        kajianData.viewCount = (kajianData.viewCount || 0) + 1;
        await db.update(kajians).set({ viewCount: kajianData.viewCount }).where(eq(kajians.id, kajianData.id));

        const kajianWithAuthor = {
            ...kajianData,
            author: row.users ? {
                nama: row.users.nama,
                username: row.users.username
            } : null
        };

        return c.json(kajianWithAuthor);
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Create new kajian
export const createKajian = async (c) => {
    let body = {};
    try {
        const db = c.get('db');
        body = await c.req.json();
        const { title, description, youtubeLink, category, status, createdAt } = body;

        // Validate required fields
        if (!youtubeLink || !category || !status) {
            return c.json({
                error: 'Field required: youtubeLink, category, status harus diisi'
            }, 400);
        }

        const videoId = extractVideoId(youtubeLink);
        if (!videoId) {
            return c.json({ error: 'Link YouTube tidak valid' }, 400);
        }

        // Fetch from YouTube if title or description not provided
        let finalTitle = title;
        let finalDescription = description;
        const apiKey = c.env.YOUTUBE_API_KEY;
        if (apiKey && (!finalTitle || !finalDescription)) {
            try {
                const videoInfo = await fetchYouTubeVideoInfo(videoId, apiKey);
                if (!finalTitle) finalTitle = videoInfo.title;
                if (!finalDescription) finalDescription = videoInfo.description;
            } catch (error) {
                console.warn('Failed to fetch YouTube data:', error.message);
                // Continue with provided data or error if required fields missing
            }
        }

        if (!finalTitle || !finalDescription) {
            return c.json({
                error: 'Title dan description diperlukan. Jika tidak disediakan, pastikan YouTube API key valid untuk auto-fetch.'
            }, 400);
        }

        // Generate slug from title
        const slug = finalTitle
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)+/g, '');

        const user = c.get('user');
        if (!user || !user.userId) {
            return c.json({ error: 'User tidak terautentikasi dengan benar' }, 401);
        }

        const [savedKajian] = await db.insert(kajians).values({
            title: finalTitle,
            slug,
            description: finalDescription,
            youtubeLink,
            category,
            status,
            authorId: String(user.userId),
            createdAt: createdAt ? new Date(createdAt) : undefined
        }).returning();

        // Populate author details
        const responseData = {
            ...savedKajian,
            author: {
                nama: user.nama,
                username: user.username
            }
        };

        return c.json(responseData, 201);
    } catch (error) {
        console.error('Create kajian error details:', {
            message: error.message,
            stack: error.stack,
            body: body,
            user: c.get('user')
        });
        return c.json({ error: `Gagal membuat kajian. Pesan error: ${error.message}` }, 400);
    }
};

// Update kajian
export const updateKajian = async (c) => {
    try {
        const db = c.get('db');
        const kajianId = c.req.param('id');

        const body = await c.req.json();
        const { title, description, youtubeLink, category, status, createdAt } = body;

        const [existingKajian] = await db.select().from(kajians).where(eq(kajians.id, kajianId));

        if (!existingKajian) {
            return c.json({ error: 'Kajian tidak ditemukan' }, 404);
        }

        const user = c.get('user');
        // Check if user is author or admin
        if (existingKajian.authorId !== user.userId && user.role !== 'admin') {
            return c.json({ error: 'Tidak memiliki izin untuk mengubah kajian ini' }, 403);
        }

        // If youtubeLink changed, validate and potentially fetch new data
        let finalTitle = title || existingKajian.title;
        let finalDescription = description || existingKajian.description;
        if (youtubeLink && youtubeLink !== existingKajian.youtubeLink) {
            const videoId = extractVideoId(youtubeLink);
            if (!videoId) {
                return c.json({ error: 'Link YouTube tidak valid' }, 400);
            }
            const apiKey = c.env.YOUTUBE_API_KEY;
            if (apiKey && (!title || !description)) {
                try {
                    const videoInfo = await fetchYouTubeVideoInfo(videoId, apiKey);
                    if (!title) finalTitle = videoInfo.title;
                    if (!description) finalDescription = videoInfo.description;
                } catch (error) {
                    console.warn('Failed to fetch YouTube data:', error.message);
                }
            }
        }

        const updateData = {};
        if (finalTitle) updateData.title = finalTitle;
        if (finalDescription) updateData.description = finalDescription;
        if (youtubeLink) updateData.youtubeLink = youtubeLink;
        if (category) updateData.category = category;
        if (status) updateData.status = status;
        if (createdAt) updateData.createdAt = new Date(createdAt);
        updateData.updatedAt = new Date();

        const [updatedKajian] = await db.update(kajians)
            .set(updateData)
            .where(eq(kajians.id, kajianId))
            .returning();

        return c.json(updatedKajian);
    } catch (error) {
        return c.json({ error: error.message }, 400);
    }
};

// Delete kajian
export const deleteKajian = async (c) => {
    try {
        const db = c.get('db');
        const kajianId = c.req.param('id');

        const [existingKajian] = await db.select().from(kajians).where(eq(kajians.id, kajianId));

        if (!existingKajian) {
            return c.json({ error: 'Kajian tidak ditemukan' }, 404);
        }

        const user = c.get('user');
        // Check if user is author or admin
        if (existingKajian.authorId !== user.userId && user.role !== 'admin') {
            return c.json({ error: 'Tidak memiliki izin untuk menghapus kajian ini' }, 403);
        }

        await db.delete(kajians).where(eq(kajians.id, kajianId));
        return c.json({ message: 'Kajian berhasil dihapus' });
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Get latest kajians
export const getLatestKajians = async (c) => {
    try {
        const db = c.get('db');
        const limit = parseInt(c.req.query('limit') || '5');

        const rows = await db.select({
            kajians: kajians,
            users: {
                nama: users.nama,
                username: users.username
            }
        })
            .from(kajians)
            .leftJoin(users, eq(kajians.authorId, users.id))
            .where(eq(kajians.status, 'published'))
            .orderBy(desc(kajians.createdAt))
            .limit(limit);

        return c.json(rows.map(mapKajianResult));
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Get all categories
export const getKajianCategories = async (c) => {
    try {
        const db = c.get('db');
        const categories = await db.selectDistinct({ category: kajians.category }).from(kajians);
        return c.json(categories.map(c => c.category));
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Fetch YouTube video data
export const fetchYouTubeData = async (c) => {
    try {
        const videoId = c.req.query('videoId');
        if (!videoId) {
            return c.json({ error: 'videoId parameter required' }, 400);
        }

        const apiKey = c.env.YOUTUBE_API_KEY;
        if (!apiKey) {
            return c.json({ error: 'YouTube API key not configured' }, 500);
        }

        const data = await fetchYouTubeVideoInfo(videoId, apiKey);
        return c.json(data);
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};