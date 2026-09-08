import { describe, it, expect } from 'vitest';
import { createFakeDb, createFakeMedia } from './fakes.js';

// TDD RED: Donation module core (C02-T1). Module does not exist yet.
import { createDonationModule } from '../src/modules/donation/index.js';

function seedDb(overrides = {}) {
  const now = Date.now();
  const users = [{ id: 'u1', nama: 'Donatur Satu', username: 'donatur1', email: 'd1@x.id' }];
  const campaigns = [
    {
      id: 'camp1',
      title: 'Bantu Sesama',
      imageUrl: 'https://img/c1.webp',
      targetAmount: 10_000_000,
      currentAmount: 0,
      donorCount: 0,
      endDate: new Date(now + 86400000),
    },
  ];
  return createFakeDb({ users, campaigns, donations: [], news: [], blogs: [], kajians: [], ...overrides });
}

const donor = { userId: 'u1', nama: 'Donatur Satu', username: 'donatur1', role: 'user' };

const dto = (overrides = {}) => ({
  campaignId: 'camp1',
  amount: 50000,
  paymentMethod: 'bank_transfer',
  message: 'Semoga berkah',
  ...overrides,
});

describe('donation module core - create', () => {
  it('create leaves Campaign totals unchanged (starts pending)', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const d = await mod.create(dto(), donor);
    expect(d.paymentStatus).toBe('pending');
    const camp = db.__tables.campaigns.find((c) => c.id === 'camp1');
    expect(camp.currentAmount).toBe(0);
    expect(camp.donorCount).toBe(0);
  });

  it('rejects below-minimum, ended-Campaign, and nonexistent-Campaign creates', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    await expect(mod.create(dto({ amount: 999 }), donor)).rejects.toMatchObject({ statusCode: 400 });
    const endedDb = seedDb({
      campaigns: [{ id: 'camp1', title: 'X', targetAmount: 1000, currentAmount: 0, donorCount: 0, endDate: new Date(Date.now() - 1000) }],
    });
    const modEnded = createDonationModule({ db: endedDb, media: createFakeMedia() });
    await expect(modEnded.create(dto(), donor)).rejects.toMatchObject({ statusCode: 400 });
    await expect(mod.create(dto({ campaignId: 'nope' }), donor)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('resolves donor name: anonymous as Hamba Allah, otherwise account name default', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const anon = await mod.create(dto({ isAnonymous: true }), donor);
    expect(anon.donorName).toBe('Hamba Allah');
    expect(anon.isAnonymous).toBe(true);
    const named = await mod.create(dto({ isAnonymous: false }), donor);
    expect(named.donorName).toBe('Donatur Satu');
    const explicit = await mod.create(dto({ donorName: 'Pak RT' }), donor);
    expect(explicit.donorName).toBe('Pak RT');
  });

  it('concurrent creates never violate transaction-ID uniqueness', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => mod.create(dto({ message: `m-${i}` }), donor)));
    const ids = results.map((r) => r.transactionId);
    expect(new Set(ids).size).toBe(20);
  });

  it('residual transaction-ID collision surfaces as 409, never 500', async () => {
    const db = seedDb();
    let calls = 0;
    const generateTransactionId = () => {
      calls += 1;
      if (calls <= 3) return 'TRX-COLLIDE';
      return `TRX-UNIQUE-${calls}`;
    };
    const mod = createDonationModule({ db, media: createFakeMedia(), generateTransactionId });
    await mod.create(dto(), donor); // claims TRX-COLLIDE
    // Second create collides on first attempt, retries to TRX-COLLIDE again -> 409
    // (generator returns colliding value twice to simulate unresolvable residual)
    await expect(mod.create(dto(), donor)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('donation module core - complete/fail with atomic recalc', () => {
  it('complete adds amount to currentAmount and +1 donorCount', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const d = await mod.create(dto({ amount: 50000 }), donor);
    const done = await mod.complete(d.id);
    expect(done.paymentStatus).toBe('completed');
    expect(done.completedAt).toBeTruthy();
    const camp = db.__tables.campaigns.find((c) => c.id === 'camp1');
    expect(camp.currentAmount).toBe(50000);
    expect(camp.donorCount).toBe(1);
  });

  it('fail after complete subtracts back', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const d = await mod.create(dto({ amount: 50000 }), donor);
    await mod.complete(d.id);
    const failed = await mod.fail(d.id);
    expect(failed.paymentStatus).toBe('failed');
    const camp = db.__tables.campaigns.find((c) => c.id === 'camp1');
    expect(camp.currentAmount).toBe(0);
    expect(camp.donorCount).toBe(0);
  });

  it('re-completing an already-completed donation neither double-counts nor moves completedAt', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const d = await mod.create(dto({ amount: 25000 }), donor);
    const first = await mod.complete(d.id);
    const stamp = new Date(first.completedAt).getTime();
    await new Promise((r) => setTimeout(r, 10));
    const second = await mod.complete(d.id);
    expect(new Date(second.completedAt).getTime()).toBe(stamp);
    const camp = db.__tables.campaigns.find((c) => c.id === 'camp1');
    expect(camp.currentAmount).toBe(25000);
    expect(camp.donorCount).toBe(1);
  });

  it('batch failure mid-transition rolls back: neither donation row nor Campaign stats change', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const d = await mod.create(dto({ amount: 70000 }), donor);
    db.__failAfterDonationWrite = true; // failing-batch injector: throw between donation write and stats write
    await expect(mod.complete(d.id)).rejects.toThrow();
    const row = db.__tables.donations.find((x) => x.id === d.id);
    expect(row.paymentStatus).toBe('pending');
    const camp = db.__tables.campaigns.find((c) => c.id === 'camp1');
    expect(camp.currentAmount).toBe(0);
    expect(camp.donorCount).toBe(0);
    // Safe to retry after clearing the fault
    db.__failAfterDonationWrite = false;
    const retried = await mod.complete(d.id);
    expect(retried.paymentStatus).toBe('completed');
    expect(db.__tables.campaigns.find((c) => c.id === 'camp1').currentAmount).toBe(70000);
  });

  it('admin-create with completed status updates totals; pending does not', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const admin = { userId: 'u1', nama: 'Donatur Satu', username: 'donatur1', role: 'admin' };
    const pending = await mod.create(dto({ amount: 15000, paymentStatus: 'pending' }), admin);
    expect(pending.paymentStatus).toBe('pending');
    expect(db.__tables.campaigns.find((c) => c.id === 'camp1').currentAmount).toBe(0);
    const done = await mod.create(dto({ amount: 15000, paymentStatus: 'completed' }), admin);
    expect(done.paymentStatus).toBe('completed');
    expect(done.completedAt).toBeTruthy();
    const camp = db.__tables.campaigns.find((c) => c.id === 'camp1');
    expect(camp.currentAmount).toBe(15000);
    expect(camp.donorCount).toBe(1);
  });

  it('remove of a completed donation recalcs; remove of pending leaves totals untouched', async () => {
    const db = seedDb();
    const mod = createDonationModule({ db, media: createFakeMedia() });
    const pending = await mod.create(dto({ amount: 10000 }), donor);
    await mod.remove(pending.id);
    expect(db.__tables.campaigns.find((c) => c.id === 'camp1').currentAmount).toBe(0);
    const d = await mod.create(dto({ amount: 40000 }), donor);
    await mod.complete(d.id);
    expect(db.__tables.campaigns.find((c) => c.id === 'camp1').currentAmount).toBe(40000);
    await mod.remove(d.id);
    const camp = db.__tables.campaigns.find((c) => c.id === 'camp1');
    expect(camp.currentAmount).toBe(0);
    expect(camp.donorCount).toBe(0);
  });
});
