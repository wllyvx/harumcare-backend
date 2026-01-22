DROP TABLE `campaign_news`;--> statement-breakpoint
ALTER TABLE `news` ADD `campaign_id` integer REFERENCES campaigns(id);