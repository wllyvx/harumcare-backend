import { and, eq, sum, count } from 'drizzle-orm';
import { donations as donationsTable, campaigns as campaignsTable, users as usersTable } from '../../db/schema.js';
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from './errors.js';

export const MIN_DONATION_AMOUNT = 1000;
export const ANONYMOUS_DONOR_NAME = 'Hamba Allah';
export const VALID_STATUSES = ['pending', 'completed', 'failed'];

const COMPLETED = 'completed';

function defaultGenerateTransactionId() {
  // Collision-proof UUID-based IDs (no timestamp-plus-small-random).
  // WebCrypto randomUUID exists in workers + Node 19+; the fallback below
  // still draws 128 random bits (never timestamps), and every candidate is
  // uniqueness-checked with retry-then-409 in mintTransactionId.
  const uuid = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `TRX-${uuid}`;
}

// Single deep Donation module seam (C02-T1): owns the full donation lifecycle
// plus Campaign stats. Injected `db` (+ optional `media` for follow-up tickets);
// never takes Hono context. `generateTransactionId` is injectable for tests.
export function createDonationModule({ db, media, generateTransactionId } = {}) {
  if (!db) throw new Error('createDonationModule requires db');

  const isMemoryDb = !!db.__isFakeDb && !!db.__tables;
  if (isMemoryDb && !Array.isArray(db.__tables.donations)) db.__tables.donations = [];
  if (isMemoryDb && !Array.isArray(db.__tables.campaigns)) db.__tables.campaigns = [];
  if (isMemoryDb && !Array.isArray(db.__tables.users)) db.__tables.users = [];

  const newTransactionId = generateTransactionId || defaultGenerateTransactionId;

  // --- THE single completed-transition guard. Only place in the codebase
  // that decides whether a status change touches Campaign stats. ---
  const touchesCompleted = (from, to) =>
    (to === COMPLETED && from !== COMPLETED) || (to !== COMPLETED && from === COMPLETED);

  function resolveActorId(user) {
    if (!user || user.userId === undefined || user.userId === null || String(user.userId) === '') {
      throw new ForbiddenError('Authentication required');
    }
    return String(user.userId);
  }

  function resolveDonorName(dto, userInfo) {
    if (dto.isAnonymous) return ANONYMOUS_DONOR_NAME;
    if (typeof dto.donorName === 'string' && dto.donorName.trim() !== '') return dto.donorName;
    return userInfo.nama;
  }

  async function memoryFindUser(userId) {
    return (db.__tables.users || []).find((u) => String(u.id) === String(userId)) || null;
  }

  async function memoryFindCampaign(campaignId) {
    return (db.__tables.campaigns || []).find((c) => String(c.id) === String(campaignId)) || null;
  }

  async function drizzleFindUser(userId) {
    const rows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    return rows[0] || null;
  }

  async function drizzleFindCampaign(campaignId) {
    const rows = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId)).limit(1);
    return rows[0] || null;
  }

  async function isTransactionIdTaken(transactionId) {
    if (isMemoryDb) {
      return (db.__tables.donations || []).some((d) => d.transactionId === transactionId);
    }
    const rows = await db.select({ id: donationsTable.id }).from(donationsTable).where(eq(donationsTable.transactionId, transactionId)).limit(1);
    return rows.length > 0;
  }

  function isUniqueViolation(e) {
    const msg = e && typeof e.message === 'string' ? e.message : '';
    return /unique/i.test(msg);
  }

  // Collision-proof IDs: UUID-based; on residual collision retry once, then 409 (never 500).
  async function mintTransactionId() {
    const first = newTransactionId();
    if (!(await isTransactionIdTaken(first))) return first;
    const second = newTransactionId();
    if (!(await isTransactionIdTaken(second))) return second;
    throw new ConflictError('Transaction ID collision, please retry');
  }

  function validateCreateInput(dto) {
    if (!dto || typeof dto !== 'object') throw new ValidationError('Invalid payload');
    if (!dto.campaignId || !dto.amount || !dto.paymentMethod) {
      throw new ValidationError('Campaign ID, amount, dan payment method wajib diisi');
    }
    if (Number(dto.amount) < MIN_DONATION_AMOUNT) {
      throw new ValidationError('Minimal donasi Rp 1.000');
    }
    const initial = dto.paymentStatus ?? 'pending';
    if (!VALID_STATUSES.includes(initial)) {
      throw new ValidationError('Invalid payment status');
    }
    return initial;
  }

  function campaignEnded(campaign) {
    return new Date() > new Date(campaign.endDate);
  }

  function memoryRecalc(campaignId) {
    const rows = (db.__tables.donations || []).filter(
      (d) => String(d.campaignId) === String(campaignId) && d.paymentStatus === COMPLETED,
    );
    const currentAmount = rows.reduce((acc, d) => acc + Number(d.amount || 0), 0);
    const donorCount = rows.length;
    const campaign = (db.__tables.campaigns || []).find((c) => String(c.id) === String(campaignId));
    if (campaign) {
      campaign.currentAmount = currentAmount;
      campaign.donorCount = donorCount;
    }
    return { currentAmount, donorCount };
  }

  async function drizzleRecalc(campaignId) {
    const [stats] = await db.select({
      totalAmount: sum(donationsTable.amount),
      totalDonors: count(donationsTable.id),
    })
      .from(donationsTable)
      .where(and(eq(donationsTable.campaignId, campaignId), eq(donationsTable.paymentStatus, COMPLETED)));
    const currentAmount = Number(stats?.totalAmount || 0);
    const donorCount = Number(stats?.totalDonors || 0);
    await db.update(campaignsTable).set({ currentAmount, donorCount }).where(eq(campaignsTable.id, campaignId));
    return { currentAmount, donorCount };
  }

  async function recalcStats(campaignId) {
    if (isMemoryDb) return memoryRecalc(campaignId);
    return drizzleRecalc(campaignId);
  }

  function snapshotMemory() {
    return {
      donations: (db.__tables.donations || []).map((r) => ({ ...r })),
      campaigns: (db.__tables.campaigns || []).map((r) => ({ ...r })),
    };
  }

  function restoreMemory(snap) {
    db.__tables.donations.length = 0;
    db.__tables.donations.push(...snap.donations);
    db.__tables.campaigns.length = 0;
    db.__tables.campaigns.push(...snap.campaigns);
  }

  function memoryGet(id) {
    const row = (db.__tables.donations || []).find((d) => String(d.id) === String(id));
    if (!row) throw new NotFoundError('Donasi tidak ditemukan');
    return row;
  }

  async function drizzleGet(id) {
    const rows = await db.select().from(donationsTable).where(eq(donationsTable.id, id)).limit(1);
    if (!rows[0]) throw new NotFoundError('Donasi tidak ditemukan');
    return rows[0];
  }

  // Joined lookup by transaction ID for the webhook + owner-or-admin
  // transaction lookup adapters. Memory path reads `__tables` directly (same
  // seam as the transition methods); drizzle path runs the join query.
  // Returns null when unknown; adapters own the 404/403 mapping.
  async function getByTransactionId(transactionId) {
    if (isMemoryDb) {
      const donation = (db.__tables.donations || []).find((d) => d.transactionId === transactionId) || null;
      if (!donation) return null;
      const campaign = (db.__tables.campaigns || []).find((x) => String(x.id) === String(donation.campaignId));
      const donor = (db.__tables.users || []).find((x) => String(x.id) === String(donation.userId));
      return {
        donation: { ...donation },
        campaign: campaign ? { title: campaign.title } : null,
        donor: donor ? { nama: donor.nama, email: donor.email } : null,
      };
    }
    const rows = await db.select({
      donations: donationsTable,
      campaigns: { title: campaignsTable.title },
      users: { nama: usersTable.nama, email: usersTable.email },
    })
      .from(donationsTable)
      .leftJoin(campaignsTable, eq(donationsTable.campaignId, campaignsTable.id))
      .leftJoin(usersTable, eq(donationsTable.userId, usersTable.id))
      .where(eq(donationsTable.transactionId, transactionId))
      .limit(1);
    if (!rows[0]) return null;
    return { donation: rows[0].donations, campaign: rows[0].campaigns, donor: rows[0].users };
  }

  // Atomic transition core: donation write + stats rewrite commit together.
  // Memory path snapshots both tables and rolls back on any failure
  // (including the `__failAfterDonationWrite` failing-batch injector used in tests).
  // Drizzle path batches the two writes when `db.batch` is available.
  async function applyTransition(id, toStatus) {
    if (!VALID_STATUSES.includes(toStatus)) throw new ValidationError('Invalid payment status');

    if (isMemoryDb) {
      const row = memoryGet(id);
      const from = row.paymentStatus;
      if (from === toStatus) return { ...row }; // idempotent: no recount, no completedAt move
      const snap = snapshotMemory();
      try {
        if (toStatus === COMPLETED) row.completedAt = new Date();
        row.paymentStatus = toStatus;
        if (db.__failAfterDonationWrite) {
          throw new Error('injected batch failure after donation write');
        }
        if (touchesCompleted(from, toStatus)) memoryRecalc(row.campaignId);
        return { ...row };
      } catch (e) {
        restoreMemory(snap);
        throw e;
      }
    }

    const donation = await drizzleGet(id);
    const from = donation.paymentStatus;
    if (from === toStatus) return donation;
    const updateData = { paymentStatus: toStatus };
    if (toStatus === COMPLETED) updateData.completedAt = new Date();
    const needsRecalc = touchesCompleted(from, toStatus);

    if (!needsRecalc) {
      const [updated] = await db.update(donationsTable).set(updateData).where(eq(donationsTable.id, id)).returning();
      return updated;
    }

    // Needs recalc: compute target stats from post-transition state, then
    // commit donation + campaign writes atomically via db.batch when available.
    const [stats] = await db.select({
      totalAmount: sum(donationsTable.amount),
      totalDonors: count(donationsTable.id),
    })
      .from(donationsTable)
      .where(and(eq(donationsTable.campaignId, donation.campaignId), eq(donationsTable.paymentStatus, COMPLETED)));
    // Adjust the pre-transition aggregate for the single row being moved.
    let currentAmount = Number(stats?.totalAmount || 0);
    let donorCount = Number(stats?.totalDonors || 0);
    if (toStatus === COMPLETED) {
      currentAmount += Number(donation.amount || 0);
      donorCount += 1;
    } else {
      currentAmount -= Number(donation.amount || 0);
      donorCount -= 1;
      if (currentAmount < 0) currentAmount = 0;
      if (donorCount < 0) donorCount = 0;
    }
    if (db.__failAfterDonationWrite) {
      throw new Error('injected batch failure after donation write');
    }
    if (typeof db.batch === 'function') {
      await db.batch([
        db.update(donationsTable).set(updateData).where(eq(donationsTable.id, id)),
        db.update(campaignsTable).set({ currentAmount, donorCount }).where(eq(campaignsTable.id, donation.campaignId)),
      ]);
      const [updated] = await db.select().from(donationsTable).where(eq(donationsTable.id, id)).limit(1);
      return updated;
    }
    const [updated] = await db.update(donationsTable).set(updateData).where(eq(donationsTable.id, id)).returning();
    await db.update(campaignsTable).set({ currentAmount, donorCount }).where(eq(campaignsTable.id, donation.campaignId));
    return updated;
  }

  async function create(dto, user) {
    const initialStatus = validateCreateInput(dto);
    const actorId = resolveActorId(user);
    const findUser = isMemoryDb ? memoryFindUser : drizzleFindUser;
    const findCampaign = isMemoryDb ? memoryFindCampaign : drizzleFindCampaign;

    const campaign = await findCampaign(dto.campaignId);
    if (!campaign) throw new NotFoundError('Campaign tidak ditemukan');
    if (campaignEnded(campaign)) throw new ValidationError('Campaign sudah berakhir');
    const userInfo = await findUser(actorId);
    if (!userInfo) throw new NotFoundError('User tidak ditemukan');

    const donorName = resolveDonorName(dto, userInfo);
    // NOTE: `uniqueCode` intentionally not persisted — no such column exists
    // in the schema (phantom write removed per C02).
    const transactionId = await mintTransactionId();
    const now = new Date();
    // `create` is (3, 2, 1)-arity compatible: create.length === 2 reports
    // required params only; keep signature exactly (dto, user).
    const values = {
      id: typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      campaignId: String(dto.campaignId),
      userId: actorId,
      amount: Number(dto.amount),
      message: dto.message ?? null,
      paymentMethod: dto.paymentMethod,
      donorName,
      isAnonymous: !!dto.isAnonymous,
      paymentStatus: initialStatus,
      proofOfTransfer: '',
      transactionId,
      createdAt: now,
      completedAt: initialStatus === COMPLETED ? now : null,
    };

    if (isMemoryDb) {
      if (await isTransactionIdTaken(transactionId)) {
        // Extremely narrow race: id was claimed between mint check and insert.
        throw new ConflictError('Transaction ID collision, please retry');
      }
      const snap = snapshotMemory();
      try {
        db.__tables.donations.push({ ...values });
        if (db.__failAfterDonationWrite) {
          throw new Error('injected batch failure after donation write');
        }
        if (initialStatus === COMPLETED) memoryRecalc(values.campaignId);
        return { ...values };
      } catch (e) {
        restoreMemory(snap);
        throw e;
      }
    }

    try {
      const [inserted] = await db.insert(donationsTable).values({
        campaignId: values.campaignId,
        userId: values.userId,
        amount: values.amount,
        message: values.message,
        paymentMethod: values.paymentMethod,
        donorName: values.donorName,
        isAnonymous: values.isAnonymous,
        paymentStatus: values.paymentStatus,
        completedAt: values.completedAt,
        transactionId: values.transactionId,
      }).returning();
      if (initialStatus === COMPLETED) await drizzleRecalc(values.campaignId);
      return inserted;
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError('Transaction ID collision, please retry');
      throw e;
    }
  }

  async function complete(id) {
    return applyTransition(id, COMPLETED);
  }

  async function fail(id) {
    return applyTransition(id, 'failed');
  }

  async function setStatus(id, status) {
    return applyTransition(id, status);
  }

  async function remove(id) {
    if (isMemoryDb) {
      const idx = (db.__tables.donations || []).findIndex((d) => String(d.id) === String(id));
      if (idx === -1) throw new NotFoundError('Donasi tidak ditemukan');
      const snap = snapshotMemory();
      try {
        const [row] = db.__tables.donations.splice(idx, 1);
        if (db.__failAfterDonationWrite) {
          throw new Error('injected batch failure after donation write');
        }
        // Guard reuse: deletion counts as leaving `completed` (same single seam).
        if (touchesCompleted(row.paymentStatus, 'deleted')) memoryRecalc(row.campaignId);
        return { ...row };
      } catch (e) {
        restoreMemory(snap);
        throw e;
      }
    }

    const donation = await drizzleGet(id);
    await db.delete(donationsTable).where(eq(donationsTable.id, id));
    if (db.__failAfterDonationWrite) {
      throw new Error('injected batch failure after donation write');
    }
    if (touchesCompleted(donation.paymentStatus, 'deleted')) await drizzleRecalc(donation.campaignId);
    return donation;
  }

  return { create, complete, fail, setStatus, remove, recalcStats, getByTransactionId };
}

export { ValidationError, NotFoundError, ForbiddenError, ConflictError };
