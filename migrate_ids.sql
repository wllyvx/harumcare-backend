PRAGMA foreign_keys=OFF;

-- 1. CAMPAIGNS
CREATE TABLE `campaigns_new` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`imageUrl` text,
	`targetAmount` integer NOT NULL,
	`currentAmount` integer DEFAULT 0,
	`startDate` integer,
	`endDate` integer NOT NULL,
	`donorCount` integer DEFAULT 0,
	`organizationName` text,
	`organizationLogo` text,
	`category` text,
	`created_at` integer DEFAULT (strftime('%s', 'now'))
);
INSERT INTO `campaigns_new` SELECT CAST(`id` AS TEXT), `title`, `description`, `imageUrl`, `targetAmount`, `currentAmount`, `startDate`, `endDate`, `donorCount`, `organizationName`, `organizationLogo`, `category`, `created_at` FROM `campaigns`;
DROP TABLE `campaigns`;
ALTER TABLE `campaigns_new` RENAME TO `campaigns`;

-- 2. USERS
CREATE TABLE `users_new` (
	`id` text PRIMARY KEY NOT NULL,
	`nama` text NOT NULL,
	`username` text NOT NULL,
	`email` text NOT NULL,
	`password` text NOT NULL,
	`nomorHp` text NOT NULL,
	`alamat` text,
	`role` text DEFAULT 'user',
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now'))
);
INSERT INTO `users_new` SELECT CAST(`id` AS TEXT), `nama`, `username`, `email`, `password`, `nomorHp`, `alamat`, `role`, `created_at`, `updated_at` FROM `users`;
DROP TABLE `users`;
ALTER TABLE `users_new` RENAME TO `users`;
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);

-- 3. NEWS
CREATE TABLE `news_new` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`content` text NOT NULL,
	`image` text DEFAULT 'images/empty-image-placeholder.webp',
	`author_id` text NOT NULL,
	`category` text DEFAULT 'umum' NOT NULL,
	`campaign_id` text,
	`status` text DEFAULT 'draft',
	`viewCount` integer DEFAULT 0,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `news_new` SELECT CAST(`id` AS TEXT), `title`, `slug`, `content`, `image`, CAST(`author_id` AS TEXT), `category`, CAST(`campaign_id` AS TEXT), `status`, `viewCount`, `created_at`, `updated_at` FROM `news`;
DROP TABLE `news`;
ALTER TABLE `news_new` RENAME TO `news`;
CREATE UNIQUE INDEX `news_slug_unique` ON `news` (`slug`);

-- 4. BLOGS
CREATE TABLE `blogs_new` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`content` text NOT NULL,
	`image` text DEFAULT 'images/empty-image-placeholder.webp',
	`author_id` text NOT NULL,
	`category` text DEFAULT 'umum' NOT NULL,
	`campaign_id` text,
	`status` text DEFAULT 'draft',
	`viewCount` integer DEFAULT 0,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `blogs_new` SELECT CAST(`id` AS TEXT), `title`, `slug`, `content`, `image`, CAST(`author_id` AS TEXT), `category`, CAST(`campaign_id` AS TEXT), `status`, `viewCount`, `created_at`, `updated_at` FROM `blogs`;
DROP TABLE `blogs`;
ALTER TABLE `blogs_new` RENAME TO `blogs`;
CREATE UNIQUE INDEX `blogs_slug_unique` ON `blogs` (`slug`);

-- 5. DONATIONS
CREATE TABLE `donations_new` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`user_id` text NOT NULL,
	`amount` integer NOT NULL,
	`message` text,
	`paymentStatus` text DEFAULT 'pending',
	`paymentMethod` text NOT NULL,
	`transactionId` text,
	`donorName` text NOT NULL,
	`isAnonymous` integer DEFAULT false,
	`proofOfTransfer` text DEFAULT '',
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`completed_at` integer,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `donations_new` SELECT CAST(`id` AS TEXT), CAST(`campaign_id` AS TEXT), CAST(`user_id` AS TEXT), `amount`, `message`, `paymentStatus`, `paymentMethod`, `transactionId`, `donorName`, `isAnonymous`, `proofOfTransfer`, `created_at`, `completed_at` FROM `donations`;
DROP TABLE `donations`;
ALTER TABLE `donations_new` RENAME TO `donations`;
CREATE UNIQUE INDEX `donations_transactionId_unique` ON `donations` (`transactionId`);

PRAGMA foreign_keys=ON;
