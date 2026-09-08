import { createContentRouter } from '../modules/content/routes.js';

// Thin adapter: mounts unchanged (/api/news), all handlers delegate via
// `content.for('news')`. Auth guard lives inside the shared router for
// POST / PUT /:id DELETE /:id. Legacy envelope (news/totalNews + currentPage,
// relatedCampaign on detail) preserved for frontend compat.
const news = createContentRouter('news');

export default news;
