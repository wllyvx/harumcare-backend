/**
 * Utility to handle R2 operations
 */

/**
 * Extracts the filename/key from an R2 image URL and deletes it from the bucket.
 * 
 * @param {object} c - Hono context
 * @param {string} imageUrl - The full URL of the image
 * @returns {Promise<boolean>} - True if deleted, false otherwise
 */
export const deleteFromR2 = async (c, imageUrl) => {
    if (!imageUrl || typeof imageUrl !== 'string') return false;

    // Check if it's an R2 URL from our system
    // Example: http://localhost:8787/api/upload/image/1737725515234-585800410-image.jpg
    // or https://your-domain.com/api/upload/image/1737725515234-585800410-image.jpg
    if (!imageUrl.includes('/api/upload/image/')) {
        console.log(`Skipping R2 deletion for non-R2 URL: ${imageUrl}`);
        return false;
    }

    try {
        const parts = imageUrl.split('/api/upload/image/');
        const key = parts[parts.length - 1];

        if (!key) return false;

        if (!c.env.BUCKET) {
            console.error('R2 BUCKET not bound in context');
            return false;
        }

        await c.env.BUCKET.delete(key);
        console.log(`Successfully deleted from R2: ${key}`);
        return true;
    } catch (error) {
        console.error(`Error deleting from R2 (${imageUrl}):`, error);
        return false;
    }
};
