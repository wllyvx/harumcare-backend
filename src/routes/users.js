import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { eq, count } from 'drizzle-orm';
import { users } from '../db/schema.js';
import { authenticateToken, restrictToAdmin } from '../middleware/auth.js';

const usersRoute = new Hono();

// Get all users
usersRoute.get('/', authenticateToken, restrictToAdmin, async (c) => {
    try {
        const db = c.get('db');
        const usersList = await db.select({
            id: users.id,
            nama: users.nama,
            username: users.username,
            email: users.email,
            nomorHp: users.nomorHp,
            alamat: users.alamat,
            role: users.role,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt
        }).from(users);

        return c.json(usersList);
    } catch (error) {
        return c.json({ message: error.message }, 500);
    }
});

// Update user by ID
usersRoute.put('/:id', authenticateToken, restrictToAdmin, async (c) => {
    try {
        const db = c.get('db');
        const body = await c.req.json();
        const { nama, username, email, nomorHp, role, password } = body;
        const userId = c.req.param('id');

        // Persiapkan data update
        const updateData = {};
        if (nama) updateData.nama = nama;
        if (username) updateData.username = username;
        if (email) updateData.email = email;
        if (nomorHp) updateData.nomorHp = nomorHp;
        if (role) updateData.role = role;

        // Update timestamp
        updateData.updatedAt = new Date();

        // Jika ada password baru, hash password
        if (password) {
            updateData.password = await bcrypt.hash(password, 10);
        }

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

            return c.json({ message: 'User berhasil diupdate', user });
        } catch (dbError) {
            if (dbError.message.includes('UNIQUE constraint failed')) {
                return c.json({ error: 'Username atau email sudah digunakan' }, 400);
            }
            throw dbError;
        }
    } catch (err) {
        return c.json({ error: 'Error mengupdate user' }, 400);
    }
});

// Delete user by ID
usersRoute.delete('/:id', authenticateToken, restrictToAdmin, async (c) => {
    try {
        const db = c.get('db');
        const currentUser = c.get('user');
        const userIdToDelete = c.req.param('id');

        // Cek apakah user yang akan dihapus adalah admin terakhir
        if (currentUser.role === 'admin') {
            const [adminCountResult] = await db.select({ count: count() })
                .from(users)
                .where(eq(users.role, 'admin'));

            const adminCount = adminCountResult.count;

            const [userToDelete] = await db.select().from(users).where(eq(users.id, userIdToDelete));

            if (adminCount === 1 && userToDelete?.role === 'admin') {
                return c.json({
                    error: 'Tidak dapat menghapus admin terakhir'
                }, 400);
            }
        }

        const [deletedUser] = await db.delete(users)
            .where(eq(users.id, userIdToDelete))
            .returning();

        if (!deletedUser) {
            return c.json({ error: 'User tidak ditemukan' }, 404);
        }

        return c.json({ message: 'User berhasil dihapus' });
    } catch (err) {
        return c.json({ error: 'Error menghapus user' }, 500);
    }
});

export default usersRoute;
