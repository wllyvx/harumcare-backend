import { createContentModule } from '../modules/content/index.js';
import { createMedia } from '../modules/media/index.js';
import { createYoutubeFetcher } from '../modules/youtube/index.js';

// Thin adapter: builds the deep content seam from per-request bindings.
// Owns the only Hono touchpoint (`c.get`/`c.env`); the seam itself never sees `c`.
export function contentForRequest(c, type) {
  const db = c.get('db');
  const media = createMedia({ bucket: c.env?.BUCKET });
  const youtubeFetcher = createYoutubeFetcher({ apiKey: c.env?.YOUTUBE_API_KEY });
  const contentModule = createContentModule({ db, media, youtubeFetcher });
  return contentModule.for(type);
}

export function mediaForRequest(c) {
  return createMedia({ bucket: c.env?.BUCKET });
}

export function mapContentError(e) {
  const status =
    typeof e?.statusCode === 'number'
      ? e.statusCode
      : e?.name === 'ValidationError'
        ? 400
        : e?.name === 'NotFoundError'
          ? 404
          : e?.name === 'ForbiddenError'
            ? 403
            : e?.name === 'ConflictError'
              ? 409
              : 500;
  return { status, body: { error: e?.message || 'Server error' } };
}

export function handleContentError(c, e) {
  const { status, body } = mapContentError(e);
  return c.json(body, status);
}
