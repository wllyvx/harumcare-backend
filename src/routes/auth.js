import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq, or } from 'drizzle-orm';
import { users } from '../db/schema.js';
import { authenticateToken, restrictToAdmin } from '../middleware/auth.js';

const auth = new Hono();

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
