import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/Users.js';
import { authenticateToken, restrictToAdmin } from '../middleware/auth.js';

const auth = new Hono();

// Register Admin (khusus admin untuk membuat akun admin)
auth.post('/register-admin', authenticateToken, restrictToAdmin, async (c) => {
    try {
        const { nama, username, email, password, nomorHp, alamat, role } = await c.req.json();

        // Validasi input
        if (!nama || !username || !email || !password || !nomorHp) {
            return c.json({ error: 'Nama, username, email, password, dan nomor HP wajib diisi' }, 400);
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({
            nama,
            username,
            email,
            password: hashedPassword,
            nomorHp,
            ...(alamat && { alamat }), // Hanya tambahkan alamat jika ada
            role: role || 'admin'
        });
        await user.save();
        return c.json({ message: 'Admin berhasil dibuat', userId: user._id }, 201);
    } catch (err) {
        if (err.code === 11000) {
            const field = Object.keys(err.keyPattern)[0];
            return c.json({ error: `${field} sudah digunakan` }, 400);
        }
        return c.json({ error: 'Error membuat admin' }, 400);
    }
});

// Register User (untuk pendaftaran user biasa)
auth.post('/register', async (c) => {
    try {
        const { nama, username, email, password, nomorHp, alamat } = await c.req.json();

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
        const user = new User({
            nama,
            username,
            email,
            password: hashedPassword,
            nomorHp,
            alamat,
            role: 'user'
        });
        await user.save();
        return c.json({ message: 'User berhasil terdaftar', userId: user._id }, 201);
    } catch (err) {
        if (err.code === 11000) {
            const field = Object.keys(err.keyPattern)[0];
            return c.json({ error: `${field} sudah digunakan` }, 400);
        }
        return c.json({ error: 'Error mendaftarkan user' }, 400);
    }
});

// Login
auth.post('/login', async (c) => {
    try {
        const { username, password } = await c.req.json();

        if (!username || !password) {
            return c.json({ error: 'Username dan password wajib diisi' }, 400);
        }

        const user = await User.findOne({
            $or: [{ username }, { email: username }]
        });

        if (!user) {
            return c.json({ error: 'Username/email atau password salah' }, 401);
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return c.json({ error: 'Username/email atau password salah' }, 401);
        }

        const token = jwt.sign(
            { userId: user._id, role: user.role, nama: user.nama },
            c.env.JWT_SECRET || 'your_jwt_secret',
            { expiresIn: '24h' }
        );

        return c.json({
            token,
            role: user.role,
            userId: user._id,
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
        const user = await User.findById(userId).select('-password');
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

        const updateData = {};
        if (nama) updateData.nama = nama;
        if (email) updateData.email = email;
        if (nomorHp) updateData.nomorHp = nomorHp;
        if (alamat) updateData.alamat = alamat;
        updateData.updatedAt = new Date();

        const user = await User.findByIdAndUpdate(
            userId,
            updateData,
            { new: true, runValidators: true }
        ).select('-password');

        if (!user) {
            return c.json({ error: 'User tidak ditemukan' }, 404);
        }

        return c.json({ message: 'Profile berhasil diupdate', user });
    } catch (err) {
        if (err.code === 11000) {
            const field = Object.keys(err.keyPattern)[0];
            return c.json({ error: `${field} sudah digunakan` }, 400);
        }
        return c.json({ error: 'Error mengupdate profile' }, 400);
    }
});

export default auth;
