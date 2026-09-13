CREATE TABLE `workflow_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`state_json` text NOT NULL,
	`revision` integer NOT NULL,
	`last_mutation_id` text NOT NULL,
	`review_revision` integer,
	`reviewed_note_revision` integer,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workflow_case_note` ON `workflow_cases` (`note_id`);--> statement-breakpoint
CREATE TABLE `workflow_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`event_id` text,
	`accepted_revision` integer,
	`error_code` text,
	`attempts` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workflow_receipt_request` ON `workflow_receipts` (`session_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `workflow_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`closed_at` text,
	`conversation_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`version_id` text NOT NULL,
	`tool_calls` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workflow_token` ON `workflow_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_workflow_session_case` ON `workflow_sessions` (`case_id`);