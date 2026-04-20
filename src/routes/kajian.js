import { Hono } from 'hono';
import * as kajianController from '../controllers/kajianController.js';
import { authenticateToken } from '../middleware/auth.js';

const kajian = new Hono();

// Public routes
kajian.get('/', kajianController.getAllKajians);
kajian.get('/latest', kajianController.getLatestKajians);
kajian.get('/categories', kajianController.getKajianCategories);
kajian.get('/fetch-youtube', kajianController.fetchYouTubeData);
kajian.get('/:slug', kajianController.getKajianBySlug);

// Protected routes (require authentication)
kajian.post('/', authenticateToken, kajianController.createKajian);
kajian.put('/:id', authenticateToken, kajianController.updateKajian);
kajian.delete('/:id', authenticateToken, kajianController.deleteKajian);

export default kajian;