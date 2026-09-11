import { eq, desc, and, count } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import { donations, campaigns, users } from '../db/schema.js';
import { removeMediaBestEffort, createMedia } from '../modules/media/index.js';
import { createDonationModule } from '../modules/donation/index.js';

const removeMedia = (c, url) => removeMediaBestEffort(c.env?.BUCKET, url);

// Thin adapter over the deep Donation module (C02): all status transitions
// and Campaign-stats writes live inside the module. This file only maps
// HTTP ↔ module and module errors ↔ HTTP codes. The completed-transition
// guard exists exactly once (inside the module) — no call-site copies.
const getDonationModule = (c) => createDonationModule({ db: c.get('db'), media: createMedia({ bucket: c.env?.BUCKET }) });

const toHttpStatus = (err) => err?.statusCode || 500;

// Webhook shared-secret check (C02-T6): the payment gateway proves itself
// with `x-webhook-secret: <PAYMENT_WEBHOOK_SECRET>`. Compared timing-safe;
// a missing server secret fails CLOSED (503) so the endpoint can never
// drift back into a public unauthenticated writer.
const WEBHOOK_SECRET_HEADER = 'x-webhook-secret';

const webhookSecretsEqual = (provided, expected) => {
    if (typeof provided !== 'string' || typeof expected !== 'string') return false;
    if (provided.length === 0 || expected.length === 0) return false;
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    // Length check first is the standard timingSafeEqual idiom (secrets are
    // fixed-length high-entropy values, so length reveals nothing useful).
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
};

const sendModuleError = (c, err, key = 'error') => {
    const status = toHttpStatus(err);
    if (status === 500) {
        console.error('Donation module error:', err);
        return c.json({ [key]: 'Server error' }, 500);
    }
    return c.json({ [key]: err.message }, status);
};

// Create donation (thin adapter → module `create`; starts `pending`, totals untouched)
export const createDonation = async (c) => {
    try {
        const body = await c.req.json();
        const user = c.get('user');

        console.log('Create donation - Request body:', body);
        console.log('Create donation - User from token:', user);

        // NOTE: `uniqueCode` intentionally dropped — no such column in schema.
        const { campaignId, amount, message, paymentMethod, donorName, isAnonymous } = body;

        const donation = await getDonationModule(c).create(
            { campaignId, amount, message, paymentMethod, donorName, isAnonymous },
            user
        );

        return c.json({
            message: "Donasi telah dikirim dan menunggu approval dari admin",
            donation: {
                _id: donation.id, // Keep _id for frontend compatibility if needed, or stick to id
                id: donation.id,
                transactionId: donation.transactionId,
                amount: donation.amount,
                paymentStatus: donation.paymentStatus,
                paymentMethod: donation.paymentMethod,
            },
        }, 201);
    } catch (err) {
        if (err?.statusCode) return sendModuleError(c, err, 'error');
        console.error("Error creating donation:", err);
        return c.json({ error: "Server error: " + err.message }, 500);
    }
};

// Update donation with proof of transfer (thin adapter → module `updateProof`
// owns ownership check, DB write, and best-effort old-media removal)
export const updateDonationProof = async (c) => {
    try {
        const donationId = c.req.param('donationId');

        const { proofOfTransfer } = await c.req.json();

        const user = c.get('user');

        let updatedDonation;
        try {
            updatedDonation = await getDonationModule(c).updateProof(donationId, proofOfTransfer, user);
        } catch (err) {
            if (err?.statusCode) return sendModuleError(c, err, 'error');
            throw err;
        }

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
        const campaignId = c.req.param('campaignId');

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

// Update payment status (payment gateway webhook; shared-secret locked.
// Thin adapter → module `setStatus`; auth checked before body validation
// so unauthenticated callers learn nothing about payload shape.)
export const updatePaymentStatus = async (c) => {
    try {
        const configured = c.env?.PAYMENT_WEBHOOK_SECRET;
        if (!configured) {
            return c.json({ error: 'Webhook not configured' }, 503);
        }
        if (!webhookSecretsEqual(c.req.header(WEBHOOK_SECRET_HEADER), configured)) {
            return c.json({ error: 'Invalid webhook secret' }, 401);
        }

        const { transactionId, status } = await c.req.json();

        if (!transactionId || !status) {
            return c.json({ error: "Transaction ID dan status wajib diisi" }, 400);
        }

        const detail = await getDonationModule(c).getByTransactionId(transactionId);
        if (!detail) {
            return c.json({ error: "Donasi tidak ditemukan" }, 404);
        }

        try {
            await getDonationModule(c).setStatus(detail.donation.id, status);
        } catch (err) {
            if (err?.statusCode) return sendModuleError(c, err, 'error');
            throw err;
        }

        return c.json({ message: "Status pembayaran berhasil diupdate" });
    } catch (err) {
        console.error("Error updating payment status:", err);
        return c.json({ error: "Server error" }, 500);
    }
};

export const getDonationByTransactionId = async (c) => {
    try {
        const transactionId = c.req.param('transactionId');

        // Joined lookup lives in the module (memory + drizzle); the adapter
        // only maps module data ↔ HTTP and enforces owner-or-admin.
        const detail = await getDonationModule(c).getByTransactionId(transactionId);
        if (!detail) {
            return c.json({ error: "Donasi tidak ditemukan" }, 404);
        }

        const user = c.get('user');
        // Owner-or-admin only, compared on the raw FK (not the shaped object).
        if (
            !user ||
            (String(detail.donation.userId) !== String(user.userId) && user.role !== "admin")
        ) {
            return c.json({ error: "Akses ditolak" }, 403);
        }

        return c.json({
            ...detail.donation,
            campaignId: detail.campaign,
            userId: detail.donor ? { ...detail.donor, _id: detail.donation.userId } : null,
        });
    } catch (err) {
        console.error("Error getting donation:", err);
        return c.json({ error: "Server error" }, 500);
    }
};

// get all donations (Admin only; non-admins are forbidden, not just unauthenticated)
export const getAllDonations = async (c) => {
    try {
        const db = c.get('db');
        const user = c.get('user');
        if (!user || user.role !== "admin") {
            return c.json({ message: "Access denied. Admin only." }, 403);
        }
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

// Update donation status (admin only; thin adapter → module `setStatus`)
export const updateDonationStatus = async (c) => {
    try {
        const db = c.get('db');
        const user = c.get('user');
        if (user.role !== "admin") {
            return c.json({ message: "Access denied. Admin only." }, 403);
        }

        const id = c.req.param('id');

        const { paymentStatus } = await c.req.json();

        let updatedDonation;
        try {
            updatedDonation = await getDonationModule(c).setStatus(id, paymentStatus);
        } catch (err) {
            if (err?.statusCode) {
                if (err.statusCode === 404) {
                    return c.json({ message: "Donation not found" }, 404);
                }
                return sendModuleError(c, err, 'message');
            }
            throw err;
        }

        const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, updatedDonation.campaignId));
        const updatedStats = campaign
            ? { currentAmount: campaign.currentAmount, donorCount: campaign.donorCount }
            : null;

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

// Delete donation (admin only; thin adapter → module `remove` owns delete + recalc)
export const deleteDonation = async (c) => {
    try {
        const db = c.get('db');
        const user = c.get('user');
        if (user.role !== 'admin') {
            return c.json({ error: 'Unauthorized access' }, 403);
        }

        const id = c.req.param('id');

        const [existing] = await db.select().from(donations).where(eq(donations.id, id));
        if (!existing) {
            return c.json({ error: 'Donasi tidak ditemukan' }, 404);
        }

        let removed;
        try {
            removed = await getDonationModule(c).remove(id);
        } catch (err) {
            if (err?.statusCode) return sendModuleError(c, err, 'error');
            throw err;
        }

        if (removed.proofOfTransfer) {
            await removeMedia(c, removed.proofOfTransfer);
        }

        let updatedStats = null;
        const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, removed.campaignId));
        if (campaign) {
            updatedStats = { currentAmount: campaign.currentAmount, donorCount: campaign.donorCount };
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

// Create donation by admin (thin adapter → module `create` with unified validation)
export const createDonationByAdmin = async (c) => {
    try {
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

        let donation;
        try {
            donation = await getDonationModule(c).create(
                { campaignId, amount, message, paymentMethod, donorName, isAnonymous, paymentStatus },
                user
            );
        } catch (err) {
            if (err?.statusCode) return sendModuleError(c, err, 'error');
            throw err;
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
