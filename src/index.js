import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { connectDB } from './db/connect.js';

const app = new Hono();

// Global Middleware - CORS must use '*' to apply to all routes including sub-routes
app.use('*', cors({
    origin: (origin) => origin || '*', // Allow all origins by reflecting them
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Custom-Header'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
    credentials: true,
}));



// Database Connection Middleware - non-blocking
app.use('*', async (c, next) => {
    // Skip database connection for health check routes
    if (c.req.path === '/' || c.req.path === '/health') {
        return await next();
    }

    if (!c.env.MONGODB_URI) {
        return c.json({ error: 'Server misconfiguration: MONGODB_URI missing' }, 500);
    }

    // Try to connect to database, but don't block the request
    connectDB(c.env.MONGODB_URI).catch(err => {
        console.error('Database connection error:', err.message);
    });

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
