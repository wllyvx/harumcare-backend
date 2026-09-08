import { createContentRouter } from '../modules/content/routes.js';

// Thin adapter: mounts unchanged (/api/blog), all handlers delegate via
// `content.for('blog')`. Auth guard lives inside the shared router for
// POST / PUT /:id DELETE /:id. Legacy envelope (blogs/totalBlogs + currentPage,
// relatedCampaign on detail) preserved for frontend compat.
const blog = createContentRouter('blog');

export default blog;
