import { eq, desc, sql, count, sum, and, or, gte, lt } from 'drizzle-orm';
import { campaigns, news } from '../db/schema.js';

const escapeLike = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
import { removeMediaBestEffort, createMedia } from '../modules/media/index.js';
import { createCampaignModule } from '../modules/campaign/index.js';

const removeMedia = (c, url) => removeMediaBestEffort(c.env?.BUCKET, url);

export const getAllCampaigns = async (c) => {
    try {
        const db = c.get('db');
        const queryPage = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '100');
        const category = c.req.query('category');
        const status = c.req.query('status');
        const searchRaw = c.req.query('search') || c.req.query('q');
        const search = typeof searchRaw === 'string' && searchRaw.trim() !== '' ? searchRaw.trim() : undefined;

        const offset = (queryPage - 1) * limit;

        const filters = [];
        if (category) {
            filters.push(eq(campaigns.category, category));
        }

        if (search) {
            const pattern = `%${escapeLike(search)}%`;
            filters.push(or(
                sql`${campaigns.title} LIKE ${pattern} ESCAPE '\\'`,
                sql`${campaigns.description} LIKE ${pattern} ESCAPE '\\'`
            ));
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

export const getCampaignCategories = async (c) => {
    try {
        const db = c.get('db');
        const rows = await db.selectDistinct({ category: campaigns.category }).from(campaigns);
        const categories = rows
            .map((r) => r.category)
            .filter((v) => typeof v === 'string' && v.trim() !== '')
            .sort((a, b) => a.localeCompare(b));
        return c.json({ categories });
    } catch (err) {
        console.error('Error getting campaign categories:', err);
        return c.json({ error: 'Server error: ' + err.message }, 500);
    }
};

export const getCampaignById = async (c) => {
    try {
        const db = c.get('db');
        const id = c.req.param('id');

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
        const campaignId = c.req.param('id');

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

        // Fetch existing campaign to check for image changes
        const [existingCampaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
        if (!existingCampaign) {
            return c.json({ error: 'Campaign tidak ditemukan' }, 404);
        }

        const [campaign] = await db.update(campaigns)
            .set(updateData)
            .where(eq(campaigns.id, campaignId))
            .returning();

        if (campaign) {
            // If imageUrl changed, delete the old one
            if (updateData.imageUrl && existingCampaign.imageUrl && updateData.imageUrl !== existingCampaign.imageUrl) {
                await removeMedia(c, existingCampaign.imageUrl);
            }
            // If organizationLogo changed, delete the old one
            if (updateData.organizationLogo && existingCampaign.organizationLogo && updateData.organizationLogo !== existingCampaign.organizationLogo) {
                await removeMedia(c, existingCampaign.organizationLogo);
            }
        }

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
        const campaignId = c.req.param('id');

        // Thin adapter over the Campaign removal seam (C02-T4): the module
        // owns atomic Campaign + donations deletes with media cleanup
        // best-effort-after-commit. No sequential loop with interleaved
        // media deletes lives here.
        const mod = createCampaignModule({ db: c.get('db'), media: createMedia({ bucket: c.env?.BUCKET }) });
        let result;
        try {
            result = await mod.remove(campaignId);
        } catch (err) {
            if (err?.statusCode === 404) {
                return c.json({ error: 'Campaign tidak ditemukan' }, 404);
            }
            throw err;
        }

        return c.json({
            message: 'Campaign berhasil dihapus',
            warning: result.warning,
            removedDonationCount: result.removedDonationCount
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
