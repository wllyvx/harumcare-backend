import mongoose from 'mongoose';

const campaignSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String },
    imageUrl: { type: String },
    targetAmount: { type: Number, required: true },
    currentAmount: { type: Number, default: 0 },
    startDate: { type: Date },
    endDate: { type: Date, required: true },
    donorCount: { type: Number, default: 0 },
    organizationName: { type: String },
    organizationLogo: { type: String },
    category: { type: String },
    relatedNews: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'News'
    }],
    createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('Campaign', campaignSchema);
