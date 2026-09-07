ALTER TABLE `users` ADD COLUMN `google_id` text UNIQUE;
ALTER TABLE `users` ADD COLUMN `auth_provider` text DEFAULT 'local';
