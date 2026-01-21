import mongoose from 'mongoose';

let isConnected = false;

export const connectDB = async (uri) => {
    if (isConnected) {
        console.log('Using existing database connection');
        return;
    }

    if (!uri) {
        throw new Error('MONGODB_URI is not defined');
    }

    try {
        const db = await mongoose.connect(uri, {
            // Buffer commands should be false for serverless to avoid hanging
            bufferCommands: false,
        });

        isConnected = db.connections[0].readyState;
        console.log('MongoDB Connected');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        throw error;
    }
};
