import { eq, desc, count, and, or, like } from 'drizzle-orm';
import { consultations, consultationReplies, users } from '../db/schema.js';

// Helper to map consultation result
const mapConsultationResult = (row) => {
    if (!row) return null;
    return {
        ...row.consultations,
        author: row.users ? {
            nama: row.users.nama,
            username: row.users.username
        } : null
    };
};

// Get all consultations with pagination and filters
export const getAllConsultations = async (c) => {
    try {
        const db = c.get('db');
        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '10');
        const category = c.req.query('category');
        const status = c.req.query('status');
        const searchQuery = c.req.query('q');

        const offset = (page - 1) * limit;

        const filters = [];
        if (status && status !== 'all') {
            filters.push(eq(consultations.status, status));
        } else if (!status) {
            // Default to answered for public access
            filters.push(or(eq(consultations.status, 'answered'), eq(consultations.status, 'closed')));
        }
        if (category) filters.push(eq(consultations.category, category));
        if (searchQuery) {
            filters.push(or(
                like(consultations.title, `%${searchQuery}%`),
                like(consultations.content, `%${searchQuery}%`)
            ));
        }

        const whereClause = filters.length > 0 ? and(...filters) : undefined;

        const [consultationsList, totalCount] = await Promise.all([
            db.select({
                consultations: consultations,
                users: users
            })
            .from(consultations)
            .leftJoin(users, eq(consultations.authorId, users.id))
            .where(whereClause)
            .orderBy(desc(consultations.createdAt))
            .limit(limit)
            .offset(offset),
            db.select({ count: count() }).from(consultations).where(whereClause)
        ]);

        const totalPages = Math.ceil(totalCount[0].count / limit);

        return c.json({
            data: consultationsList.map(mapConsultationResult),
            pagination: {
                page,
                limit,
                total: totalCount[0].count,
                totalPages
            }
        });
    } catch (error) {
        console.error('Error fetching consultations:', error);
        return c.json({ error: 'Internal server error' }, 500);
    }
};

// Get consultation by ID with replies
export const getConsultationById = async (c) => {
    try {
        const db = c.get('db');
        const id = c.req.param('id');

        const [consultationData] = await db.select({
            consultations: consultations,
            users: users
        })
        .from(consultations)
        .leftJoin(users, eq(consultations.authorId, users.id))
        .where(eq(consultations.id, id))
        .limit(1);

        if (!consultationData) {
            return c.json({ error: 'Consultation not found' }, 404);
        }

        const replies = await db.select({
            consultationReplies: consultationReplies,
            users: users
        })
        .from(consultationReplies)
        .leftJoin(users, eq(consultationReplies.authorId, users.id))
        .where(eq(consultationReplies.consultationId, id))
        .orderBy(consultationReplies.createdAt);

        const mappedReplies = replies.map(row => ({
            ...row.consultationReplies,
            author: row.users ? {
                nama: row.users.nama,
                username: row.users.username,
                role: row.users.role
            } : null
        }));

        return c.json({
            ...mapConsultationResult(consultationData),
            replies: mappedReplies
        });
    } catch (error) {
        console.error('Error fetching consultation:', error);
        return c.json({ error: 'Internal server error' }, 500);
    }
};

// Create new consultation
export const createConsultation = async (c) => {
    try {
        const db = c.get('db');
        const body = await c.req.json();
        const { title, content, category, authorName, authorEmail, isAnonymous } = body;

        // Validate required fields
        if (!title || !content || !category) {
            return c.json({
                error: 'Field required: title, content, category harus diisi'
            }, 400);
        }

        let authorId = null;
        const user = c.get('user');
        if (user && user.userId && !isAnonymous) {
            authorId = String(user.userId);
        }

        const [savedConsultation] = await db.insert(consultations).values({
            title,
            content,
            category,
            authorId,
            authorName: isAnonymous ? authorName : null,
            authorEmail: isAnonymous ? authorEmail : null,
            isAnonymous: isAnonymous || false,
            status: 'pending'
        }).returning();

        return c.json(savedConsultation, 201);
    } catch (error) {
        console.error('Error creating consultation:', error);
        return c.json({ error: 'Internal server error' }, 500);
    }
};

// Create reply (admin only)
export const createReply = async (c) => {
    try {
        const db = c.get('db');
        const consultationId = c.req.param('id');
        const body = await c.req.json();
        const { content } = body;

        if (!content) {
            return c.json({ error: 'Content is required' }, 400);
        }

        const user = c.get('user');
        if (!user || !user.userId) {
            return c.json({ error: 'Authentication required' }, 401);
        }

        // Check if user is admin
        const [userData] = await db.select().from(users).where(eq(users.id, user.userId)).limit(1);
        if (!userData || userData.role !== 'admin') {
            return c.json({ error: 'Admin access required' }, 403);
        }

        const [savedReply] = await db.insert(consultationReplies).values({
            consultationId,
            content,
            authorId: String(user.userId),
            isAdminReply: true
        }).returning();

        // Update consultation status to answered
        await db.update(consultations)
            .set({ status: 'answered', updatedAt: new Date() })
            .where(eq(consultations.id, consultationId));

        return c.json(savedReply, 201);
    } catch (error) {
        console.error('Error creating reply:', error);
        return c.json({ error: 'Internal server error' }, 500);
    }
};

// Update consultation (user or admin)
export const updateConsultation = async (c) => {
    try {
        const db = c.get('db');
        const id = c.req.param('id');
        const body = await c.req.json();
        const { title, content, category, status } = body;

        const user = c.get('user');
        if (!user || !user.userId) {
            return c.json({ error: 'Authentication required' }, 401);
        }

        // Check ownership or admin
        const [consultation] = await db.select().from(consultations).where(eq(consultations.id, id)).limit(1);
        if (!consultation) {
            return c.json({ error: 'Consultation not found' }, 404);
        }

        const [userData] = await db.select().from(users).where(eq(users.id, user.userId)).limit(1);
        const isOwner = consultation.authorId === user.userId;
        const isAdmin = userData.role === 'admin';

        if (!isOwner && !isAdmin) {
            return c.json({ error: 'Access denied' }, 403);
        }

        // Only admin can change status
        const updateData = {
            updatedAt: new Date()
        };
        if (title) updateData.title = title;
        if (content) updateData.content = content;
        if (category) updateData.category = category;
        if (status && isAdmin) updateData.status = status;

        const [updated] = await db.update(consultations)
            .set(updateData)
            .where(eq(consultations.id, id))
            .returning();

        return c.json(updated);
    } catch (error) {
        console.error('Error updating consultation:', error);
        return c.json({ error: 'Internal server error' }, 500);
    }
};

// Delete consultation (admin only)
export const deleteConsultation = async (c) => {
    try {
        const db = c.get('db');
        const id = c.req.param('id');

        const user = c.get('user');
        if (!user || !user.userId) {
            return c.json({ error: 'Authentication required' }, 401);
        }

        const [userData] = await db.select().from(users).where(eq(users.id, user.userId)).limit(1);
        if (!userData || userData.role !== 'admin') {
            return c.json({ error: 'Admin access required' }, 403);
        }

        // Delete replies first
        await db.delete(consultationReplies).where(eq(consultationReplies.consultationId, id));

        // Delete consultation
        await db.delete(consultations).where(eq(consultations.id, id));

        return c.json({ message: 'Consultation deleted successfully' });
    } catch (error) {
        console.error('Error deleting consultation:', error);
        return c.json({ error: 'Internal server error' }, 500);
    }
};