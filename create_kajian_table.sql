CREATE TABLE IF NOT EXISTS `kajians` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`description` text NOT NULL,
	`youtubeLink` text NOT NULL,
	`author_id` text NOT NULL,
	`category` text DEFAULT 'umum' NOT NULL,
	`status` text DEFAULT 'draft',
	`viewCount` integer DEFAULT 0,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS `kajians_slug_unique` ON `kajians` (`slug`);