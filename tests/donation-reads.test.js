import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { createDonationModule } from '../src/modules/donation/index.js';
import donationRoutes from '../src/routes/donations.js';
import { createFakeDb, createFakeMedia } from './fakes.js';

// C02-T3 RED: read paths and consistent admin pagination.
// My-donations paginated with Campaign title+image; public by-Campaign
// completed-only paginated; transaction lookup owner-or-admin; admin list
// total always equals the filtered item count (valid-Campaign applied to both).

const SECRET = 'test-donation-reads-secret';

function seedDb() {
  const now = Date.now();
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
        endDate: new Date(now + 86400000),
      },
      {
        id: 'camp2',
        title: 'Sekolah Gratis',
        imageUrl: 'https://img/c2.webp',
        targetAmount: 5_000_000,
        currentAmount: 0,
        donorCount: 0,
        endDate: new Date(now + 86400000),
      },
    ],
    donations: [],
  });
}

const donor1 = { userId: 'u1', nama: 'Donatur Satu', username: 'donatur1', role: 'user' };
const donor2 = { userId: 'u2', nama: 'Donatur Dua', username: 'donatur2', role: 'user' };

const dto = (overrides = {}) => ({
  campaignId: 'camp1',
  amount: 50000,
  paymentMethod: 'bank_transfer',
  message: 'Semoga berkah',
  ...overrides,
});

describe('donation module listMyDonations', () => {
  it('is paginated and shows the linked Campaign title and image', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    await mod.create(dto({ campaignId: 'camp1', message: 'm1' }), donor1);
    await mod.create(dto({ campaignId: 'camp2', message: 'm2' }), donor1);
    await mod.create(dto({ campaignId: 'camp1', message: 'other' }), donor2);

    const page = await mod.listMyDonations('u1', { page: 1, limit: 10 });
    expect(page.total).toBe(2);
    expect(page.donations).toHaveLength(2);
    expect(page.totalPages).toBe(1);
    expect(page.currentPage).toBe(1);
    for (const d of page.donations) {
      expect(d.campaignId).toMatchObject({ title: expect.any(String), imageUrl: expect.any(String) });
    }
    const titles = page.donations.map((d) => d.campaignId.title).sort();
    expect(titles).toEqual(['Bantu Sesama', 'Sekolah Gratis']);
  });

  it('paginates across pages with consistent meta', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    for (let i = 0; i < 3; i++) await mod.create(dto({ message: `m-${i}` }), donor1);

    const p1 = await mod.listMyDonations('u1', { page: 1, limit: 2 });
    const p2 = await mod.listMyDonations('u1', { page: 2, limit: 2 });
    expect(p1.total).toBe(3);
    expect(p1.donations).toHaveLength(2);
    expect(p2.donations).toHaveLength(1);
    expect(p1.totalPages).toBe(2);
    expect(p2.currentPage).toBe(2);
    expect(p2.total).toBe(3);
  });
});

describe('donation module listByCampaign', () => {
  it('shows only completed donations, paginated', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const done = await mod.create(dto({ message: 'count me' }), donor1);
    await mod.complete(done.id);
    await mod.create(dto({ message: 'pending hides' }), donor1);
    const failed = await mod.create(dto({ message: 'failed hides' }), donor2);
    await mod.fail(failed.id);

    const page = await mod.listByCampaign('camp1', { page: 1, limit: 10 });
    expect(page.total).toBe(1);
    expect(page.donations).toHaveLength(1);
    expect(page.donations[0]).toMatchObject({
      _id: done.id,
      amount: 50000,
      message: 'count me',
      donorName: 'Donatur Satu',
      isAnonymous: false,
    });
    expect(page.donations[0].completedAt).toBeTruthy();
  });
});

describe('donation module listAll (admin)', () => {
  async function seedMixed() {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const c1 = await mod.create(dto({ amount: 10000, paymentMethod: 'bank_transfer' }), donor1);
    await mod.complete(c1.id);
    await mod.create(dto({ amount: 20000, paymentMethod: 'e_wallet' }), donor1); // pending
    const f1 = await mod.create(dto({ amount: 30000, paymentMethod: 'bank_transfer' }), donor2);
    await mod.fail(f1.id);
    // Orphan row: campaign deleted out from under the donation.
    db.__tables.donations.push({
      id: 'orphan1',
      campaignId: 'gone',
      userId: 'u1',
      amount: 99999,
      message: 'orphan',
      paymentStatus: 'completed',
      paymentMethod: 'bank_transfer',
      donorName: 'Donatur Satu',
      isAnonymous: false,
      proofOfTransfer: '',
      transactionId: 'TRX-ORPHAN',
      createdAt: new Date(),
      completedAt: new Date(),
    });
    return { db, mod };
  }

  it('total equals the filtered item count across filter combinations', async () => {
    const { mod } = await seedMixed();
    const combos = [
      {},
      { status: 'completed' },
      { status: 'pending' },
      { status: 'failed' },
      { paymentMethod: 'bank_transfer' },
      { paymentMethod: 'e_wallet' },
      { status: 'completed', paymentMethod: 'bank_transfer' },
      { status: 'pending', paymentMethod: 'bank_transfer' },
    ];
    for (const filters of combos) {
      const page = await mod.listAll({ page: 1, limit: 10, ...filters });
      expect(page.total).toBe(page.donations.length);
      expect(page.totalPages).toBe(Math.ceil(page.total / 10));
      expect(page.currentPage).toBe(1);
    }
  });

  it('excludes orphan rows from both total and items', async () => {
    const { mod } = await seedMixed();
    const page = await mod.listAll({ page: 1, limit: 10 });
    expect(page.total).toBe(3);
    expect(page.donations).toHaveLength(3);
    expect(page.donations.map((d) => d.id)).not.toContain('orphan1');
    const completed = await mod.listAll({ page: 1, limit: 10, status: 'completed' });
    expect(completed.total).toBe(1);
  });

  it('shapes one admin row per consumer: campaign + donor joined', async () => {
    const { mod } = await seedMixed();
    const page = await mod.listAll({ page: 1, limit: 10, status: 'pending' });
    expect(page.total).toBe(1);
    expect(page.donations[0].campaignId).toMatchObject({ title: 'Bantu Sesama', imageUrl: 'https://img/c1.webp' });
    expect(page.donations[0].userId).toMatchObject({ nama: 'Donatur Satu', email: 'd1@x.id' });
  });
});

describe('read adapters (HTTP)', () => {
  function testApp(db) {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', db);
      await next();
    });
    app.route('/api/donations', donationRoutes);
    return { app, env: { JWT_SECRET: SECRET } };
  }

  const userToken = jwt.sign({ userId: 'u1', role: 'user' }, SECRET);
  const otherToken = jwt.sign({ userId: 'u2', role: 'user' }, SECRET);
  const adminToken = jwt.sign({ userId: 'admin1', role: 'admin' }, SECRET);
  const bearer = (t) => ({ Authorization: `Bearer ${t}` });

  it('GET /my-donations owner → 200 with campaign title+image', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    await mod.create(dto({ campaignId: 'camp2' }), donor1);
    const { app, env } = testApp(db);
    const res = await app.request('/api/donations/my-donations', { headers: bearer(userToken) }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.donations[0].campaignId).toMatchObject({ title: 'Sekolah Gratis' });
  });

  it('GET /campaign/:id public → 200 completed-only', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const done = await mod.create(dto(), donor1);
    await mod.complete(done.id);
    await mod.create(dto({ message: 'pending' }), donor1);
    const { app, env } = testApp(db);
    const res = await app.request('/api/donations/campaign/camp1', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.donations).toHaveLength(1);
  });

  it('GET /transaction/:id owner → 200, non-owner → 403, unknown → 404', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const target = await mod.create(dto(), donor1);
    const { app, env } = testApp(db);
    const ownerRes = await app.request(
      `/api/donations/transaction/${target.transactionId}`,
      { headers: bearer(userToken) },
      env,
    );
    expect(ownerRes.status).toBe(200);
    const otherRes = await app.request(
      `/api/donations/transaction/${target.transactionId}`,
      { headers: bearer(otherToken) },
      env,
    );
    expect(otherRes.status).toBe(403);
    const missingRes = await app.request(
      '/api/donations/transaction/TRX-NOPE',
      { headers: bearer(userToken) },
      env,
    );
    expect(missingRes.status).toBe(404);
  });

  it('GET / admin → 200 with total matching items; non-admin → 403', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const done = await mod.create(dto({ paymentMethod: 'bank_transfer' }), donor1);
    await mod.complete(done.id);
    await mod.create(dto({ paymentMethod: 'e_wallet' }), donor2);
    const { app, env } = testApp(db);
    const denied = await app.request('/api/donations', { headers: bearer(userToken) }, env);
    expect(denied.status).toBe(403);
    const res = await app.request(
      '/api/donations?status=completed&paymentMethod=bank_transfer',
      { headers: bearer(adminToken) },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.donations).toHaveLength(1);
    expect(body.totalPages).toBe(1);
    expect(body.currentPage).toBe(1);
  });
});
