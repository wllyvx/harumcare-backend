import Donation from "../models/Donations.js";
import Campaign from "../models/Campaign.js";
import User from "../models/Users.js";

// Create donation
export const createDonation = async (c) => {
    try {
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

        // Check if campaign exists and still active
        const campaign = await Campaign.findById(campaignId);
        if (!campaign) {
            return c.json({ error: "Campaign tidak ditemukan" }, 404);
        }

        if (new Date() > campaign.endDate) {
            return c.json({ error: "Campaign sudah berakhir" }, 400);
        }

        // Get user info
        const userInfo = await User.findById(userId);
        if (!userInfo) {
            return c.json({ error: "User tidak ditemukan" }, 404);
        }

        // Create donation with pending status
        const donation = new Donation({
            campaignId,
            userId,
            amount,
            message,
            paymentMethod,
            donorName: isAnonymous ? "Hamba Allah" : userInfo.nama,
            isAnonymous,
            paymentStatus: "pending",
            uniqueCode, // Simpan kode unik jika ada
        });

        await donation.save();

        return c.json({
            message: "Donasi telah dikirim dan menunggu approval dari admin",
            donation: {
                _id: donation._id,
                transactionId: donation.transactionId,
                amount: donation.amount,
                paymentStatus: donation.paymentStatus,
                paymentMethod: donation.paymentMethod,
                uniqueCode: donation.uniqueCode,
            },
        }, 201);
    } catch (err) {
        console.error("Error creating donation:", err);
        return c.json({ error: "Server error" }, 500);
    }
};

// Update donation with proof of transfer
export const updateDonationProof = async (c) => {
    try {
        const donationId = c.req.param('donationId');
        const { proofOfTransfer } = await c.req.json();

        if (!proofOfTransfer) {
            return c.json({ error: "Bukti transfer wajib diisi" }, 400);
        }

        const donation = await Donation.findById(donationId);
        if (!donation) {
            return c.json({ error: "Donasi tidak ditemukan" }, 404);
        }

        // Pastikan hanya pengguna yang membuat donasi yang dapat mengunggah bukti
        // Convert ObjectId to string for comparison
        const user = c.get('user');
        if (donation.userId.toString() !== user.userId) {
            return c.json({ error: "Akses ditolak" }, 403);
        }

        donation.proofOfTransfer = proofOfTransfer;
        await donation.save();

        return c.json({ message: "Bukti transfer berhasil diunggah", donation });
    } catch (err) {
        console.error("Error updating proof of transfer:", err);
        return c.json({ error: "Server error" }, 500);
    }
};

// Get donations by campaign
export const getDonationsByCampaign = async (c) => {
    try {
        const campaignId = c.req.param('campaignId');
        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '10');

        const donations = await Donation.find({
            campaignId,
            paymentStatus: "completed",
        })
            .populate("userId", "nama")
            .sort({ completedAt: -1 })
            .limit(limit)
            .skip((page - 1) * limit);

        const total = await Donation.countDocuments({
            campaignId,
            paymentStatus: "completed",
        });

        return c.json({
            donations: donations.map((donation) => ({
                _id: donation._id,
                amount: donation.amount,
                message: donation.message,
                donorName: donation.donorName,
                isAnonymous: donation.isAnonymous,
                completedAt: donation.completedAt,
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
        const user = c.get('user');
        const userId = user.userId;
        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '10');

        const donations = await Donation.find({ userId })
            .populate("campaignId", "title imageUrl")
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip((page - 1) * limit);

        const total = await Donation.countDocuments({ userId });

        return c.json({
            donations,
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
        const { transactionId, status } = await c.req.json();

        const donation = await Donation.findOne({ transactionId });
        if (!donation) {
            return c.json({ error: "Donasi tidak ditemukan" }, 404);
        }

        const oldStatus = donation.paymentStatus;
        donation.paymentStatus = status;

        await donation.save();

        return c.json({ message: "Status pembayaran berhasil diupdate" });
    } catch (err) {
        console.error("Error updating payment status:", err);
        return c.json({ error: "Server error" }, 500);
    }
};

export const getDonationByTransactionId = async (c) => {
    try {
        const transactionId = c.req.param('transactionId');
        const donation = await Donation.findOne({ transactionId })
            .populate("campaignId", "title")
            .populate("userId", "nama email");

        if (!donation) {
            return c.json({ error: "Donasi tidak ditemukan" }, 404);
        }

        const user = c.get('user');
        // Jika hanya pemilik atau admin yang boleh akses
        if (
            donation.userId._id.toString() !== user.userId &&
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

//get all donations
export const getAllDonations = async (c) => {
    try {
        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '10');
        const status = c.req.query('status');
        const paymentMethod = c.req.query('paymentMethod');

        let filter = {};
        if (status) filter.paymentStatus = status;
        if (paymentMethod) filter.paymentMethod = paymentMethod;

        const donations = await Donation.find(filter)
            .populate("campaignId", "title imageUrl")
            .populate("userId", "nama email")
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip((page - 1) * limit);

        // Filter out donations with null campaignId to prevent frontend errors
        const validDonations = donations.filter(donation => donation.campaignId !== null);

        if (validDonations.length !== donations.length) {
            console.warn(`Filtered out ${donations.length - validDonations.length} donations with null campaignId`);
        }

        const total = await Donation.countDocuments(filter);

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
        const user = c.get('user');
        if (user.role !== "admin") {
            return c.json({ message: "Access denied. Admin only." }, 403);
        }

        const id = c.req.param('id');
        const { paymentStatus } = await c.req.json();

        if (!["completed", "failed", "pending"].includes(paymentStatus)) {
            return c.json({ message: "Invalid payment status" }, 400);
        }

        const donation = await Donation.findById(id);
        if (!donation) {
            return c.json({ message: "Donation not found" }, 404);
        }

        const oldStatus = donation.paymentStatus;
        donation.paymentStatus = paymentStatus;
        if (paymentStatus === "completed") {
            donation.completedAt = new Date();
        }

        await donation.save();

        // Hitung ulang total currentAmount berdasarkan semua donasi completed
        const completedDonations = await Donation.find({
            campaignId: donation.campaignId,
            paymentStatus: 'completed'
        });

        const totalAmount = completedDonations.reduce((sum, d) => sum + d.amount, 0);
        const totalDonors = completedDonations.length;

        // Update campaign dengan nilai yang benar
        await Campaign.findByIdAndUpdate(donation.campaignId, {
            currentAmount: totalAmount,
            donorCount: totalDonors
        });

        console.log("Campaign updated with recalculated values:", {
            campaignId: donation.campaignId,
            totalAmount,
            totalDonors
        });

        return c.json({
            message: "Donation status updated successfully",
            donation,
            updatedCampaign: {
                currentAmount: totalAmount,
                donorCount: totalDonors
            }
        });
    } catch (error) {
        console.error("Error updating donation status:", error);
        return c.json({ message: "Server error" }, 500);
    }
};

// Delete donation (admin only)
export const deleteDonation = async (c) => {
    try {
        const user = c.get('user');
        // Check if user is admin
        if (user.role !== 'admin') {
            return c.json({ error: 'Unauthorized access' }, 403);
        }

        const id = c.req.param('id');
        const donation = await Donation.findById(id);

        if (!donation) {
            return c.json({ error: 'Donasi tidak ditemukan' }, 404);
        }

        // Jika donasi yang dihapus berstatus completed, kurangi currentAmount dan donorCount pada campaign
        if (donation.paymentStatus === 'completed') {
            console.log("Updating Campaign - Decrementing currentAmount and donorCount:", {
                campaignId: donation.campaignId,
                amount: donation.amount,
            });
            await Campaign.findByIdAndUpdate(donation.campaignId, {
                $inc: { currentAmount: -donation.amount, donorCount: -1 },
            });
        }

        await Donation.findByIdAndDelete(id);

        // Hitung ulang total currentAmount berdasarkan semua donasi completed
        const completedDonations = await Donation.find({
            campaignId: donation.campaignId,
            paymentStatus: 'completed'
        });

        const totalAmount = completedDonations.reduce((sum, d) => sum + d.amount, 0);
        const totalDonors = completedDonations.length;

        // Update campaign dengan nilai yang benar
        await Campaign.findByIdAndUpdate(donation.campaignId, {
            currentAmount: totalAmount,
            donorCount: totalDonors
        });

        console.log("Campaign updated with recalculated values:", {
            campaignId: donation.campaignId,
            totalAmount,
            totalDonors
        });

        return c.json({
            message: 'Donasi berhasil dihapus',
            updatedCampaign: {
                currentAmount: totalAmount,
                donorCount: totalDonors
            }
        });
    } catch (err) {
        console.error('Error deleting donation:', err);
        return c.json({ error: 'Server error' }, 500);
    }
};

// Create donation by admin
export const createDonationByAdmin = async (c) => {
    try {
        const user = c.get('user');
        // Verify admin role
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
            paymentStatus = 'pending' // Default ke pending, tapi admin bisa set langsung ke completed
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

        // Check if campaign exists and still active
        const campaign = await Campaign.findById(campaignId);
        if (!campaign) {
            return c.json({ error: "Campaign tidak ditemukan" }, 404);
        }

        if (new Date() > campaign.endDate) {
            return c.json({ error: "Campaign sudah berakhir" }, 400);
        }

        // Create donation
        const donation = new Donation({
            campaignId,
            userId: user.userId, // Use admin's ID as creator
            amount,
            message,
            paymentMethod,
            donorName: isAnonymous ? "Hamba Allah" : donorName,
            isAnonymous,
            paymentStatus,
            completedAt: paymentStatus === 'completed' ? new Date() : undefined
        });

        await donation.save();

        return c.json({
            message: "Donasi berhasil dibuat",
            donation: {
                _id: donation._id,
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
