import { ValidationError } from './errors.js';
import { news, blogs, kajians } from '../../db/schema.js';

// Shape a joined Drizzle row into PublishableContent with Author + CampaignRef.
// Keeps campaignId FK string intact; CampaignRef lives under `campaign` (never overloads campaignId).
export function mapPublishableContentRow(row, alias, withCampaign) {
  if (!row) return null;
  const main = row[alias];
  if (!main) return null;
  const author = row.users ? { nama: row.users.nama, username: row.users.username } : null;
  const out = { ...main, author };
  if (withCampaign) {
    out.campaign = row.campaigns ? { title: row.campaigns.title, imageUrl: row.campaigns.imageUrl } : null;
  } else {
    out.campaign = null;
  }
  return out;
}

export const newsAdapter = {
  type: 'news',
  table: news,
  tableName: 'news',
  alias: 'news',
  withCampaign: true,
  withYouTube: false,
  searchFields: ['title', 'content'],
  legacyItemsKey: 'news',
  legacyTotalKey: 'totalNews',
  mapRow: (row) => mapPublishableContentRow(row, 'news', true),
};

export const blogAdapter = {
  type: 'blog',
  table: blogs,
  tableName: 'blogs',
  alias: 'blogs',
  withCampaign: true,
  withYouTube: false,
  searchFields: ['title', 'content'],
  legacyItemsKey: 'blogs',
  legacyTotalKey: 'totalBlogs',
  mapRow: (row) => mapPublishableContentRow(row, 'blogs', true),
};

export const kajianAdapter = {
  type: 'kajian',
  table: kajians,
  tableName: 'kajians',
  alias: 'kajians',
  withCampaign: false,
  withYouTube: true,
  searchFields: ['title', 'description'],
  legacyItemsKey: 'kajians',
  legacyTotalKey: 'totalKajians',
  mapRow: (row) => mapPublishableContentRow(row, 'kajians', false),
};

const byType = {
  news: newsAdapter,
  blog: blogAdapter,
  blogs: blogAdapter,
  kajian: kajianAdapter,
  kajians: kajianAdapter,
};

export function getAdapter(type) {
  const adapter = byType[type];
  if (!adapter) throw new ValidationError(`Unknown ContentType: ${type}`);
  return adapter;
}

// Map generic {items,total,page,totalPages} to legacy envelope keys
// (news/totalNews, blogs/totalBlogs, kajians/totalKajians + currentPage)
// while preserving the generic keys for future clients.
export function toLegacyListEnvelope(type, result) {
  const adapter = getAdapter(type);
  const { items, total, page, totalPages } = result;
  return {
    items,
    total,
    page,
    totalPages,
    [adapter.legacyItemsKey]: items,
    [adapter.legacyTotalKey]: total,
    currentPage: page,
  };
}
