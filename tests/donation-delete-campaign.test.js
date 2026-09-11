import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { createDonationModule } from '../src/modules/donation/index.js';
import { createCampaignModule } from '../src/modules/campaign/index.js';
import campaignRoutes from '../src/routes/campaigns.js';
import donationRoutes from '../src/routes/donations.js';
import { createFakeDb, createFakeMedia } from './fakes.js';

// C02-T4 RED: atomic deletes with Campaign read-only contract.
// - remove(completed) recalcs; remove(pending) leaves totals untouched
// - remove cleans proof best-effort; media failure never fails DB delete
// - batch failure during remove rolls back
// - Campaign delete removes Campaign + donations atomically, no orphans
// - media failure during Campaign delete does not orphan DB rows
// - deleting a Campaign with donations returns a structured warning

const SECRET = 'test-c02-t4-secret';

function seedDb() {
  const now = Date.now();
  return createFakeDb({
    users: [
      { id: 'u1', nama: 'Donatur Satu', username: 'donatur1', email: 'd1@x.id' },
      { id: 'admin1', nama: 'Admin Satu', username: 'admin1', email: 'a@x.id' },
    ],
    campaigns: [
      {
        id: 'camp1',
        title: 'Bantu Sesama',
        imageUrl: 'https://fake.r2/api/upload/image/camp1.webp',
        organizationLogo: 'https://fake.r2/api/upload/image/logo1.webp',
        targetAmount: 10_000_000,
        currentAmount: 0,
        donorCount: 0,
        endDate: new Date(now + 86400000),
      },
    ],
    donations: [],
  });
}

const donor = { userId: 'u1', nama: 'Donatur Satu', username: 'donatur1', role: 'user' };

const dto = (overrides = {}) => ({
  campaignId: 'camp1',
  amount: 50000,
  paymentMethod: 'bank_transfer',
  message: 'Semoga berkah',
  ...overrides,
});

function trackingMedia() {
  const base = createFakeMedia();
  const removed = [];
  return {
    ...base,
    removed,
    async remove(url) {
      removed.push(url);
      return base.remove(url);
    },
  };
}

describe('donation remove seam (T4)', () => {
  it('remove of a completed donation recalcs; remove of pending leaves totals untouched', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const pending = await mod.create(dto({ amount: 10000 }), donor);
    await mod.remove(pending.id);
    expect(db.__tables.campaigns.find((c) => c.id === 'camp1').currentAmount).toBe(0);
    expect(db.__tables.campaigns.find((c) => c.id === 'camp1').donorCount).toBe(0);

    const d = await mod.create(dto({ amount: 40000 }), donor);
    await mod.complete(d.id);
    expect(db.__tables.campaigns.find((c) => c.id === 'camp1').currentAmount).toBe(40000);
    await mod.remove(d.id);
    const camp = db.__tables.campaigns.find((c) => c.id === 'camp1');
    expect(camp.currentAmount).toBe(0);
    expect(camp.donorCount).toBe(0);
  });

  it('remove cleans the proof file best-effort', async () => {
    const db = seedDb();
    const media = trackingMedia();
    const mod = createDonationModule({ db, media });
    const d = await mod.create(dto(), donor);
    await mod.updateProof(d.id, 'https://fake.r2/api/upload/image/bukti.webp', donor);
    media.removed.length = 0;
    await mod.remove(d.id);
    expect(db.__tables.donations.find((x) => x.id === d.id)).toBeUndefined();
    expect(media.removed).toContain('https://fake.r2/api/upload/image/bukti.webp');
  });

  it('media failure during donation remove does not fail the DB delete', async () => {
    const db = seedDb();
    const failingMedia = {
      async remove() {
        throw new Error('R2 exploded');
      },
    };
    const mod = createDonationModule({ db, media: failingMedia });
    const d = await mod.create(dto(), donor);
    await mod.updateProof(d.id, 'https://fake.r2/api/upload/image/bukti.webp', donor);
    const removed = await mod.remove(d.id);
    expect(removed.id).toBe(d.id);
    expect(db.__tables.donations.find((x) => x.id === d.id)).toBeUndefined();
  });

  it('batch failure during remove rolls back: row + stats unchanged, retry safe', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const d = await mod.create(dto({ amount: 60000 }), donor);
    await mod.complete(d.id);
    expect(db.__tables.campaigns.find((c) => c.id === 'camp1').currentAmount).toBe(60000);
    db.__failAfterDonationWrite = true;
    await expect(mod.remove(d.id)).rejects.toThrow();
    expect(db.__tables.donations.find((x) => x.id === d.id)).toBeTruthy();
    expect(db.__tables.campaigns.find((c) => c.id === 'camp1').currentAmount).toBe(60000);
    expect(db.__tables.campaigns.find((c) => c.id === 'camp1').donorCount).toBe(1);
    db.__failAfterDonationWrite = false;
    await mod.remove(d.id);
    expect(db.__tables.donations.find((x) => x.id === d.id)).toBeUndefined();
    expect(db.__tables.campaigns.find((c) => c.id === 'camp1').currentAmount).toBe(0);
  });

  it('DELETE /:id (admin) removes a completed donation and recalcs totals', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const target = await mod.create(dto({ amount: 25000 }), donor);
    await mod.complete(target.id);
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', db);
      await next();
    });
    app.route('/api/donations', donationRoutes);
    const env = { JWT_SECRET: SECRET };
    const adminToken = jwt.sign({ userId: 'admin1', role: 'admin' }, SECRET);
    const res = await app.request(
      `/api/donations/${target.id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } },
      env,
    );
    expect(res.status).toBe(200);
    expect(db.__tables.donations.find((x) => x.id === target.id)).toBeUndefined();
    expect(db.__tables.campaigns.find((c) => c.id === 'camp1').currentAmount).toBe(0);
  });
});

describe('campaign delete seam (T4)', () => {
  async function seedWithDonations() {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const d1 = await mod.create(dto({ amount: 30000, message: 'a' }), donor);
    await mod.complete(d1.id);
    await mod.updateProof(d1.id, 'https://fake.r2/api/upload/image/bukti-a.webp', donor);
    const d2 = await mod.create(dto({ amount: 20000, message: 'b' }), donor);
    await mod.complete(d2.id);
    return { db, ids: [d1.id, d2.id] };
  }

  it('removes Campaign plus donations atomically with no orphan rows', async () => {
    const { db } = await seedWithDonations();
    const cmod = createCampaignModule({ db, media: createFakeMedia() });
    const result = await cmod.remove('camp1');
    expect(result.removedDonationCount).toBe(2);
    expect(db.__tables.campaigns.find((c) => c.id === 'camp1')).toBeUndefined();
    expect(db.__tables.donations.filter((d) => d.campaignId === 'camp1')).toHaveLength(0);
  });

  it('media failure during Campaign delete does not orphan DB rows', async () => {
    const { db } = await seedWithDonations();
    const failingMedia = {
      async remove() {
        throw new Error('R2 exploded');
      },
    };
    const cmod = createCampaignModule({ db, media: failingMedia });
    const result = await cmod.remove('camp1');
    expect(result.removedDonationCount).toBe(2);
    expect(db.__tables.campaigns.find((c) => c.id === 'camp1')).toBeUndefined();
    expect(db.__tables.donations.filter((d) => d.campaignId === 'camp1')).toHaveLength(0);
  });

  it('batch failure during Campaign delete rolls back with no partial deletes', async () => {
    const { db } = await seedWithDonations();
    const cmod = createCampaignModule({ db, media: createFakeMedia() });
    db.__failCampaignDelete = true;
    await expect(cmod.remove('camp1')).rejects.toThrow();
    expect(db.__tables.campaigns.find((c) => c.id === 'camp1')).toBeTruthy();
    expect(db.__tables.donations.filter((d) => d.campaignId === 'camp1')).toHaveLength(2);
    db.__failCampaignDelete = false;
    const result = await cmod.remove('camp1');
    expect(result.removedDonationCount).toBe(2);
  });

  it('returns a structured warning when the Campaign has donations, null otherwise', async () => {
    const { db } = await seedWithDonations();
    const cmod = createCampaignModule({ db, media: createFakeMedia() });
    const withDonations = await cmod.remove('camp1');
    expect(withDonations.warning).toMatchObject({ code: 'CAMPAIGN_HAS_DONATIONS', donationCount: 2 });
    expect(typeof withDonations.warning.message).toBe('string');

    const empty = seedDb();
    const cmod2 = createCampaignModule({ db: empty, media: createFakeMedia() });
    const withoutDonations = await cmod2.remove('camp1');
    expect(withoutDonations.warning).toBeNull();
    expect(withoutDonations.removedDonationCount).toBe(0);
  });

  it('unknown Campaign is 404', async () => {
    const db = seedDb();
    const cmod = createCampaignModule({ db, media: createFakeMedia() });
    await expect(cmod.remove('nope')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('DELETE /api/campaigns/:id returns the structured warning (not just a console log)', async () => {
    const { db } = await seedWithDonations();
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', db);
      await next();
    });
    app.route('/api/campaigns', campaignRoutes);
    const env = { JWT_SECRET: SECRET };
    const adminToken = jwt.sign({ userId: 'admin1', role: 'admin' }, SECRET);
    const res = await app.request(
      '/api/campaigns/camp1',
      { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.warning).toMatchObject({ code: 'CAMPAIGN_HAS_DONATIONS', donationCount: 2 });
    expect(db.__tables.campaigns.find((c) => c.id === 'camp1')).toBeUndefined();
    expect(db.__tables.donations.filter((d) => d.campaignId === 'camp1')).toHaveLength(0);
  });
});
