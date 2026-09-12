CREATE TABLE `voice_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`note_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`state_json` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_voice_sessions_note_owner` ON `voice_sessions` (`note_id`,`owner_id`);--> statement-breakpoint
ALTER TABLE `shift_notes` ADD `confirmation_evidence` text;