import { Hono } from 'hono';
import * as blogController from '../controllers/blogController.js';
import { authenticateToken } from '../middleware/auth.js';

const blog = new Hono();

// Public routes
blog.get('/', blogController.getAllBlogs);
blog.get('/latest', blogController.getLatestBlogs);
blog.get('/categories', blogController.getCategories);
blog.get('/campaign/:campaignId', blogController.getBlogsByCampaign);
blog.get('/:slug', blogController.getBlogBySlug);

// Protected routes (require authentication)
blog.post('/', authenticateToken, blogController.createBlog);
blog.put('/:id', authenticateToken, blogController.updateBlog);
blog.delete('/:id', authenticateToken, blogController.deleteBlog);

export default blog;
