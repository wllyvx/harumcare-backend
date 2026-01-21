import Campaign from "../models/Campaign.js";
import Donation from "../models/Donations.js";
import News from "../models/News.js";

export const getAllCampaigns = async (c) => {
    try {
        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '100');
        const category = c.req.query('category');
        const status = c.req.query('status');

        let filter = {};

        // Filter by category
        if (category) {
            filter.category = category;
        }

        // Filter by status
        if (status === 'active') {
            filter.endDate = { $gte: new Date() };
        } else if (status === 'ended') {
            filter.endDate = { $lt: new Date() };
        }

        const campaigns = await Campaign.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip((page - 1) * limit);

        const total = await Campaign.countDocuments(filter);

        return c.json({
            campaigns,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (err) {
        console.error('Error getting campaigns:', err);
        return c.json({ error: 'Server error' }, 500);
    }
};

export const getCampaignById = async (c) => {
    try {
        const campaign = await Campaign.findById(c.req.param('id'));
        if (!campaign) {
            return c.json({ error: 'Campaign tidak ditemukan' }, 404);
        }

        // Get related news for this campaign
        const relatedNews = await News.find({
            campaignId: campaign._id,
            status: 'published'
        }).sort({ createdAt: -1 }).limit(5);

        // Add status based on end date
        const campaignWithStatus = {
            ...campaign.toObject(),
            status: new Date() > campaign.endDate ? 'ended' : 'active',
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

        const campaign = new Campaign({
            title,
            description,
            imageUrl,
            targetAmount,
            startDate: startDate || new Date(),
            endDate,
            organizationName,
            organizationLogo,
            category
        });

        await campaign.save();
        return c.json({
            message: 'Campaign berhasil dibuat',
            campaign
        }, 201);
    } catch (err) {
        console.error('Error creating campaign:', err);
        return c.json({ error: 'Error membuat campaign' }, 400);
    }
};

export const updateCampaign = async (c) => {
    try {
        const campaignId = c.req.param('id');
        const updateData = await c.req.json();

        // Remove fields that shouldn't be updated directly
        delete updateData.currentAmount;
        delete updateData.donorCount;
        delete updateData.createdAt;

        // Validate endDate if provided
        if (updateData.endDate && new Date(updateData.endDate) <= new Date()) {
            return c.json({ error: 'End date harus di masa depan' }, 400);
        }

        // Validate targetAmount if provided
        if (updateData.targetAmount && updateData.targetAmount <= 0) {
            return c.json({ error: 'Target amount harus lebih dari 0' }, 400);
        }

        const campaign = await Campaign.findByIdAndUpdate(
            campaignId,
            updateData,
            { new: true, runValidators: true }
        );

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
        const campaign = await Campaign.findById(c.req.param('id'));

        if (!campaign) {
            return c.json({ error: 'Campaign tidak ditemukan' }, 404);
        }

        // Check if campaign has donations and warn admin
        if (campaign.currentAmount > 0) {
            // Allow deletion but with warning - admin should be aware of consequences
            console.warn(`Admin is deleting campaign "${campaign.title}" with ${campaign.currentAmount} in donations and ${campaign.donorCount} donors`);
        }

        // Also delete related donations to maintain data integrity
        await Donation.deleteMany({ campaignId: c.req.param('id') });

        await Campaign.findByIdAndDelete(c.req.param('id'));
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
        const stats = await Campaign.aggregate([
            {
                $group: {
                    _id: null,
                    totalCampaigns: { $sum: 1 },
                    totalTargetAmount: { $sum: '$targetAmount' },
                    totalCurrentAmount: { $sum: '$currentAmount' },
                    totalDonors: { $sum: '$donorCount' },
                    activeCampaigns: {
                        $sum: {
                            $cond: [{ $gte: ['$endDate', new Date()] }, 1, 0]
                        }
                    }
                }
            }
        ]);

        return c.json(stats[0] || {
            totalCampaigns: 0,
            totalTargetAmount: 0,
            totalCurrentAmount: 0,
            totalDonors: 0,
            activeCampaigns: 0
        });
    } catch (err) {
        console.error('Error getting campaign stats:', err);
        return c.json({ error: 'Server error' }, 500);
    }
};
