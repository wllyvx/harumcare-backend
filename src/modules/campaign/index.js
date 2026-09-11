import { eq } from 'drizzle-orm';
import { donations as donationsTable, campaigns as campaignsTable } from '../../db/schema.js';
import { NotFoundError } from '../donation/errors.js';

// Campaign removal seam (C02-T4): Campaign row + related donation rows are
// removed atomically (one batch on drizzle, snapshot-rollback on the memory
// path). Media (Campaign images + donation proofs) is cleaned up
// best-effort AFTER the DB commit, so a media failure can never orphan DB
// rows. The "has donations" notice is structured return data, not a console log.
//
// Campaign stays read-only for stats: this module never writes
// `currentAmount`/`donorCount` — it only deletes rows. The sole writer of
// those two columns remains the Donation module's recalc.
export function createCampaignModule({ db, media } = {}) {
  if (!db) throw new Error('createCampaignModule requires db');

  const isMemoryDb = !!db.__isFakeDb && !!db.__tables;
  if (isMemoryDb && !Array.isArray(db.__tables.donations)) db.__tables.donations = [];
  if (isMemoryDb && !Array.isArray(db.__tables.campaigns)) db.__tables.campaigns = [];

  async function bestEffortMediaRemove(url) {
    if (!url || typeof url !== 'string' || url === '') return;
    if (!media || typeof media.remove !== 'function') return;
    try {
      await media.remove(url);
    } catch (e) {
      console.warn(`best-effort media.remove failed for ${url}: ${e?.message || e}`);
    }
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

  function buildWarning(relatedCount) {
    if (relatedCount === 0) return null;
    return {
      code: 'CAMPAIGN_HAS_DONATIONS',
      message: `Campaign yang dihapus memiliki ${relatedCount} donasi yang juga dihapus`,
      donationCount: relatedCount,
    };
  }

  async function memoryRemove(id) {
    const campaign = (db.__tables.campaigns || []).find((c) => String(c.id) === String(id));
    if (!campaign) throw new NotFoundError('Campaign tidak ditemukan');
    const related = (db.__tables.donations || []).filter((d) => String(d.campaignId) === String(id));
    const mediaUrls = [
      campaign.imageUrl,
      campaign.organizationLogo,
      ...related.map((d) => d.proofOfTransfer),
    ].filter((u) => typeof u === 'string' && u !== '');
    const warning = buildWarning(related.length);
    const snap = snapshotMemory();
    try {
      if (db.__failCampaignDelete || db.__failAfterDonationWrite) {
        throw new Error('injected batch failure during campaign delete');
      }
      db.__tables.donations = (db.__tables.donations || []).filter(
        (d) => String(d.campaignId) !== String(id),
      );
      db.__tables.campaigns = (db.__tables.campaigns || []).filter(
        (c) => String(c.id) !== String(id),
      );
    } catch (e) {
      restoreMemory(snap);
      throw e;
    }
    // Best-effort-after-commit: DB rows are already gone; media failures warn only.
    for (const url of mediaUrls) {
      await bestEffortMediaRemove(url);
    }
    if (warning) {
      console.warn(`Deleting campaign "${campaign.title}" with ${related.length} donation(s)`);
    }
    return { campaign: { ...campaign }, removedDonationCount: related.length, warning };
  }

  async function drizzleRemove(id) {
    const rows = await db.select().from(campaignsTable).where(eq(campaignsTable.id, id)).limit(1);
    const campaign = rows[0] || null;
    if (!campaign) throw new NotFoundError('Campaign tidak ditemukan');
    const related = await db.select().from(donationsTable).where(eq(donationsTable.campaignId, id));
    const mediaUrls = [
      campaign.imageUrl,
      campaign.organizationLogo,
      ...related.map((d) => d.proofOfTransfer),
    ].filter((u) => typeof u === 'string' && u !== '');
    const warning = buildWarning(related.length);
    if (db.__failCampaignDelete || db.__failAfterDonationWrite) {
      throw new Error('injected batch failure during campaign delete');
    }
    if (typeof db.batch === 'function') {
      await db.batch([
        db.delete(donationsTable).where(eq(donationsTable.campaignId, id)),
        db.delete(campaignsTable).where(eq(campaignsTable.id, id)),
      ]);
    } else {
      await db.delete(donationsTable).where(eq(donationsTable.campaignId, id));
      await db.delete(campaignsTable).where(eq(campaignsTable.id, id));
    }
    for (const url of mediaUrls) {
      await bestEffortMediaRemove(url);
    }
    if (warning) {
      console.warn(`Deleting campaign "${campaign.title}" with ${related.length} donation(s)`);
    }
    return { campaign, removedDonationCount: related.length, warning };
  }

  async function remove(id) {
    if (isMemoryDb) return memoryRemove(id);
    return drizzleRemove(id);
  }

  return { remove };
}

export { NotFoundError };
