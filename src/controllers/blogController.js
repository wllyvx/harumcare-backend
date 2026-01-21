import Blog from "../models/Blog.js";
import Campaign from "../models/Campaign.js";

// Get all blogs with pagination and filters
export const getAllBlogs = async (c) => {
    try {
        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '10');
        const category = c.req.query('category');
        const status = c.req.query('status');
        const campaignId = c.req.query('campaignId');

        const query = {};
        // Only filter by status if provided, otherwise show all
        if (status && status !== 'all') {
            query.status = status;
        } else if (!status) {
            // Default to published for public access
            query.status = 'published';
        }
        if (category) query.category = category;
        if (campaignId) query.campaignId = campaignId;

        const totalBlogs = await Blog.countDocuments(query);
        const totalPages = Math.ceil(totalBlogs / limit);

        const blogs = await Blog.find(query)
            .populate('author', 'nama username')
            .populate('campaignId', 'title imageUrl')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        return c.json({
            blogs,
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
        const blog = await Blog.findOne({ slug: c.req.param('slug') })
            .populate('author', 'nama username');

        if (!blog) {
            return c.json({ error: 'Blog tidak ditemukan' }, 404);
        }

        // Get related campaign if blog has campaignId
        let relatedCampaign = null;
        if (blog.campaignId) {
            relatedCampaign = await Campaign.findById(blog.campaignId);
        }

        // Increment view count
        blog.viewCount += 1;
        await blog.save();

        const blogWithCampaign = {
            ...blog.toObject(),
            relatedCampaign
        };

        return c.json(blogWithCampaign);
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Create new blog
export const createBlog = async (c) => {
    try {
        const body = await c.req.json();
        const { title, content, category, image, status, campaignId } = body;

        // Generate slug from title
        const slug = title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)+/g, '');

        const user = c.get('user');
        if (!user || !user.userId) {
            return c.json({ error: 'User tidak terautentikasi dengan benar' }, 401);
        }

        const blog = new Blog({
            title,
            slug,
            content,
            category,
            image,
            status,
            author: user.userId,
            campaignId: campaignId || null
        });

        const savedBlog = await blog.save();

        // If campaignId is provided, add this blog to campaign's relatedBlogs array
        if (campaignId) {
            await Campaign.findByIdAndUpdate(
                campaignId,
                { $addToSet: { relatedBlogs: savedBlog._id } }
            );
        }

        // Populate author details in response
        const populatedBlog = await Blog.findById(savedBlog._id).populate('author', 'nama username');

        return c.json(populatedBlog, 201);
    } catch (error) {
        console.error('Create blog error:', error);
        return c.json({ error: error.message }, 400);
    }
};

// Update blog
export const updateBlog = async (c) => {
    try {
        const body = await c.req.json();
        const { title, content, category, image, status, campaignId } = body;
        const blog = await Blog.findById(c.req.param('id'));

        if (!blog) {
            return c.json({ error: 'Blog tidak ditemukan' }, 404);
        }

        const user = c.get('user');
        // Check if user is author or admin
        if (blog.author.toString() !== user.userId && user.role !== 'admin') {
            return c.json({ error: 'Tidak memiliki izin untuk mengubah blog ini' }, 403);
        }

        // Handle campaignId update
        if (campaignId !== undefined) {
            // Remove from old campaign if exists
            if (blog.campaignId && blog.campaignId.toString() !== campaignId) {
                await Campaign.findByIdAndUpdate(
                    blog.campaignId,
                    { $pull: { relatedBlogs: blog._id } }
                );
            }

            // Add to new campaign if provided
            if (campaignId) {
                await Campaign.findByIdAndUpdate(
                    campaignId,
                    { $addToSet: { relatedBlogs: blog._id } }
                );
            }

            blog.campaignId = campaignId || null;
        }

        blog.title = title || blog.title;
        blog.content = content || blog.content;
        blog.category = category || blog.category;
        blog.image = image || blog.image;
        blog.status = status || blog.status;

        await blog.save();
        return c.json(blog);
    } catch (error) {
        return c.json({ error: error.message }, 400);
    }
};

// Delete blog
export const deleteBlog = async (c) => {
    try {
        const blog = await Blog.findById(c.req.param('id'));

        if (!blog) {
            return c.json({ error: 'Blog tidak ditemukan' }, 404);
        }

        const user = c.get('user');
        // Check if user is author or admin
        if (blog.author.toString() !== user.userId && user.role !== 'admin') {
            return c.json({ error: 'Tidak memiliki izin untuk menghapus blog ini' }, 403);
        }

        // Remove from campaign's relatedBlogs array if exists
        if (blog.campaignId) {
            await Campaign.findByIdAndUpdate(
                blog.campaignId,
                { $pull: { relatedBlogs: blog._id } }
            );
        }

        await blog.deleteOne();
        return c.json({ message: 'Blog berhasil dihapus' });
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Get latest blogs
export const getLatestBlogs = async (c) => {
    try {
        const limit = parseInt(c.req.query('limit') || '5');
        const campaignId = c.req.query('campaignId');

        const query = { status: 'published' };
        if (campaignId) query.campaignId = campaignId;

        const blogs = await Blog.find(query)
            .populate('author', 'nama username')
            .populate('campaignId', 'title imageUrl')
            .sort({ createdAt: -1 })
            .limit(limit);

        return c.json(blogs);
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Get blogs by campaign
export const getBlogsByCampaign = async (c) => {
    try {
        const campaignId = c.req.param('campaignId');
        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '10');

        const query = {
            campaignId: campaignId,
            status: 'published'
        };

        const totalBlogs = await Blog.countDocuments(query);
        const totalPages = Math.ceil(totalBlogs / limit);

        const blogs = await Blog.find(query)
            .populate('author', 'nama username')
            .populate('campaignId', 'title imageUrl')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        return c.json({
            blogs,
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
        const categories = await Blog.distinct('category');
        return c.json(categories);
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};
