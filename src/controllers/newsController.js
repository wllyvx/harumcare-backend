import News from "../models/News.js";
import Campaign from "../models/Campaign.js";

// Get all news with pagination and filters
export const getAllNews = async (c) => {
    try {
        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '10');
        const category = c.req.query('category');
        const status = c.req.query('status') || 'published'; // Default to published news
        const campaignId = c.req.query('campaignId');

        const query = { status };
        if (category) query.category = category;
        if (campaignId) query.campaignId = campaignId;

        const totalNews = await News.countDocuments(query);
        const totalPages = Math.ceil(totalNews / limit);

        const news = await News.find(query)
            .populate('author', 'nama username')
            .populate('campaignId', 'title imageUrl')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        return c.json({
            news,
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
        const news = await News.findOne({ slug: c.req.param('slug') })
            .populate('author', 'nama username');

        if (!news) {
            return c.json({ error: 'Berita tidak ditemukan' }, 404);
        }

        // Get related campaign if news has campaignId
        let relatedCampaign = null;
        if (news.campaignId) {
            relatedCampaign = await Campaign.findById(news.campaignId);
        }

        // Increment view count
        news.viewCount += 1;
        await news.save();

        const newsWithCampaign = {
            ...news.toObject(),
            relatedCampaign
        };

        return c.json(newsWithCampaign);
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Create new news
export const createNews = async (c) => {
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

        const news = new News({
            title,
            slug,
            content,
            category,
            image,
            status,
            author: user.userId,
            campaignId: campaignId || null
        });

        const savedNews = await news.save();

        // If campaignId is provided, add this news to campaign's relatedNews array
        if (campaignId) {
            await Campaign.findByIdAndUpdate(
                campaignId,
                { $addToSet: { relatedNews: savedNews._id } }
            );
        }

        // Populate author details in response
        const populatedNews = await News.findById(savedNews._id).populate('author', 'nama username');

        return c.json(populatedNews, 201);
    } catch (error) {
        console.error('Create news error:', error);
        return c.json({ error: error.message }, 400);
    }
};

// Update news
export const updateNews = async (c) => {
    try {
        const body = await c.req.json();
        const { title, content, category, image, status, campaignId } = body;
        const news = await News.findById(c.req.param('id'));

        if (!news) {
            return c.json({ error: 'Berita tidak ditemukan' }, 404);
        }

        const user = c.get('user');
        // Check if user is author or admin
        if (news.author.toString() !== user.userId && user.role !== 'admin') {
            return c.json({ error: 'Tidak memiliki izin untuk mengubah berita ini' }, 403);
        }

        // Handle campaignId update
        if (campaignId !== undefined) {
            // Remove from old campaign if exists
            if (news.campaignId && news.campaignId.toString() !== campaignId) {
                await Campaign.findByIdAndUpdate(
                    news.campaignId,
                    { $pull: { relatedNews: news._id } }
                );
            }

            // Add to new campaign if provided
            if (campaignId) {
                await Campaign.findByIdAndUpdate(
                    campaignId,
                    { $addToSet: { relatedNews: news._id } }
                );
            }

            news.campaignId = campaignId || null;
        }

        news.title = title || news.title;
        news.content = content || news.content;
        news.category = category || news.category;
        news.image = image || news.image;
        news.status = status || news.status;

        await news.save();
        return c.json(news);
    } catch (error) {
        return c.json({ error: error.message }, 400);
    }
};

// Delete news
export const deleteNews = async (c) => {
    try {
        const news = await News.findById(c.req.param('id'));

        if (!news) {
            return c.json({ error: 'Berita tidak ditemukan' }, 404);
        }

        const user = c.get('user');
        // Check if user is author or admin
        if (news.author.toString() !== user.userId && user.role !== 'admin') {
            return c.json({ error: 'Tidak memiliki izin untuk menghapus berita ini' }, 403);
        }

        // Remove from campaign's relatedNews array if exists
        if (news.campaignId) {
            await Campaign.findByIdAndUpdate(
                news.campaignId,
                { $pull: { relatedNews: news._id } }
            );
        }

        await news.deleteOne();
        return c.json({ message: 'Berita berhasil dihapus' });
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Get latest news
export const getLatestNews = async (c) => {
    try {
        const limit = parseInt(c.req.query('limit') || '5');
        const campaignId = c.req.query('campaignId');

        const query = { status: 'published' };
        if (campaignId) query.campaignId = campaignId;

        const news = await News.find(query)
            .populate('author', 'nama username')
            .populate('campaignId', 'title imageUrl')
            .sort({ createdAt: -1 })
            .limit(limit);

        return c.json(news);
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};

// Get news by campaign
export const getNewsByCampaign = async (c) => {
    try {
        const campaignId = c.req.param('campaignId');
        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '10');

        const query = {
            campaignId: campaignId,
            status: 'published'
        };

        const totalNews = await News.countDocuments(query);
        const totalPages = Math.ceil(totalNews / limit);

        const news = await News.find(query)
            .populate('author', 'nama username')
            .populate('campaignId', 'title imageUrl')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        return c.json({
            news,
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
        const categories = await News.distinct('category');
        return c.json(categories);
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
};
