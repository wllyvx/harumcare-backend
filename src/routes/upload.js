import { Hono } from 'hono';
import { authenticateToken } from '../middleware/auth.js';
import { createMedia } from '../modules/media/index.js';

const upload = new Hono();

// Upload Image to R2 via the media seam (owns sanitize + key generation).
// The seam takes only the bucket binding — no Hono context leaks into it.
upload.post('/', authenticateToken, async (c) => {
    try {
        const body = await c.req.parseBody();
        const file = body['image'];

        if (!file) {
            return c.json({ error: 'Tidak ada file yang diupload' }, 400);
        }

        if (!c.env.BUCKET) {
            return c.json({ error: 'Server misconfiguration: R2 BUCKET not bound' }, 500);
        }

        const media = createMedia({ bucket: c.env.BUCKET });
        let key;
        try {
            key = await media.store(file, file.name || 'image.jpg', { contentType: file.type });
        } catch (e) {
            return c.json({ error: e.message || 'Gagal mengupload file' }, e.statusCode || 500);
        }

        const baseUrl = c.req.url.split('/api/upload')[0]; // simple dynamic base url
        const imageUrl = media.urlFor(key, baseUrl);

        return c.json({
            message: 'File berhasil diupload ke R2',
            imageUrl: imageUrl,
            fileId: key, // Use sanitized key as ID for R2
            filename: key
        });

    } catch (error) {
        console.error('Error uploading file:', error);
        return c.json({ error: 'Gagal mengupload file' }, 500);
    }
});

// Get Image from R2
upload.get('/image/:key', async (c) => {
    const key = c.req.param('key');

    if (!c.env.BUCKET) {
        return c.json({ error: 'Server misconfiguration: R2 BUCKET not bound' }, 500);
    }

    const object = await c.env.BUCKET.get(key);

    if (object === null) {
        return c.json({ error: 'File tidak ditemukan' }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000');

    return new Response(object.body, {
        headers,
    });
});

// Delete Image from R2
upload.delete('/:key', authenticateToken, async (c) => {
    const key = c.req.param('key');

    if (!c.env.BUCKET) {
        return c.json({ error: 'Server misconfiguration: R2 BUCKET not bound' }, 500);
    }

    try {
        await c.env.BUCKET.delete(key);
        return c.json({ message: 'File berhasil dihapus' });
    } catch (error) {
        console.error('R2 delete error:', error);
        return c.json({ error: 'Gagal menghapus file' }, 500);
    }
});

export default upload;
