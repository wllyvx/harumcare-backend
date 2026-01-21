import { Hono } from 'hono';
import * as campaignController from '../controllers/campaignController.js';
import * as donationController from '../controllers/donationController.js';
import { authenticateToken, restrictToAdmin } from '../middleware/auth.js';

const campaigns = new Hono();

// Public routes
campaigns.get('/', campaignController.getAllCampaigns);
campaigns.get('/stats', campaignController.getCampaignStats);
campaigns.get('/:id', campaignController.getCampaignById);

// Admin only routes
campaigns.post('/', authenticateToken, restrictToAdmin, campaignController.createCampaign);
campaigns.put('/:id', authenticateToken, restrictToAdmin, campaignController.updateCampaign);
campaigns.delete('/:id', authenticateToken, restrictToAdmin, campaignController.deleteCampaign);

// Donation route
campaigns.post('/:id/donate', authenticateToken, donationController.createDonation);

export default campaigns;
