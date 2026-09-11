import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { createDonationModule } from '../src/modules/donation/index.js';
import donationRoutes from '../src/routes/donations.js';
import { createFakeDb, createFakeMedia } from './fakes.js';

// C02-T2 RED: proof-of-transfer seam with ownership and media cleanup.
// Donor uploads proof for their own donation via the module seam;
// replacing the file removes the old media best-effort; non-owner → 403;
// media failure never fails the DB update.

const SECRET = 'test-donation-proof-secret';

function seedDb() {
  const now = Date.now();
  return createFakeDb({
    users: [
      { id: 'u1', nama: 'Donatur Satu', username: 'donatur1', email: 'd1@x.id' },
      { id: 'u2', nama: 'Donatur Dua', username: 'donatur2', email: 'd2@x.id' },
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
    ],
    donations: [],
  });
}

const owner = { userId: 'u1', nama: 'Donatur Satu', username: 'donatur1', role: 'user' };
const nonOwner = { userId: 'u2', nama: 'Donatur Dua', username: 'donatur2', role: 'user' };

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

describe('donation module updateProof', () => {
  it('owner proof update replaces the file and removes the old media', async () => {
    const db = seedDb();
    const media = trackingMedia();
    const mod = createDonationModule({ db, media });
    const d = await mod.create(dto(), owner);
    const first = await mod.updateProof(d.id, 'https://fake.r2/api/upload/image/old.webp', owner);
    expect(first.proofOfTransfer).toBe('https://fake.r2/api/upload/image/old.webp');
    const second = await mod.updateProof(d.id, 'https://fake.r2/api/upload/image/new.webp', owner);
    expect(second.proofOfTransfer).toBe('https://fake.r2/api/upload/image/new.webp');
    expect(media.removed).toContain('https://fake.r2/api/upload/image/old.webp');
    const row = db.__tables.donations.find((x) => x.id === d.id);
    expect(row.proofOfTransfer).toBe('https://fake.r2/api/upload/image/new.webp');
  });

  it('non-owner proof update returns 403 and leaves the row untouched', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const d = await mod.create(dto(), owner);
    await mod.updateProof(d.id, 'https://fake.r2/api/upload/image/a.webp', owner);
    await expect(
      mod.updateProof(d.id, 'https://fake.r2/api/upload/image/evil.webp', nonOwner),
    ).rejects.toMatchObject({ statusCode: 403 });
    const row = db.__tables.donations.find((x) => x.id === d.id);
    expect(row.proofOfTransfer).toBe('https://fake.r2/api/upload/image/a.webp');
  });

  it('media removal failure does not fail the DB update', async () => {
    const db = seedDb();
    const failingMedia = {
      async remove() {
        throw new Error('R2 exploded');
      },
    };
    const mod = createDonationModule({ db, media: failingMedia });
    const d = await mod.create(dto(), owner);
    await mod.updateProof(d.id, 'https://fake.r2/api/upload/image/old.webp', owner);
    const updated = await mod.updateProof(d.id, 'https://fake.r2/api/upload/image/new.webp', owner);
    expect(updated.proofOfTransfer).toBe('https://fake.r2/api/upload/image/new.webp');
    const row = db.__tables.donations.find((x) => x.id === d.id);
    expect(row.proofOfTransfer).toBe('https://fake.r2/api/upload/image/new.webp');
  });

  it('missing proof is 400 and unknown donation is 404', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const d = await mod.create(dto(), owner);
    await expect(mod.updateProof(d.id, '', owner)).rejects.toMatchObject({ statusCode: 400 });
    await expect(mod.updateProof('nope', 'https://fake.r2/api/upload/image/x.webp', owner)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('proof upload PATCH /:donationId/proof (thin adapter)', () => {
  function testApp(db) {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', db);
      await next();
    });
    app.route('/api/donations', donationRoutes);
    return { app, env: { JWT_SECRET: SECRET } };
  }

  const ownerToken = jwt.sign({ userId: 'u1', role: 'user' }, SECRET);
  const otherToken = jwt.sign({ userId: 'u2', role: 'user' }, SECRET);
  const bearer = (t) => ({ Authorization: `Bearer ${t}` });
  const json = (body) => ({ 'Content-Type': 'application/json', ...body });

  it('owner → 200 and persists the new proof', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const target = await mod.create(dto(), owner);
    const { app, env } = testApp(db);
    const res = await app.request(
      `/api/donations/${target.id}/proof`,
      {
        method: 'PATCH',
        headers: json(bearer(ownerToken)),
        body: JSON.stringify({ proofOfTransfer: 'https://img/bukti.webp' }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(db.__tables.donations.find((d) => d.id === target.id).proofOfTransfer).toBe(
      'https://img/bukti.webp',
    );
  });

  it('non-owner → 403 and row untouched', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const target = await mod.create(dto(), owner);
    await mod.updateProof(target.id, 'https://img/asli.webp', owner);
    const { app, env } = testApp(db);
    const res = await app.request(
      `/api/donations/${target.id}/proof`,
      {
        method: 'PATCH',
        headers: json(bearer(otherToken)),
        body: JSON.stringify({ proofOfTransfer: 'https://img/evil.webp' }),
      },
      env,
    );
    expect(res.status).toBe(403);
    expect(db.__tables.donations.find((d) => d.id === target.id).proofOfTransfer).toBe(
      'https://img/asli.webp',
    );
  });
});
