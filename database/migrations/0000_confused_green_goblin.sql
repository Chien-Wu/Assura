CREATE TABLE `shift_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`worker_name` text NOT NULL,
	`fields_json` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`form_version` text NOT NULL,
	`timezone` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`confirmed_at` text,
	`confirmation_id` text,
	`review_version` integer
);
--> statement-breakpoint
CREATE INDEX `idx_shift_notes_owner_updated` ON `shift_notes` (`owner_id`,`updated_at`);