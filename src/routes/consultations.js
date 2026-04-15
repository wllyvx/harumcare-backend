import { Hono } from 'hono';
import * as consultationController from '../controllers/consultationController.js';
import { authenticateToken, restrictToAdmin } from '../middleware/auth.js';

const consultation = new Hono();

// Public routes
consultation.get('/', consultationController.getAllConsultations);
consultation.get('/:id', consultationController.getConsultationById);
consultation.post('/', consultationController.createConsultation); // Allow anonymous

// Protected routes
consultation.put('/:id', authenticateToken, consultationController.updateConsultation);
consultation.delete('/:id', authenticateToken, restrictToAdmin, consultationController.deleteConsultation);

// Admin routes
consultation.post('/:id/replies', authenticateToken, restrictToAdmin, consultationController.createReply);

export default consultation;