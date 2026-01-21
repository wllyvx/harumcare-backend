import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { connectDB } from './db/connect.js';

const app = new Hono();

// Global Middleware
app.use('/*', cors());

// Database Connection Middleware
app.use('*', async (c, next) => {
    if (!c.env.MONGODB_URI) {
        return c.json({ error: 'Server misconfiguration: MONGODB_URI missing' }, 500);
    }
    try {
        await connectDB(c.env.MONGODB_URI);
    } catch (err) {
        return c.json({ error: 'Database connection failed' }, 500);
    }
    await next();
});

// Health Check
app.get('/', (c) => c.json({ message: 'HarumCare Backend (Hono) is running' }));
app.get('/health', (c) => c.json({ status: 'OK', timestamp: new Date().toISOString() }));

// Routes
import authRoutes from './routes/auth.js';
import uploadRoutes from './routes/upload.js';
import campaignRoutes from './routes/campaigns.js';
import donationRoutes from './routes/donations.js';
import userRoutes from './routes/users.js';
import newsRoutes from './routes/news.js';
import blogRoutes from './routes/blog.js';

app.route('/api/auth', authRoutes);
app.route('/api/upload', uploadRoutes);
app.route('/api/campaigns', campaignRoutes);
app.route('/api/donations', donationRoutes);
app.route('/api/users', userRoutes);
app.route('/api/news', newsRoutes);
app.route('/api/blog', blogRoutes);

export default app;
