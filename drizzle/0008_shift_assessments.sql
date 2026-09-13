CREATE TABLE `assessment_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`assessment_id` text NOT NULL,
	`request_id` text,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`question_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_assessment_answer_request` ON `assessment_messages` (`assessment_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_assessment_messages_order` ON `assessment_messages` (`assessment_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `assessment_reviews` (
	`confirmation_id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`assessment_id` text NOT NULL,
	`assessment_revision` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_assessment_review_note` ON `assessment_reviews` (`note_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `assessment_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`assessment_id` text NOT NULL,
	`assessment_revision` integer NOT NULL,
	`model` text NOT NULL,
	`input_json` text NOT NULL,
	`result_json` text,
	`status` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_assessment_runs` ON `assessment_runs` (`assessment_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `shift_assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`source_json` text NOT NULL,
	`result_json` text,
	`error` text,
	`lease_token` text,
	`lease_until` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_assessment_note_revision` ON `shift_assessments` (`note_id`,`source_revision`);--> statement-breakpoint
CREATE INDEX `idx_assessment_owner_note` ON `shift_assessments` (`owner_id`,`note_id`);
--> statement-breakpoint
CREATE TRIGGER validate_assessment_source_insert BEFORE INSERT ON shift_assessments
WHEN NOT EXISTS (SELECT 1 FROM shift_notes WHERE id=NEW.note_id AND owner_id=NEW.owner_id AND revision=NEW.source_revision AND status='draft')
BEGIN SELECT RAISE(ABORT, 'Assessment must belong to the current draft'); END;
--> statement-breakpoint
CREATE TRIGGER protect_assessment_source_update BEFORE UPDATE OF note_id,owner_id,source_revision,source_json ON shift_assessments
BEGIN SELECT RAISE(ABORT, 'Assessment source snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER protect_assessment_message_update BEFORE UPDATE ON assessment_messages
BEGIN SELECT RAISE(ABORT, 'Assessment messages are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER protect_assessment_message_delete BEFORE DELETE ON assessment_messages
BEGIN SELECT RAISE(ABORT, 'Assessment messages are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER protect_assessment_review_update BEFORE UPDATE ON assessment_reviews
BEGIN SELECT RAISE(ABORT, 'Assessment review bindings are immutable'); END;
