import { Hono } from 'hono';
import { authenticateToken } from '../middleware/auth.js';

const upload = new Hono();

// Upload Image to R2
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

        // Generate unique filename
        const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + (file.name || 'image.jpg');

        // Upload to R2
        // Hono's parseBody returns a File object (Blob) which can be passed directly to put
        await c.env.BUCKET.put(filename, file);

        const baseUrl = c.req.url.split('/api/upload')[0]; // simple dynamic base url
        const imageUrl = `${baseUrl}/api/upload/image/${filename}`;

        return c.json({
            message: 'File berhasil diupload ke R2',
            imageUrl: imageUrl,
            fileId: filename, // Use filename as ID for R2
            filename: filename
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
