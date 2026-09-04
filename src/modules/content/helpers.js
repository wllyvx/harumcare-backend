import { ValidationError } from './errors.js';

export function slugify(title) {
  if (typeof title !== 'string') return '';
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

export function escapeLike(q) {
  if (typeof q !== 'string') return '';
  return q.replace(/[%_\\]/g, '\\$&');
}

export function clampPageLimit(query = {}) {
  const rawPage = query.page;
  const rawLimit = query.limit;
  let page;
  let limit;

  if (rawPage === undefined || rawPage === null || rawPage === '') {
    page = 1;
  } else {
    const n = Number(rawPage);
    if (!Number.isFinite(n) || Number.isNaN(n)) {
      throw new ValidationError('Invalid page: must be a number');
    }
    page = Math.floor(n);
    if (page < 1) page = 1;
    if (page > 1000) page = 1000;
  }

  if (rawLimit === undefined || rawLimit === null || rawLimit === '') {
    limit = 10;
  } else {
    const n = Number(rawLimit);
    if (!Number.isFinite(n) || Number.isNaN(n)) {
      throw new ValidationError('Invalid limit: must be a number');
    }
    limit = Math.floor(n);
    if (limit < 1) limit = 1;
    if (limit > 50) limit = 50;
  }

  return { page, limit };
}
