import { Hono } from 'hono';
import * as donationController from '../controllers/donationController.js';
import { authenticateToken } from '../middleware/auth.js';

const donations = new Hono();

// Create donation (user only)
donations.post('/', authenticateToken, donationController.createDonation);

// Create donation (admin only)
donations.post('/admin', authenticateToken, donationController.createDonationByAdmin);

// Get donations by campaign (public)
donations.get('/campaign/:campaignId', donationController.getDonationsByCampaign);

// Get user's donations (user only)
donations.get('/my-donations', authenticateToken, donationController.getUserDonations);

// Get donation by transaction ID (user/admin)
donations.get('/transaction/:transactionId', authenticateToken, donationController.getDonationByTransactionId);

// Get all donations (admin only)
donations.get('/', authenticateToken, donationController.getAllDonations);

// Update donation status (admin only)
donations.patch('/:id/status', authenticateToken, donationController.updateDonationStatus);

// Delete donation (admin only)
donations.delete('/:id', authenticateToken, donationController.deleteDonation);

// Update payment status (for payment gateway webhook)
donations.put('/payment-status', donationController.updatePaymentStatus);

// Update proof of transfer (user only)
donations.patch('/:donationId/proof', authenticateToken, donationController.updateDonationProof);

export default donations;
