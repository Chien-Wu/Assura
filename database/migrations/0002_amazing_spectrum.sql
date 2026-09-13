CREATE TABLE `note_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`field` text NOT NULL,
	`before_value` text NOT NULL,
	`after_value` text NOT NULL,
	`actor` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_changes_note_revision` ON `note_changes` (`note_id`,`revision`);--> statement-breakpoint
CREATE TABLE `note_snapshots` (
	`note_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `risk_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`risk_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`action` text NOT NULL,
	`details_json` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_risk_actions_risk` ON `risk_actions` (`risk_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `risk_events` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`code` text NOT NULL,
	`category` text NOT NULL,
	`data_json` text NOT NULL,
	`captured_at` text NOT NULL,
	`inbox_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_risk_owner_capture` ON `risk_events` (`owner_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `idx_risk_note` ON `risk_events` (`note_id`);--> statement-breakpoint
CREATE TABLE `transcript_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`note_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`received_at` text NOT NULL,
	`question_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_transcript_note_sequence` ON `transcript_events` (`note_id`,`received_at`);--> statement-breakpoint
ALTER TABLE `shift_notes` ADD `safety_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `shift_notes` ADD `mutation_id` text;--> statement-breakpoint
ALTER TABLE `shift_notes` ADD `retention_until` text;
--> statement-breakpoint
CREATE TRIGGER protect_transcript_events_update BEFORE UPDATE ON transcript_events BEGIN SELECT RAISE(ABORT, 'Append-only evidence cannot be changed or deleted'); END;

--> statement-breakpoint
CREATE TRIGGER protect_transcript_events_delete BEFORE DELETE ON transcript_events BEGIN SELECT RAISE(ABORT, 'Append-only evidence cannot be changed or deleted'); END;

--> statement-breakpoint
CREATE TRIGGER protect_note_changes_update BEFORE UPDATE ON note_changes BEGIN SELECT RAISE(ABORT, 'Append-only evidence cannot be changed or deleted'); END;

--> statement-breakpoint
CREATE TRIGGER protect_note_changes_delete BEFORE DELETE ON note_changes BEGIN SELECT RAISE(ABORT, 'Append-only evidence cannot be changed or deleted'); END;

--> statement-breakpoint
CREATE TRIGGER protect_note_snapshots_update BEFORE UPDATE ON note_snapshots BEGIN SELECT RAISE(ABORT, 'Append-only evidence cannot be changed or deleted'); END;

--> statement-breakpoint
CREATE TRIGGER protect_note_snapshots_delete BEFORE DELETE ON note_snapshots BEGIN SELECT RAISE(ABORT, 'Append-only evidence cannot be changed or deleted'); END;

--> statement-breakpoint
CREATE TRIGGER protect_risk_events_update BEFORE UPDATE ON risk_events BEGIN SELECT RAISE(ABORT, 'Append-only evidence cannot be changed or deleted'); END;

--> statement-breakpoint
CREATE TRIGGER protect_risk_events_delete BEFORE DELETE ON risk_events BEGIN SELECT RAISE(ABORT, 'Append-only evidence cannot be changed or deleted'); END;

--> statement-breakpoint
CREATE TRIGGER protect_risk_actions_update BEFORE UPDATE ON risk_actions BEGIN SELECT RAISE(ABORT, 'Append-only evidence cannot be changed or deleted'); END;

--> statement-breakpoint
CREATE TRIGGER protect_risk_actions_delete BEFORE DELETE ON risk_actions BEGIN SELECT RAISE(ABORT, 'Append-only evidence cannot be changed or deleted'); END;
