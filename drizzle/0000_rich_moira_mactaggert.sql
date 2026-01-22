CREATE TABLE `blogs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`content` text NOT NULL,
	`image` text DEFAULT 'images/empty-image-placeholder.webp',
	`author_id` integer NOT NULL,
	`category` text DEFAULT 'umum' NOT NULL,
	`campaign_id` integer,
	`status` text DEFAULT 'draft',
	`viewCount` integer DEFAULT 0,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blogs_slug_unique` ON `blogs` (`slug`);--> statement-breakpoint
CREATE TABLE `campaign_news` (
	`campaign_id` integer NOT NULL,
	`news_id` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `news_id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`news_id`) REFERENCES `news`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
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
--> statement-breakpoint
CREATE TABLE `donations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` integer NOT NULL,
	`user_id` integer NOT NULL,
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
--> statement-breakpoint
CREATE UNIQUE INDEX `donations_transactionId_unique` ON `donations` (`transactionId`);--> statement-breakpoint
CREATE TABLE `news` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`content` text NOT NULL,
	`image` text DEFAULT 'images/empty-image-placeholder.webp',
	`author_id` integer NOT NULL,
	`category` text DEFAULT 'umum' NOT NULL,
	`status` text DEFAULT 'draft',
	`viewCount` integer DEFAULT 0,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_slug_unique` ON `news` (`slug`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
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
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);