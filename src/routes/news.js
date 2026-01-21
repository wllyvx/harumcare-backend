import { Hono } from 'hono';
import * as newsController from '../controllers/newsController.js';
import { authenticateToken } from '../middleware/auth.js';

const news = new Hono();

// Public routes
news.get('/', newsController.getAllNews);
news.get('/latest', newsController.getLatestNews);
news.get('/categories', newsController.getCategories);
news.get('/campaign/:campaignId', newsController.getNewsByCampaign);
news.get('/:slug', newsController.getNewsBySlug);

// Protected routes (require authentication)
news.post('/', authenticateToken, newsController.createNews);
news.put('/:id', authenticateToken, newsController.updateNews);
news.delete('/:id', authenticateToken, newsController.deleteNews);

export default news;
