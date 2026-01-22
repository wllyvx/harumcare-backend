import { eq, desc, and, sql, sum, count } from 'drizzle-orm';
import { donations, campaigns, users } from '../db/schema.js';

// Helper to update campaign stats (currentAmount and donorCount)
const updateCampaignStats = async (db, campaignId) => {
    try {
        const [stats] = await db.select({
            totalAmount: sum(donations.amount),
            totalDonors: count(donations.id)
        })
            .from(donations)
            .where(
                and(
                    eq(donations.campaignId, campaignId),
                    eq(donations.paymentStatus, 'completed')
                )
            );

        const currentAmount = Number(stats?.totalAmount || 0);
        const donorCount = Number(stats?.totalDonors || 0);

        await db.update(campaigns)
            .set({ currentAmount, donorCount })
            .where(eq(campaigns.id, campaignId));

        console.log("Campaign updated with recalculated values:", {
            campaignId,
            currentAmount,
            donorCount
        });

        return { currentAmount, donorCount };
    } catch (error) {
        console.error("Error updating campaign stats:", error);
        throw error;
    }
};

// Helper to map donation result with joins
const mapDonationResult = (row) => {
    if (!row) return null;
    return {
        ...row.donations,
        user: row.users ? {
            nama: row.users.nama,
            email: row.users.email
        } : null,
        campaign: row.campaigns ? {
            title: row.campaigns.title,
            imageUrl: row.campaigns.imageUrl
        } : null
    };
};

// Create donation
export const createDonation = async (c) => {
    try {
        const db = c.get('db');
        const body = await c.req.json();
        const user = c.get('user');

        console.log('Create donation - Request body:', body);
        console.log('Create donation - User from token:', user);

        const { campaignId, amount, message, paymentMethod, isAnonymous, uniqueCode } = body;
        const userId = user.userId;

        // Validasi input
        if (!campaignId || !amount || !paymentMethod) {
            return c.json({ error: "Campaign ID, amount, dan payment method wajib diisi" }, 400);
        }

        if (amount < 1000) {
            return c.json({ error: "Minimal donasi Rp 1.000" }, 400);
        }

        const campIdInt = parseInt(campaignId);

        // Check if campaign exists and still active
        const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campIdInt));

        if (!campaign) {
            return c.json({ error: "Campaign tidak ditemukan" }, 404);
        }

        if (new Date() > new Date(campaign.endDate)) {
            return c.json({ error: "Campaign sudah berakhir" }, 400);
        }

        // Get user info (optional validation, mostly handled by auth middleware but good for name)
        const [userInfo] = await db.select().from(users).where(eq(users.id, userId));
        if (!userInfo) {
            return c.json({ error: "User tidak ditemukan" }, 404);
        }

        // Create transactionId (simple unique string)
        const transactionId = `TRX-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        // Create donation with pending status
        const [donation] = await db.insert(donations).values({
            campaignId: campIdInt,
            userId,
            amount,
            message,
            paymentMethod,
            donorName: isAnonymous ? "Hamba Allah" : userInfo.nama,
            isAnonymous: !!isAnonymous,
            paymentStatus: "pending",
            uniqueCode: uniqueCode || null,
            transactionId
        }).returning();

        return c.json({
            message: "Donasi telah dikirim dan menunggu approval dari admin",
            donation: {
                _id: donation.id, // Keep _id for frontend compatibility if needed, or stick to id
                id: donation.id,
                transactionId: donation.transactionId,
                amount: donation.amount,
                paymentStatus: donation.paymentStatus,
                paymentMethod: donation.paymentMethod,
                uniqueCode: donation.uniqueCode,
            },
        }, 201);
    } catch (err) {
        console.error("Error creating donation:", err);
        return c.json({ error: "Server error: " + err.message }, 500);
    }
};

// Update donation with proof of transfer
export const updateDonationProof = async (c) => {
    try {
        const db = c.get('db');
        const donationId = parseInt(c.req.param('donationId'));
        if (isNaN(donationId)) return c.json({ error: 'Invalid Donation ID' }, 400);

        const { proofOfTransfer } = await c.req.json();

        if (!proofOfTransfer) {
            return c.json({ error: "Bukti transfer wajib diisi" }, 400);
        }

        const [donation] = await db.select().from(donations).where(eq(donations.id, donationId));
        if (!donation) {
            return c.json({ error: "Donasi tidak ditemukan" }, 404);
        }

        // Check ownership
        const user = c.get('user');
        if (donation.userId !== user.userId) {
            return c.json({ error: "Akses ditolak" }, 403);
        }

        const [updatedDonation] = await db.update(donations)
            .set({ proofOfTransfer })
            .where(eq(donations.id, donationId))
            .returning();

        return c.json({ message: "Bukti transfer berhasil diunggah", donation: updatedDonation });
    } catch (err) {
        console.error("Error updating proof of transfer:", err);
        return c.json({ error: "Server error" }, 500);
    }
};

// Get donations by campaign
export const getDonationsByCampaign = async (c) => {
    try {
        const db = c.get('db');
        const campaignId = parseInt(c.req.param('campaignId'));
        if (isNaN(campaignId)) return c.json({ error: 'Invalid Campaign ID' }, 400);

        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '10');
        const offset = (page - 1) * limit;

        const whereClause = and(
            eq(donations.campaignId, campaignId),
            eq(donations.paymentStatus, 'completed')
        );

        const [totalResult] = await db.select({ count: count() })
            .from(donations)
            .where(whereClause);

        const total = totalResult.count;

        const rows = await db.select({
            donations: donations,
            users: {
                nama: users.nama
            }
        })
            .from(donations)
            .leftJoin(users, eq(donations.userId, users.id))
            .where(whereClause)
            .orderBy(desc(donations.completedAt))
            .limit(limit)
            .offset(offset);

        return c.json({
            donations: rows.map(r => ({
                _id: r.donations.id,
                amount: r.donations.amount,
                message: r.donations.message,
                donorName: r.donations.donorName,
                isAnonymous: r.donations.isAnonymous,
                completedAt: r.donations.completedAt,
            })),
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total,
        });
    } catch (err) {
        console.error("Error getting donations:", err);
        return c.json({ error: "Server error" }, 500);
    }
};

// Get user's donations
export const getUserDonations = async (c) => {
    try {
        const db = c.get('db');
        const user = c.get('user');
        const userId = user.userId;
        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '10');
        const offset = (page - 1) * limit;

        const whereClause = eq(donations.userId, userId);

        const [totalResult] = await db.select({ count: count() })
            .from(donations)
            .where(whereClause);
        const total = totalResult.count;

        const rows = await db.select({
            donations: donations,
            campaigns: {
                title: campaigns.title,
                imageUrl: campaigns.imageUrl
            }
        })
            .from(donations)
            .leftJoin(campaigns, eq(donations.campaignId, campaigns.id))
            .where(whereClause)
            .orderBy(desc(donations.createdAt))
            .limit(limit)
            .offset(offset);

        const formattedDonations = rows.map(r => ({
            ...r.donations,
            campaignId: r.campaigns // Maintain structure where campaignId is the populated object
        }));

        return c.json({
            donations: formattedDonations,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total,
        });
    } catch (err) {
        console.error("Error getting user donations:", err);
        return c.json({ error: "Server error" }, 500);
    }
};

// Update payment status (for payment gateway webhook)
export const updatePaymentStatus = async (c) => {
    try {
        const db = c.get('db');
        const { transactionId, status } = await c.req.json();

        const [donation] = await db.select().from(donations).where(eq(donations.transactionId, transactionId));
        if (!donation) {
            return c.json({ error: "Donasi tidak ditemukan" }, 404);
        }

        const oldStatus = donation.paymentStatus;

        const updateData = { paymentStatus: status };
        if (status === 'completed' && oldStatus !== 'completed') {
            updateData.completedAt = new Date();
        }

        await db.update(donations)
            .set(updateData)
            .where(eq(donations.id, donation.id));

        // Recalculate stats if status changed to/from completed
        if (
            (status === 'completed' && oldStatus !== 'completed') ||
            (status !== 'completed' && oldStatus === 'completed')
        ) {
            await updateCampaignStats(db, donation.campaignId);
        }

        return c.json({ message: "Status pembayaran berhasil diupdate" });
    } catch (err) {
        console.error("Error updating payment status:", err);
        return c.json({ error: "Server error" }, 500);
    }
};

export const getDonationByTransactionId = async (c) => {
    try {
        const db = c.get('db');
        const transactionId = c.req.param('transactionId');

        const [row] = await db.select({
            donations: donations,
            campaigns: { title: campaigns.title },
            users: { nama: users.nama, email: users.email }
        })
            .from(donations)
            .leftJoin(campaigns, eq(donations.campaignId, campaigns.id))
            .leftJoin(users, eq(donations.userId, users.id))
            .where(eq(donations.transactionId, transactionId));

        if (!row) {
            return c.json({ error: "Donasi tidak ditemukan" }, 404);
        }

        const donation = {
            ...row.donations,
            campaignId: row.campaigns,
            userId: row.users ? { ...row.users, _id: row.donations.userId } : null
        };

        const user = c.get('user');
        // Jika hanya pemilik atau admin yang boleh akses
        if (
            donation.userId && // check if exists
            donation.userId._id !== user.userId &&
            user.role !== "admin"
        ) {
            return c.json({ error: "Akses ditolak" }, 403);
        }

        return c.json(donation);
    } catch (err) {
        console.error("Error getting donation:", err);
        return c.json({ error: "Server error" }, 500);
    }
};

// get all donations (Admin)
export const getAllDonations = async (c) => {
    try {
        const db = c.get('db');
        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '10');
        const status = c.req.query('status');
        const paymentMethod = c.req.query('paymentMethod');
        const offset = (page - 1) * limit;

        const filters = [];
        if (status) filters.push(eq(donations.paymentStatus, status));
        if (paymentMethod) filters.push(eq(donations.paymentMethod, paymentMethod));

        const whereClause = filters.length > 0 ? and(...filters) : undefined;

        const [totalResult] = await db.select({ count: count() }).from(donations).where(whereClause);
        const total = totalResult.count;

        const rows = await db.select({
            donations: donations,
            campaigns: {
                title: campaigns.title,
                imageUrl: campaigns.imageUrl
            },
            users: {
                nama: users.nama,
                email: users.email
            }
        })
            .from(donations)
            .leftJoin(campaigns, eq(donations.campaignId, campaigns.id))
            .leftJoin(users, eq(donations.userId, users.id))
            .where(whereClause)
            .orderBy(desc(donations.createdAt))
            .limit(limit)
            .offset(offset);

        // Filter valid donations (join might return null campaign if deleted, though foreign key might restrict it)
        const validDonations = rows
            .filter(r => r.campaigns !== null)
            .map(r => ({
                ...r.donations,
                campaignId: r.campaigns,
                userId: r.users
            }));

        return c.json({
            donations: validDonations,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total,
        });
    } catch (err) {
        console.error("Error getting all donations:", err);
        return c.json({ error: "Server error" }, 500);
    }
};

// Update donation status (admin only)
export const updateDonationStatus = async (c) => {
    try {
        const db = c.get('db');
        const user = c.get('user');
        if (user.role !== "admin") {
            return c.json({ message: "Access denied. Admin only." }, 403);
        }

        const id = parseInt(c.req.param('id'));
        if (isNaN(id)) return c.json({ message: "Invalid ID" }, 400);

        const { paymentStatus } = await c.req.json();

        if (!["completed", "failed", "pending"].includes(paymentStatus)) {
            return c.json({ message: "Invalid payment status" }, 400);
        }

        const [donation] = await db.select().from(donations).where(eq(donations.id, id));
        if (!donation) {
            return c.json({ message: "Donation not found" }, 404);
        }

        const oldStatus = donation.paymentStatus;

        const updateData = { paymentStatus };
        if (paymentStatus === "completed") {
            updateData.completedAt = new Date();
        }

        const [updatedDonation] = await db.update(donations)
            .set(updateData)
            .where(eq(donations.id, id))
            .returning();

        let updatedStats = null;
        if (
            (paymentStatus === 'completed' && oldStatus !== 'completed') ||
            (paymentStatus !== 'completed' && oldStatus === 'completed')
        ) {
            updatedStats = await updateCampaignStats(db, donation.campaignId);
        }

        return c.json({
            message: "Donation status updated successfully",
            donation: updatedDonation,
            updatedCampaign: updatedStats
        });
    } catch (error) {
        console.error("Error updating donation status:", error);
        return c.json({ message: "Server error" }, 500);
    }
};

// Delete donation (admin only)
export const deleteDonation = async (c) => {
    try {
        const db = c.get('db');
        const user = c.get('user');
        if (user.role !== 'admin') {
            return c.json({ error: 'Unauthorized access' }, 403);
        }

        const id = parseInt(c.req.param('id'));
        if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

        const [donation] = await db.select().from(donations).where(eq(donations.id, id));
        if (!donation) {
            return c.json({ error: 'Donasi tidak ditemukan' }, 404);
        }

        await db.delete(donations).where(eq(donations.id, id));

        let updatedStats = null;
        // If donation was completed, update stats
        if (donation.paymentStatus === 'completed') {
            updatedStats = await updateCampaignStats(db, donation.campaignId);
        }

        return c.json({
            message: 'Donasi berhasil dihapus',
            updatedCampaign: updatedStats
        });
    } catch (err) {
        console.error('Error deleting donation:', err);
        return c.json({ error: 'Server error' }, 500);
    }
};

// Create donation by admin
export const createDonationByAdmin = async (c) => {
    try {
        const db = c.get('db');
        const user = c.get('user');
        if (user.role !== 'admin') {
            return c.json({ error: 'Akses ditolak. Hanya admin yang dapat mengakses fitur ini.' }, 403);
        }

        const body = await c.req.json();
        const {
            campaignId,
            amount,
            message,
            paymentMethod,
            donorName,
            isAnonymous,
            paymentStatus = 'pending'
        } = body;

        // Validasi input
        if (!campaignId || !amount || !paymentMethod || !donorName) {
            return c.json({
                error: "Campaign ID, jumlah donasi, metode pembayaran, dan nama donatur wajib diisi"
            }, 400);
        }

        if (amount < 1000) {
            return c.json({ error: "Minimal donasi Rp 1.000" }, 400);
        }

        const campIdInt = parseInt(campaignId);

        const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campIdInt));
        if (!campaign) {
            return c.json({ error: "Campaign tidak ditemukan" }, 404);
        }

        if (new Date() > new Date(campaign.endDate)) {
            return c.json({ error: "Campaign sudah berakhir" }, 400);
        }

        const transactionId = `TRX-ADMIN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        const [donation] = await db.insert(donations).values({
            campaignId: campIdInt,
            userId: user.userId,
            amount,
            message,
            paymentMethod,
            donorName: isAnonymous ? "Hamba Allah" : donorName,
            isAnonymous: !!isAnonymous,
            paymentStatus,
            completedAt: paymentStatus === 'completed' ? new Date() : undefined,
            transactionId
        }).returning();

        if (paymentStatus === 'completed') {
            await updateCampaignStats(db, campIdInt);
        }

        return c.json({
            message: "Donasi berhasil dibuat",
            donation: {
                _id: donation.id,
                transactionId: donation.transactionId,
                amount: donation.amount,
                paymentStatus: donation.paymentStatus,
                paymentMethod: donation.paymentMethod,
                donorName: donation.donorName,
                isAnonymous: donation.isAnonymous,
                message: donation.message,
                campaignId: donation.campaignId
            },
        }, 201);
    } catch (err) {
        console.error("Error creating donation by admin:", err);
        return c.json({ error: "Server error" }, 500);
    }
};
