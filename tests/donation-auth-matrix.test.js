import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import donationRoutes from '../src/routes/donations.js';
import { createDonationModule } from '../src/modules/donation/index.js';
import { createFakeDb, createFakeMedia } from './fakes.js';

// C02-T6 RED: auth matrix smoke tests at the HTTP adapter layer.
// Webhook must verify a shared secret (fail closed), admin list must be
// admin-only, transaction lookup owner-or-admin. No public writer remains.

const SECRET = 'test-donation-auth-matrix-secret';
const WEBHOOK_SECRET = 'test-webhook-secret';

function seedDb() {
  return createFakeDb({
    users: [
      { id: 'u1', nama: 'Donatur Satu', username: 'donatur1', email: 'd1@x.id' },
      { id: 'u2', nama: 'Donatur Dua', username: 'donatur2', email: 'd2@x.id' },
      { id: 'admin1', nama: 'Admin Satu', username: 'admin1', email: 'a@x.id' },
    ],
    campaigns: [
      {
        id: 'camp1',
        title: 'Bantu Sesama',
        imageUrl: 'https://img/c1.webp',
        targetAmount: 10_000_000,
        currentAmount: 0,
        donorCount: 0,
        endDate: new Date(Date.now() + 86400000),
      },
    ],
    donations: [],
  });
}

async function seedDonation(db) {
  const mod = createDonationModule({ db, media: createFakeMedia() });
  return mod.create(
    { campaignId: 'camp1', amount: 50000, paymentMethod: 'bank_transfer', message: 'Semoga berkah' },
    { userId: 'u1', nama: 'Donatur Satu', role: 'user' },
  );
}

function testApp(db, envOverrides = {}) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.route('/api/donations', donationRoutes);
  return {
    app,
    env: { JWT_SECRET: SECRET, PAYMENT_WEBHOOK_SECRET: WEBHOOK_SECRET, ...envOverrides },
  };
}

const userToken = jwt.sign({ userId: 'u1', role: 'user' }, SECRET);
const otherToken = jwt.sign({ userId: 'u2', role: 'user' }, SECRET);
const adminToken = jwt.sign({ userId: 'admin1', role: 'admin' }, SECRET);
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const json = (body) => ({ 'Content-Type': 'application/json', ...body });

const webhookBody = (transactionId, status = 'completed') => ({
  method: 'PUT',
  headers: json(),
  body: JSON.stringify({ transactionId, status }),
});

describe('webhook PUT /payment-status: shared-secret lockdown', () => {
  it('missing secret → 401 and donation stays pending', async () => {
    const db = seedDb();
    const target = await seedDonation(db);
    const { app, env } = testApp(db);
    const res = await app.request('/api/donations/payment-status', webhookBody(target.transactionId), env);
    expect(res.status).toBe(401);
    expect(db.__tables.donations.find((d) => d.id === target.id).paymentStatus).toBe('pending');
  });

  it('wrong secret → 401 and donation stays pending', async () => {
    const db = seedDb();
    const target = await seedDonation(db);
    const { app, env } = testApp(db);
    const res = await app.request(
      '/api/donations/payment-status',
      { ...webhookBody(target.transactionId), headers: json({ 'x-webhook-secret': 'nope' }) },
      env,
    );
    expect(res.status).toBe(401);
    expect(db.__tables.donations.find((d) => d.id === target.id).paymentStatus).toBe('pending');
  });

  it('secret unconfigured server-side → 503 fail-closed even with a header', async () => {
    const db = seedDb();
    const target = await seedDonation(db);
    const { app } = testApp(db);
    const res = await app.request(
      '/api/donations/payment-status',
      { ...webhookBody(target.transactionId), headers: json({ 'x-webhook-secret': WEBHOOK_SECRET }) },
      { JWT_SECRET: SECRET, PAYMENT_WEBHOOK_SECRET: '' },
    );
    expect(res.status).toBe(503);
    expect(db.__tables.donations.find((d) => d.id === target.id).paymentStatus).toBe('pending');
  });

  it('valid secret + unknown transaction → 404', async () => {
    const db = seedDb();
    await seedDonation(db);
    const { app, env } = testApp(db);
    const res = await app.request(
      '/api/donations/payment-status',
      { ...webhookBody('TRX-UNKNOWN'), headers: json({ 'x-webhook-secret': WEBHOOK_SECRET }) },
      env,
    );
    expect(res.status).toBe(404);
  });

  it('valid secret + invalid status → 400', async () => {
    const db = seedDb();
    const target = await seedDonation(db);
    const { app, env } = testApp(db);
    const res = await app.request(
      '/api/donations/payment-status',
      { ...webhookBody(target.transactionId, 'bogus'), headers: json({ 'x-webhook-secret': WEBHOOK_SECRET }) },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('valid secret → 200, delegates to the module seam (completed + stats recalc)', async () => {
    const db = seedDb();
    const target = await seedDonation(db);
    const { app, env } = testApp(db);
    const res = await app.request(
      '/api/donations/payment-status',
      { ...webhookBody(target.transactionId), headers: json({ 'x-webhook-secret': WEBHOOK_SECRET }) },
      env,
    );
    expect(res.status).toBe(200);
    expect(db.__tables.donations.find((d) => d.id === target.id).paymentStatus).toBe('completed');
    const camp = db.__tables.campaigns.find((c) => c.id === 'camp1');
    expect(camp.currentAmount).toBe(50000);
    expect(camp.donorCount).toBe(1);
  });
});

describe('admin PATCH /:id/status', () => {
  it('anonymous → 401', async () => {
    const db = seedDb();
    const target = await seedDonation(db);
    const { app, env } = testApp(db);
    const res = await app.request(
      `/api/donations/${target.id}/status`,
      { method: 'PATCH', headers: json(), body: JSON.stringify({ paymentStatus: 'completed' }) },
      env,
    );
    expect(res.status).toBe(401);
  });

  it('non-admin → 403 and donation stays pending', async () => {
    const db = seedDb();
    const target = await seedDonation(db);
    const { app, env } = testApp(db);
    const res = await app.request(
      `/api/donations/${target.id}/status`,
      { method: 'PATCH', headers: json(bearer(userToken)), body: JSON.stringify({ paymentStatus: 'completed' }) },
      env,
    );
    expect(res.status).toBe(403);
    expect(db.__tables.donations.find((d) => d.id === target.id).paymentStatus).toBe('pending');
  });

  it('admin → 200 with stats recalc', async () => {
    const db = seedDb();
    const target = await seedDonation(db);
    const { app, env } = testApp(db);
    const res = await app.request(
      `/api/donations/${target.id}/status`,
      { method: 'PATCH', headers: json(bearer(adminToken)), body: JSON.stringify({ paymentStatus: 'completed' }) },
      env,
    );
    expect(res.status).toBe(200);
    const camp = db.__tables.campaigns.find((c) => c.id === 'camp1');
    expect(camp.currentAmount).toBe(50000);
    expect(camp.donorCount).toBe(1);
  });
});

describe('transaction lookup GET /transaction/:id (owner-or-admin)', () => {
  it('anonymous → 401', async () => {
    const db = seedDb();
    const target = await seedDonation(db);
    const { app, env } = testApp(db);
    const res = await app.request(`/api/donations/transaction/${target.transactionId}`, {}, env);
    expect(res.status).toBe(401);
  });

  it('non-owner → 403', async () => {
    const db = seedDb();
    const target = await seedDonation(db);
    const { app, env } = testApp(db);
    const res = await app.request(
      `/api/donations/transaction/${target.transactionId}`,
      { headers: bearer(otherToken) },
      env,
    );
    expect(res.status).toBe(403);
  });

  it('owner → 200', async () => {
    const db = seedDb();
    const target = await seedDonation(db);
    const { app, env } = testApp(db);
    const res = await app.request(
      `/api/donations/transaction/${target.transactionId}`,
      { headers: bearer(userToken) },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transactionId).toBe(target.transactionId);
  });

  it('admin → 200', async () => {
    const db = seedDb();
    const target = await seedDonation(db);
    const { app, env } = testApp(db);
    const res = await app.request(
      `/api/donations/transaction/${target.transactionId}`,
      { headers: bearer(adminToken) },
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe('admin list GET /', () => {
  it('anonymous → 401', async () => {
    const db = seedDb();
    await seedDonation(db);
    const { app, env } = testApp(db);
    const res = await app.request('/api/donations', {}, env);
    expect(res.status).toBe(401);
  });

  it('non-admin → 403', async () => {
    const db = seedDb();
    await seedDonation(db);
    const { app, env } = testApp(db);
    const res = await app.request('/api/donations', { headers: bearer(userToken) }, env);
    expect(res.status).toBe(403);
  });
});

describe('proof upload PATCH /:donationId/proof', () => {
  it('anonymous → 401', async () => {
    const db = seedDb();
    const target = await seedDonation(db);
    const { app, env } = testApp(db);
    const res = await app.request(
      `/api/donations/${target.id}/proof`,
      { method: 'PATCH', headers: json(), body: JSON.stringify({ proofOfTransfer: 'https://img/bukti.webp' }) },
      env,
    );
    expect(res.status).toBe(401);
  });
});

describe('remaining gates: no public writer, admin-only writers', () => {
  const newDonationBody = {
    method: 'POST',
    headers: json(),
    body: JSON.stringify({ campaignId: 'camp1', amount: 20000, paymentMethod: 'bank_transfer' }),
  };

  it('POST / anonymous → 401', async () => {
    const { app, env } = testApp(seedDb());
    const res = await app.request('/api/donations', newDonationBody, env);
    expect(res.status).toBe(401);
  });

  it('POST /admin anonymous → 401, non-admin → 403', async () => {
    const { app, env } = testApp(seedDb());
    expect((await app.request('/api/donations/admin', newDonationBody, env)).status).toBe(401);
    const forbidden = await app.request(
      '/api/donations/admin',
      { ...newDonationBody, headers: json(bearer(userToken)) },
      env,
    );
    expect(forbidden.status).toBe(403);
  });

  it('DELETE /:id anonymous → 401, non-admin → 403', async () => {
    const db = seedDb();
    const target = await seedDonation(db);
    const { app, env } = testApp(db);
    expect((await app.request(`/api/donations/${target.id}`, { method: 'DELETE' }, env)).status).toBe(401);
    const forbidden = await app.request(
      `/api/donations/${target.id}`,
      { method: 'DELETE', headers: bearer(userToken) },
      env,
    );
    expect(forbidden.status).toBe(403);
    expect(db.__tables.donations.find((d) => d.id === target.id)).toBeTruthy();
  });

  it('GET /my-donations anonymous → 401', async () => {
    const { app, env } = testApp(seedDb());
    const res = await app.request('/api/donations/my-donations', {}, env);
    expect(res.status).toBe(401);
  });
});
