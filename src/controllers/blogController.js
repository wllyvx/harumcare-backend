import { eq, desc, count, and, or, like } from 'drizzle-orm';
import { blogs, users, campaigns } from '../db/schema.js';
import { deleteFromR2 } from '../utils/r2.js';

// Helper to map join result
const mapBlogResult = (row) => {
    if (!row) return null;
    return {
        ...row.blogs,
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

// Get all blogs with pagination and filters
export const getAllBlogs = async (c) => {
    try {
        const db = c.get('db');
        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '10');
        const category = c.req.query('category');
        const status = c.req.query('status');
        const campaignId = c.req.query('campaignId');
        const searchQuery = c.req.query('q');

        const offset = (page - 1) * limit;

        const filters = [];
        // Only filter by status if provided, otherwise show all
        if (status && status !== 'all') {
            filters.push(eq(blogs.status, status));
        } else if (!status) {
            // Default to published for public access
            filters.push(eq(blogs.status, 'published'));
        }
        if (category) filters.push(eq(blogs.category, category));
        if (campaignId) filters.push(eq(blogs.campaignId, campaignId));
        if (searchQuery) {
            filters.push(or(
                like(blogs.title, `%${searchQuery}%`),
                like(blogs.content, `%${searchQuery}%`)
            ));
        }

        const whereClause = filters.length > 0 ? and(...filters) : undefined;

        // Get total count
        const [totalResult] = await db.select({ count: count() })
            .from(blogs)
            .where(whereClause);

        const totalBlogs = totalResult.count;
        const totalPages = Math.ceil(totalBlogs / limit);

        const rows = await db.select({
            blogs: blogs,
            users: {
                nama: users.nama,
                username: users.username
            },
            campaigns: {
                title: campaigns.title,
                imageUrl: campaigns.imageUrl
            }
        })
            .from(blogs)
            .leftJoin(users, eq(blogs.authorId, users.id))
            .leftJoin(campaigns, eq(blogs.campaignId, campaigns.id))
            .where(whereClause)
            .orderBy(desc(blogs.createdAt))
            .limit(limit)
            .offset(offset);

        return c.json({
            blogs: rows.map(mapBlogResult),
            currentPage: page,
            totalPages,
            totalBlogs
        });
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Get single blog by slug
export const getBlogBySlug = async (c) => {
    try {
        const db = c.get('db');
        const slugParam = c.req.param('slug');

        const [row] = await db.select({
            blogs: blogs,
            users: {
                nama: users.nama,
                username: users.username
            }
        })
            .from(blogs)
            .leftJoin(users, eq(blogs.authorId, users.id))
            .where(eq(blogs.slug, slugParam))
            .limit(1);

        if (!row) {
            return c.json({ error: 'Blog tidak ditemukan' }, 404);
        }

        const blogData = row.blogs;

        // Increment view count
        blogData.viewCount = (blogData.viewCount || 0) + 1;
        await db.update(blogs).set({ viewCount: blogData.viewCount }).where(eq(blogs.id, blogData.id));

        // Get related campaign if blog has campaignId
        let relatedCampaign = null;
        if (blogData.campaignId) {
            const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, blogData.campaignId));
            relatedCampaign = camp || null;
        }

        const blogWithCampaign = {
            ...blogData,
            author: row.users ? {
                nama: row.users.nama,
                username: row.users.username
            } : null,
            relatedCampaign
        };

        return c.json(blogWithCampaign);
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Create new blog
export const createBlog = async (c) => {
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

        const [savedBlog] = await db.insert(blogs).values({
            title,
            slug,
            content,
            category,
            image: image || 'images/empty-image-placeholder.webp',
            status,
            authorId: String(user.userId),
            campaignId: campaignId ? String(campaignId) : null
        }).returning();

        // Populate author details
        const responseData = {
            ...savedBlog,
            author: {
                nama: user.nama,
                username: user.username
            }
        };

        return c.json(responseData, 201);
    } catch (error) {
        console.error('Create blog error details:', {
            message: error.message,
            stack: error.stack,
            body: body,
            user: c.get('user')
        });
        return c.json({ error: `Gagal membuat blog. Pesan error: ${error.message}` }, 400);
    }
};

// Update blog
export const updateBlog = async (c) => {
    try {
        const db = c.get('db');
        const blogId = c.req.param('id');

        const body = await c.req.json();
        const { title, content, category, image, status, campaignId } = body;

        const [existingBlog] = await db.select().from(blogs).where(eq(blogs.id, blogId));

        if (!existingBlog) {
            return c.json({ error: 'Blog tidak ditemukan' }, 404);
        }

        const user = c.get('user');
        // Check if user is author or admin
        if (existingBlog.authorId !== user.userId && user.role !== 'admin') {
            return c.json({ error: 'Tidak memiliki izin untuk mengubah blog ini' }, 403);
        }

        const updateData = {};
        if (title) updateData.title = title;
        if (content) updateData.content = content;
        if (category) updateData.category = category;
        if (image) updateData.image = image;
        if (status) updateData.status = status;
        if (campaignId !== undefined) updateData.campaignId = campaignId || null;
        updateData.updatedAt = new Date();

        const [updatedBlog] = await db.update(blogs)
            .set(updateData)
            .where(eq(blogs.id, blogId))
            .returning();

        if (updatedBlog && image && existingBlog.image && image !== existingBlog.image) {
            await deleteFromR2(c, existingBlog.image);
        }

        return c.json(updatedBlog);
    } catch (error) {
        return c.json({ error: error.message }, 400);
    }
};

// Delete blog
export const deleteBlog = async (c) => {
    try {
        const db = c.get('db');
        const blogId = c.req.param('id');

        const [existingBlog] = await db.select().from(blogs).where(eq(blogs.id, blogId));

        if (!existingBlog) {
            return c.json({ error: 'Blog tidak ditemukan' }, 404);
        }

        const user = c.get('user');
        // Check if user is author or admin
        if (existingBlog.authorId !== user.userId && user.role !== 'admin') {
            return c.json({ error: 'Tidak memiliki izin untuk menghapus blog ini' }, 403);
        }

        if (existingBlog.image) {
            await deleteFromR2(c, existingBlog.image);
        }

        await db.delete(blogs).where(eq(blogs.id, blogId));
        return c.json({ message: 'Blog berhasil dihapus' });
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Get latest blogs
export const getLatestBlogs = async (c) => {
    try {
        const db = c.get('db');
        const limit = parseInt(c.req.query('limit') || '5');
        const campaignId = c.req.query('campaignId');

        const filters = [eq(blogs.status, 'published')];
        if (campaignId) filters.push(eq(blogs.campaignId, campaignId));

        const rows = await db.select({
            blogs: blogs,
            users: {
                nama: users.nama,
                username: users.username
            },
            campaigns: {
                title: campaigns.title,
                imageUrl: campaigns.imageUrl
            }
        })
            .from(blogs)
            .leftJoin(users, eq(blogs.authorId, users.id))
            .leftJoin(campaigns, eq(blogs.campaignId, campaigns.id))
            .where(and(...filters))
            .orderBy(desc(blogs.createdAt))
            .limit(limit);

        return c.json(rows.map(mapBlogResult));
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Get blogs by campaign
export const getBlogsByCampaign = async (c) => {
    try {
        const db = c.get('db');
        const campaignId = c.req.param('campaignId');

        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '10');
        const offset = (page - 1) * limit;

        const filters = [
            eq(blogs.campaignId, campaignId),
            eq(blogs.status, 'published')
        ];
        const whereClause = and(...filters);

        const [totalResult] = await db.select({ count: count() }).from(blogs).where(whereClause);
        const totalBlogs = totalResult.count;
        const totalPages = Math.ceil(totalBlogs / limit);

        const rows = await db.select({
            blogs: blogs,
            users: {
                nama: users.nama,
                username: users.username
            },
            campaigns: {
                title: campaigns.title,
                imageUrl: campaigns.imageUrl
            }
        })
            .from(blogs)
            .leftJoin(users, eq(blogs.authorId, users.id))
            .leftJoin(campaigns, eq(blogs.campaignId, campaigns.id))
            .where(whereClause)
            .orderBy(desc(blogs.createdAt))
            .limit(limit)
            .offset(offset);

        return c.json({
            blogs: rows.map(mapBlogResult),
            currentPage: page,
            totalPages,
            totalBlogs
        });
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Get all categories
export const getCategories = async (c) => {
    try {
        const db = c.get('db');
        const categories = await db.selectDistinct({ category: blogs.category }).from(blogs);
        return c.json(categories.map(c => c.category));
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};
