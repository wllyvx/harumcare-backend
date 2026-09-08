import { createContentRouter } from '../modules/content/routes.js';

// Thin adapter: mounts unchanged (/api/kajian), all handlers delegate via
// `content.for('kajian')` with the injected youtubeFetcher. Auth guard lives
// inside the shared router for POST / PUT /:id DELETE /:id. Legacy envelope
// (kajians/totalKajians + currentPage, no relatedCampaign) preserved for
// frontend compat. /fetch-youtube precedes /:slug.
const kajian = createContentRouter('kajian');

export default kajian;