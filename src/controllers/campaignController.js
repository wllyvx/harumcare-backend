import { eq, desc, sql, count, sum, and, gte, lt } from 'drizzle-orm';
import { campaigns, news, donations } from '../db/schema.js';

export const getAllCampaigns = async (c) => {
    try {
        const db = c.get('db');
        const queryPage = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '100');
        const category = c.req.query('category');
        const status = c.req.query('status');

        const offset = (queryPage - 1) * limit;

        const filters = [];
        if (category) {
            filters.push(eq(campaigns.category, category));
        }

        const now = new Date();
        if (status === 'active') {
            filters.push(gte(campaigns.endDate, now));
        } else if (status === 'ended') {
            filters.push(lt(campaigns.endDate, now));
        }

        const whereClause = filters.length > 0 ? and(...filters) : undefined;

        const campaignsList = await db.select()
            .from(campaigns)
            .where(whereClause)
            .orderBy(desc(campaigns.createdAt))
            .limit(limit)
            .offset(offset);

        // Get total count for pagination
        const [totalResult] = await db.select({ count: count() })
            .from(campaigns)
            .where(whereClause);

        const total = totalResult.count;

        return c.json({
            campaigns: campaignsList,
            totalPages: Math.ceil(total / limit),
            currentPage: queryPage,
            total
        });
    } catch (err) {
        console.error('Error getting campaigns:', err);
        return c.json({ error: 'Server error: ' + err.message }, 500);
    }
};

export const getCampaignById = async (c) => {
    try {
        const db = c.get('db');
        const id = parseInt(c.req.param('id'));
        if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

        const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
        if (!campaign) {
            return c.json({ error: 'Campaign tidak ditemukan' }, 404);
        }

        // Get related news for this campaign
        const relatedNews = await db.select()
            .from(news)
            .where(and(eq(news.campaignId, id), eq(news.status, 'published')))
            .orderBy(desc(news.createdAt))
            .limit(5);

        // Add status based on end date
        const campaignWithStatus = {
            ...campaign,
            status: new Date() > new Date(campaign.endDate) ? 'ended' : 'active',
            progress: campaign.targetAmount > 0 ? (campaign.currentAmount / campaign.targetAmount) * 100 : 0,
            relatedNews
        };

        return c.json(campaignWithStatus);
    } catch (err) {
        console.error('Error getting campaign:', err);
        return c.json({ error: 'Server error' }, 500);
    }
};

export const createCampaign = async (c) => {
    try {
        const db = c.get('db');
        const body = await c.req.json();
        const {
            title,
            description,
            imageUrl,
            targetAmount,
            startDate,
            endDate,
            organizationName,
            organizationLogo,
            category
        } = body;

        // Validasi input
        if (!title || !targetAmount || !endDate) {
            return c.json({ error: 'Title, target amount, dan end date wajib diisi' }, 400);
        }

        if (targetAmount <= 0) {
            return c.json({ error: 'Target amount harus lebih dari 0' }, 400);
        }

        if (new Date(endDate) <= new Date()) {
            return c.json({ error: 'End date harus di masa depan' }, 400);
        }

        const [newCampaign] = await db.insert(campaigns).values({
            title,
            description,
            imageUrl,
            targetAmount,
            startDate: startDate ? new Date(startDate) : new Date(),
            endDate: new Date(endDate),
            organizationName,
            organizationLogo,
            category
        }).returning();

        return c.json({
            message: 'Campaign berhasil dibuat',
            campaign: newCampaign
        }, 201);
    } catch (err) {
        console.error('Error creating campaign:', err);
        return c.json({ error: 'Error membuat campaign' }, 400);
    }
};

export const updateCampaign = async (c) => {
    try {
        const db = c.get('db');
        const campaignId = parseInt(c.req.param('id'));
        if (isNaN(campaignId)) return c.json({ error: 'Invalid ID' }, 400);

        const updateDataRaw = await c.req.json();

        // Remove fields that shouldn't be updated directly
        const { currentAmount, donorCount, createdAt, id, ...updateData } = updateDataRaw;

        // Validate endDate if provided
        if (updateData.endDate && new Date(updateData.endDate) <= new Date()) {
            return c.json({ error: 'End date harus di masa depan' }, 400);
        }

        // Validate targetAmount if provided
        if (updateData.targetAmount && updateData.targetAmount <= 0) {
            return c.json({ error: 'Target amount harus lebih dari 0' }, 400);
        }

        // Handle dates
        if (updateData.startDate) updateData.startDate = new Date(updateData.startDate);
        if (updateData.endDate) updateData.endDate = new Date(updateData.endDate);

        const [campaign] = await db.update(campaigns)
            .set(updateData)
            .where(eq(campaigns.id, campaignId))
            .returning();

        if (!campaign) {
            return c.json({ error: 'Campaign tidak ditemukan' }, 404);
        }

        return c.json({
            message: 'Campaign berhasil diupdate',
            campaign
        });
    } catch (err) {
        console.error('Error updating campaign:', err);
        return c.json({ error: 'Error mengupdate campaign' }, 400);
    }
};

export const deleteCampaign = async (c) => {
    try {
        const db = c.get('db');
        const campaignId = parseInt(c.req.param('id'));
        if (isNaN(campaignId)) return c.json({ error: 'Invalid ID' }, 400);

        const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));

        if (!campaign) {
            return c.json({ error: 'Campaign tidak ditemukan' }, 404);
        }

        // Check if campaign has donations and warn admin
        if (campaign.currentAmount > 0) {
            // Allow deletion but with warning - admin should be aware of consequences
            console.warn(`Admin is deleting campaign "${campaign.title}" with ${campaign.currentAmount} in donations and ${campaign.donorCount} donors`);
        }

        // Also delete related donations to maintain data integrity
        await db.delete(donations).where(eq(donations.campaignId, campaignId));

        await db.delete(campaigns).where(eq(campaigns.id, campaignId));

        return c.json({
            message: 'Campaign berhasil dihapus',
            warning: campaign.currentAmount > 0 ? 'Campaign yang dihapus memiliki donasi yang juga akan dihapus' : null
        });
    } catch (err) {
        console.error('Error deleting campaign:', err);
        return c.json({ error: 'Server error' }, 500);
    }
};

export const getCampaignStats = async (c) => {
    try {
        const db = c.get('db');

        const [totalStats] = await db.select({
            totalCampaigns: count(),
            totalTargetAmount: sum(campaigns.targetAmount),
            totalCurrentAmount: sum(campaigns.currentAmount),
            totalDonors: sum(campaigns.donorCount)
        }).from(campaigns);

        const now = new Date();
        const [activeStats] = await db.select({
            activeCampaigns: count()
        }).from(campaigns).where(gte(campaigns.endDate, now));

        return c.json({
            totalCampaigns: Number(totalStats?.totalCampaigns || 0),
            totalTargetAmount: Number(totalStats?.totalTargetAmount || 0),
            totalCurrentAmount: Number(totalStats?.totalCurrentAmount || 0),
            totalDonors: Number(totalStats?.totalDonors || 0),
            activeCampaigns: Number(activeStats?.activeCampaigns || 0)
        });
    } catch (err) {
        console.error('Error getting campaign stats:', err);
        return c.json({ error: 'Server error' }, 500);
    }
};
