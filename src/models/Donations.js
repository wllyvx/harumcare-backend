import mongoose from 'mongoose';

const donationSchema = new mongoose.Schema({
    campaignId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Campaign',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: [1000, 'Minimal donasi Rp 1.000']
    },
    message: {
        type: String,
        maxlength: 500
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'completed', 'failed'],
        default: 'pending'
    },
    paymentMethod: {
        type: String,
        enum: ['bank_transfer', 'e_wallet', 'credit_card'],
        required: true
    },
    transactionId: {
        type: String,
        unique: true,
        sparse: true // Allow null values but ensure uniqueness when present
    },
    donorName: {
        type: String,
        required: true
    },
    isAnonymous: {
        type: Boolean,
        default: false
    },
    proofOfTransfer: {
        type: String,
        default: ''
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    completedAt: {
        type: Date
    }
});

// Generate unique transaction ID
donationSchema.pre('save', function (next) {
    if (!this.transactionId) {
        this.transactionId = 'TXN' + Date.now() + Math.random().toString(36).substr(2, 9).toUpperCase();
    }
    next();
});

// Update completedAt when payment is completed
donationSchema.pre('save', function (next) {
    if (this.isModified('paymentStatus') && this.paymentStatus === 'completed' && !this.completedAt) {
        this.completedAt = new Date();
    }
    next();
});

donationSchema.pre('save', async function (next) {
    if (this.isModified('paymentStatus')) {

        const Campaign = mongoose.model("Campaign");
        const oldStatus = this.paymentStatus || "pending";
        const newStatus = this.get("paymentStatus");

        if (newStatus === "completed" && oldStatus !== "completed") {
            console.log("Updating Campaign - Incrementing currentAmount and donorCount:", {
                campaignId: this.campaignId,
                amount: this.amount,
            });
            await Campaign.findByIdAndUpdate(this.campaignId, {
                $inc: { currentAmount: this.amount, donorCount: 1 },
            });
        } else if (oldStatus === "completed" && newStatus === "failed") {
            console.log("Updating Campaign - Decrementing currentAmount and donorCount:", {
                campaignId: this.campaignId,
                amount: this.amount,
            });
            await Campaign.findByIdAndUpdate(this.campaignId, {
                $inc: { currentAmount: -this.amount, donorCount: -1 },
            });
        }
    }
    next();
});

export default mongoose.model('Donation', donationSchema);
