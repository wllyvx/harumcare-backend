CREATE TABLE `consultation_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`consultation_id` text NOT NULL,
	`content` text NOT NULL,
	`author_id` text NOT NULL,
	`is_admin_reply` integer DEFAULT false,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`consultation_id`) REFERENCES `consultations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `consultations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`category` text NOT NULL,
	`author_id` text,
	`author_name` text,
	`author_email` text,
	`is_anonymous` integer DEFAULT false,
	`status` text DEFAULT 'pending',
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
