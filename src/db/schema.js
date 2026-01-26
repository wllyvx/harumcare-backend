import { sqliteTable, text, integer, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    nama: text('nama').notNull(),
    username: text('username').notNull().unique(),
    email: text('email').notNull().unique(),
    password: text('password').notNull(),
    nomorHp: text('nomorHp').notNull(),
    alamat: text('alamat'),
    role: text('role', { enum: ['admin', 'user'] }).default('user'),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
});

export const campaigns = sqliteTable('campaigns', {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    title: text('title').notNull(),
    description: text('description'),
    imageUrl: text('imageUrl'),
    targetAmount: integer('targetAmount').notNull(),
    currentAmount: integer('currentAmount').default(0),
    startDate: integer('startDate', { mode: 'timestamp' }),
    endDate: integer('endDate', { mode: 'timestamp' }).notNull(),
    donorCount: integer('donorCount').default(0),
    organizationName: text('organizationName'),
    organizationLogo: text('organizationLogo'),
    category: text('category'),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
});

export const news = sqliteTable('news', {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    content: text('content').notNull(),
    image: text('image').default('images/empty-image-placeholder.webp'),
    authorId: text('author_id').references(() => users.id).notNull(),
    category: text('category').default('umum').notNull(),
    campaignId: text('campaign_id').references(() => campaigns.id),
    status: text('status', { enum: ['draft', 'published'] }).default('draft'),
    viewCount: integer('viewCount').default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
});

export const blogs = sqliteTable('blogs', {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    content: text('content').notNull(),
    image: text('image').default('images/empty-image-placeholder.webp'),
    authorId: text('author_id').references(() => users.id).notNull(),
    category: text('category').default('umum').notNull(),
    campaignId: text('campaign_id').references(() => campaigns.id),
    status: text('status', { enum: ['draft', 'published'] }).default('draft'),
    viewCount: integer('viewCount').default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
});

export const donations = sqliteTable('donations', {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    campaignId: text('campaign_id').references(() => campaigns.id).notNull(),
    userId: text('user_id').references(() => users.id).notNull(),
    amount: integer('amount').notNull(), // Storing as integer (e.g. Rp 1000)
    message: text('message'),
    paymentStatus: text('paymentStatus', { enum: ['pending', 'completed', 'failed'] }).default('pending'),
    paymentMethod: text('paymentMethod', { enum: ['bank_transfer', 'e_wallet', 'credit_card'] }).notNull(),
    transactionId: text('transactionId').unique(),
    donorName: text('donorName').notNull(),
    isAnonymous: integer('isAnonymous', { mode: 'boolean' }).default(false),
    proofOfTransfer: text('proofOfTransfer').default(''),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
});
