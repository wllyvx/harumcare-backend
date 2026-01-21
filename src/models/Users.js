import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    nama: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    nomorHp: { type: String, required: true },
    alamat: { type: String },
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Update updatedAt before saving
userSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

export default mongoose.model('User', userSchema);
