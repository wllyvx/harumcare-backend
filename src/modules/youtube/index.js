// YouTube fetcher factory. Takes only primitives (no Hono context / c.env leak).
// Returns `(videoId) => {title, description}` for injection into the content seam.
export function createYoutubeFetcher({ apiKey, fetchFn = fetch } = {}) {
  return async (videoId) => {
    if (typeof videoId !== 'string' || videoId.trim() === '') {
      const err = new Error('videoId required');
      err.statusCode = 400;
      err.code = 'Validation';
      throw err;
    }
    if (!apiKey) {
      const err = new Error('YouTube API key not configured');
      err.statusCode = 500;
      throw err;
    }
    try {
      const response = await fetchFn(
        `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(videoId.trim())}&key=${apiKey}&part=snippet`,
      );
      const data = await response.json();
      if (data.items && data.items.length > 0) {
        const snippet = data.items[0].snippet;
        return { title: snippet.title, description: snippet.description };
      }
      throw new Error('Video not found or private');
    } catch (error) {
      if (error?.statusCode) throw error;
      throw new Error(`Failed to fetch YouTube data: ${error.message}`);
    }
  };
}
