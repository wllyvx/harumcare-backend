import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq, or } from 'drizzle-orm';
import { users } from '../db/schema.js';
import { authenticateToken, restrictToAdmin } from '../middleware/auth.js';

const auth = new Hono();

// Helper: Verify Google ID Token
async function verifyGoogleToken(credential, googleClientId) {
    try {
        // Decode the JWT header to get the key ID (kid)
        const parts = credential.split('.');
        if (parts.length !== 3) throw new Error('Invalid token format');

        const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));

        // Verify basic claims
        if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') {
            throw new Error('Invalid issuer');
        }
        if (payload.aud !== googleClientId) {
            throw new Error('Invalid audience');
        }
        if (payload.exp < Math.floor(Date.now() / 1000)) {
            throw new Error('Token expired');
        }

        // Fetch Google's public keys and verify signature
        const certsResponse = await fetch('https://www.googleapis.com/oauth2/v3/certs');
        const certs = await certsResponse.json();
        const key = certs.keys.find(k => k.kid === header.kid);
        if (!key) throw new Error('Key not found');

        // Import the public key
        const cryptoKey = await crypto.subtle.importKey(
            'jwk',
            key,
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['verify']
        );

        // Verify the signature
        const signatureBytes = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        const dataBytes = new TextEncoder().encode(parts[0] + '.' + parts[1]);

        const valid = await crypto.subtle.verify(
            'RSASSA-PKCS1-v1_5',
            cryptoKey,
            signatureBytes,
            dataBytes
        );

        if (!valid) throw new Error('Invalid signature');

        return {
            sub: payload.sub,       // Google user ID
            email: payload.email,
            name: payload.name || payload.email.split('@')[0],
            picture: payload.picture
        };
    } catch (error) {
        console.error('Google token verification error:', error);
        throw new Error('Invalid Google token: ' + error.message);
    }
}

// Google Sign-In
auth.post('/google', async (c) => {
    try {
        const { credential } = await c.req.json();
        const db = c.get('db');

        if (!credential) {
            return c.json({ error: 'Google credential is required' }, 400);
        }

        const googleClientId = c.env.GOOGLE_CLIENT_ID;
        if (!googleClientId) {
            return c.json({ error: 'Server misconfiguration: Google Client ID missing' }, 500);
        }

        // Verify the Google ID token
        const googleUser = await verifyGoogleToken(credential, googleClientId);

        // Check if user already exists by googleId or email
        const [existingUser] = await db.select().from(users).where(
            or(eq(users.googleId, googleUser.sub), eq(users.email, googleUser.email))
        ).limit(1);

        let user;

        if (existingUser) {
            // User exists - update googleId if not set (linking existing account)
            if (!existingUser.googleId) {
                await db.update(users)
                    .set({ googleId: googleUser.sub, authProvider: 'google' })
                    .where(eq(users.id, existingUser.id));
            }
            user = existingUser;
        } else {
            // New user - auto-register
            const emailPrefix = googleUser.email.split('@')[0];
            // Ensure unique username
            let username = emailPrefix;
            const [existingUsername] = await db.select().from(users)
                .where(eq(users.username, username)).limit(1);
            if (existingUsername) {
                username = emailPrefix + '_' + Math.random().toString(36).substring(2, 6);
            }

            const [newUser] = await db.insert(users).values({
                nama: googleUser.name,
                username: username,
                email: googleUser.email,
                password: '', // empty for Google users (SQLite NOT NULL constraint)
                nomorHp: '',
                googleId: googleUser.sub,
                authProvider: 'google',
                role: 'user'
            }).returning();

            user = newUser;
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: user.id, role: user.role, nama: user.nama },
            c.env.JWT_SECRET || 'your_jwt_secret',
            { expiresIn: '24h' }
        );

        return c.json({
            token,
            role: user.role,
            userId: user.id,
            nama: user.nama,
            message: 'Login dengan Google berhasil'
        });
    } catch (err) {
        console.error('Google Sign-In error:', err);
        return c.json({ error: err.message || 'Google Sign-In gagal' }, 400);
    }
});

// Register Admin (khusus admin untuk membuat akun admin)
auth.post('/register-admin', authenticateToken, restrictToAdmin, async (c) => {
    try {
        const { nama, username, email, password, nomorHp, alamat, role } = await c.req.json();
        const db = c.get('db');

        // Validasi input
        if (!nama || !username || !email || !password || !nomorHp) {
            return c.json({ error: 'Nama, username, email, password, dan nomor HP wajib diisi' }, 400);
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        try {
            const [newUser] = await db.insert(users).values({
                nama,
                username,
                email,
                password: hashedPassword,
                nomorHp,
                alamat: alamat || null,
                role: role || 'admin'
            }).returning();

            return c.json({ message: 'Admin berhasil dibuat', userId: newUser.id }, 201);
        } catch (dbError) {
            if (dbError.message.includes('UNIQUE constraint failed')) {
                return c.json({ error: 'Username atau email sudah digunakan' }, 400);
            }
            throw dbError;
        }
    } catch (err) {
        return c.json({ error: 'Error membuat admin' }, 400);
    }
});

// Register User (untuk pendaftaran user biasa)
auth.post('/register', async (c) => {
    try {
        const { nama, username, email, password, nomorHp, alamat } = await c.req.json();
        const db = c.get('db');

        // Validasi input
        if (!nama || !username || !email || !password || !nomorHp) {
            return c.json({ error: 'Semua field wajib diisi' }, 400);
        }

        // Validasi email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return c.json({ error: 'Format email tidak valid' }, 400);
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        try {
            const [newUser] = await db.insert(users).values({
                nama,
                username,
                email,
                password: hashedPassword,
                nomorHp,
                alamat,
                role: 'user'
            }).returning();

            return c.json({ message: 'User berhasil terdaftar', userId: newUser.id }, 201);
        } catch (dbError) {
            if (dbError.message.includes('UNIQUE constraint failed')) {
                return c.json({ error: 'Username atau email sudah digunakan' }, 400);
            }
            throw dbError;
        }
    } catch (err) {
        console.error("Register Error:", err);
        return c.json({ error: 'Error mendaftarkan user' }, 400);
    }
});

// Login
auth.post('/login', async (c) => {
    try {
        const { username, password } = await c.req.json();
        const db = c.get('db');

        if (!username || !password) {
            return c.json({ error: 'Username dan password wajib diisi' }, 400);
        }

        const [user] = await db.select().from(users).where(
            or(eq(users.username, username), eq(users.email, username))
        ).limit(1);

        if (!user) {
            return c.json({ error: 'Username/email atau password salah' }, 401);
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return c.json({ error: 'Username/email atau password salah' }, 401);
        }

        const token = jwt.sign(
            { userId: user.id, role: user.role, nama: user.nama },
            c.env.JWT_SECRET || 'your_jwt_secret',
            { expiresIn: '24h' }
        );

        return c.json({
            token,
            role: user.role,
            userId: user.id,
            nama: user.nama,
            message: 'Login berhasil'
        });
    } catch (err) {
        console.error('Login error:', err);
        return c.json({ error: 'Server error' }, 500);
    }
});

// Get User Profile
auth.get('/profile', authenticateToken, async (c) => {
    try {
        const { userId } = c.get('user');
        const db = c.get('db');

        const [user] = await db.select({
            id: users.id,
            nama: users.nama,
            username: users.username,
            email: users.email,
            nomorHp: users.nomorHp,
            alamat: users.alamat,
            role: users.role,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt
        }).from(users).where(eq(users.id, userId)).limit(1);

        if (!user) {
            return c.json({ error: 'User tidak ditemukan' }, 404);
        }
        return c.json(user);
    } catch (err) {
        return c.json({ error: 'Server error' }, 500);
    }
});

// Update User Profile
auth.put('/profile', authenticateToken, async (c) => {
    try {
        const { nama, email, nomorHp, alamat } = await c.req.json();
        const { userId } = c.get('user');
        const db = c.get('db');

        const updateData = {};
        if (nama) updateData.nama = nama;
        if (email) updateData.email = email;
        if (nomorHp) updateData.nomorHp = nomorHp;
        if (alamat) updateData.alamat = alamat;
        updateData.updatedAt = new Date(); // timestamp will be handled by Drizzle if mapped or this is fine

        try {
            const [user] = await db.update(users)
                .set(updateData)
                .where(eq(users.id, userId))
                .returning({
                    id: users.id,
                    nama: users.nama,
                    username: users.username,
                    email: users.email,
                    nomorHp: users.nomorHp,
                    alamat: users.alamat,
                    role: users.role,
                    updatedAt: users.updatedAt
                });

            if (!user) {
                return c.json({ error: 'User tidak ditemukan' }, 404);
            }

            return c.json({ message: 'Profile berhasil diupdate', user });
        } catch (dbError) {
            if (dbError.message.includes('UNIQUE constraint failed')) {
                return c.json({ error: 'Email sudah digunakan' }, 400);
            }
            throw dbError;
        }
    } catch (err) {
        return c.json({ error: 'Error mengupdate profile' }, 400);
    }
});

export default auth;
