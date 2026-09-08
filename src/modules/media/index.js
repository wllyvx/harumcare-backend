const R2_URL_SEGMENT = '/api/upload/image/';

const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export function sanitizeFilename(hint) {
  if (typeof hint !== 'string') return 'file';
  // Strip any directory components (both separators) and null bytes.
  let base = hint.split('/').pop().split('\\').pop();
  base = base.replace(/\0/g, '').replace(/\.\.+/g, '').trim();
  if (!base || base === '.' || base === '..') return 'file';
  const dot = base.lastIndexOf('.');
  let name;
  let ext = '';
  if (dot > 0 && dot < base.length - 1) {
    name = base.slice(0, dot);
    ext = base
      .slice(dot + 1)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 10);
  } else {
    name = base;
  }
  name = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 80);
  if (!name) name = 'file';
  if (ext) return `${name}.${ext}`;
  return name;
}

export function validateMimeType(contentType) {
  if (contentType === undefined || contentType === null || contentType === '') return;
  if (typeof contentType !== 'string' || !ALLOWED_MIME_TYPES.has(contentType)) {
    const err = new Error(`Unsupported media type: ${contentType}`);
    err.statusCode = 400;
    err.code = 'Validation';
    throw err;
  }
}

export function buildKey(hint, { now = Date.now(), rand = Math.round(Math.random() * 1e9) } = {}) {
  const sanitized = sanitizeFilename(hint || 'file');
  return `${now}-${rand}-${sanitized}`;
}

export function extractKey(url) {
  if (typeof url !== 'string') return null;
  if (!url.includes(R2_URL_SEGMENT)) return null;
  const key = url.split(R2_URL_SEGMENT).pop();
  if (!key) return null;
  if (key.includes('..') || key.includes('/') || key.includes('\\')) return null;
  return key;
}

export function isR2Url(url) {
  return extractKey(url) !== null;
}

export function urlFor(key, baseUrl) {
  const base = typeof baseUrl === 'string' ? baseUrl.replace(/\/$/, '') : '';
  return `${base}/api/upload/image/${key}`;
}

// Real R2-backed media seam. Takes only the bucket binding (no Hono context).
// `store` owns sanitize + key generation; `remove` owns key parsing.
export function createMedia({ bucket } = {}) {
  return {
    sanitizeFilename,
    buildKey,
    extractKey,
    isR2Url,
    urlFor,
    async store(bytes, hint, opts = {}) {
      if (!bucket) {
        const err = new Error('Server misconfiguration: R2 BUCKET not bound');
        err.statusCode = 500;
        throw err;
      }
      validateMimeType(opts.contentType);
      const key = buildKey(hint, opts);
      await bucket.put(key, bytes, opts.contentType ? { httpMetadata: { contentType: opts.contentType } } : undefined);
      return key;
    },
    async remove(url) {
      if (!isR2Url(url)) return false;
      const key = extractKey(url);
      if (!key) return false;
      if (!bucket) return false;
      await bucket.delete(key);
      return true;
    },
  };
}

export { R2_URL_SEGMENT, ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES };

// Best-effort removal shared by non-content flows (campaigns/donations).
// Takes only the bucket binding + url — callers pass `c.env?.BUCKET`, never `c`.
export async function removeMediaBestEffort(bucket, url) {
  try {
    await createMedia({ bucket }).remove(url);
  } catch (e) {
    console.warn(`best-effort media.remove failed for ${url}: ${e?.message || e}`);
  }
}
