import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import User from '../models/Users.js';
import { authenticateToken, restrictToAdmin } from '../middleware/auth.js';

const users = new Hono();

// Get all users
users.get('/', authenticateToken, restrictToAdmin, async (c) => {
    try {
        const usersList = await User.find().select('-password'); // Exclude password field
        return c.json(usersList);
    } catch (error) {
        return c.json({ message: error.message }, 500);
    }
});

// Update user by ID
users.put('/:id', authenticateToken, restrictToAdmin, async (c) => {
    try {
        const body = await c.req.json();
        const { nama, username, email, nomorHp, role, password } = body;

        // Persiapkan data update
        const updateData = {};
        if (nama) updateData.nama = nama;
        if (username) updateData.username = username;
        if (email) updateData.email = email;
        if (nomorHp) updateData.nomorHp = nomorHp;
        if (role) updateData.role = role;

        // Jika ada password baru, hash password
        if (password) {
            updateData.password = await bcrypt.hash(password, 10);
        }

        // Update user
        const user = await User.findByIdAndUpdate(
            c.req.param('id'),
            updateData,
            { new: true, runValidators: true }
        ).select('-password');

        if (!user) {
            return c.json({ error: 'User tidak ditemukan' }, 404);
        }

        return c.json({ message: 'User berhasil diupdate', user });
    } catch (err) {
        if (err.code === 11000) {
            const field = Object.keys(err.keyPattern)[0];
            return c.json({ error: `${field} sudah digunakan` }, 400);
        }
        return c.json({ error: 'Error mengupdate user' }, 400);
    }
});

// Delete user by ID
users.delete('/:id', authenticateToken, restrictToAdmin, async (c) => {
    try {
        const currentUser = c.get('user');
        // Cek apakah user yang akan dihapus adalah admin terakhir
        if (currentUser.role === 'admin') {
            const adminCount = await User.countDocuments({ role: 'admin' });
            const userToDelete = await User.findById(c.req.param('id'));

            if (adminCount === 1 && userToDelete?.role === 'admin') {
                return c.json({
                    error: 'Tidak dapat menghapus admin terakhir'
                }, 400);
            }
        }

        const user = await User.findByIdAndDelete(c.req.param('id'));

        if (!user) {
            return c.json({ error: 'User tidak ditemukan' }, 404);
        }

        return c.json({ message: 'User berhasil dihapus' });
    } catch (err) {
        return c.json({ error: 'Error menghapus user' }, 500);
    }
});

export default users;
