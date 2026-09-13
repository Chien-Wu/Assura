CREATE TABLE `provider_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`profile_json` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_provider_participants_active" CHECK("provider_participants"."active" IN (0,1)),
	CONSTRAINT "chk_provider_participants_profile" CHECK(json_valid("provider_participants"."profile_json") AND json_type("provider_participants"."profile_json")='object' AND json_extract("provider_participants"."profile_json",'$.id') IS "provider_participants"."id")
);
--> statement-breakpoint
CREATE INDEX `idx_provider_participants_provider_active` ON `provider_participants` (`provider_id`,`active`);--> statement-breakpoint
CREATE TABLE `scheduled_shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`worker_id` text NOT NULL,
	`worker_name` text NOT NULL,
	`expected_start` text NOT NULL,
	`expected_end` text NOT NULL,
	`timezone` text DEFAULT 'Australia/Melbourne' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`participant_id`) REFERENCES `provider_participants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_scheduled_shift_times" CHECK("scheduled_shifts"."expected_end">"scheduled_shifts"."expected_start")
);
--> statement-breakpoint
CREATE INDEX `idx_scheduled_shifts_provider_start` ON `scheduled_shifts` (`provider_id`,`expected_start`);--> statement-breakpoint
CREATE INDEX `idx_scheduled_shifts_worker_start` ON `scheduled_shifts` (`worker_id`,`expected_start`);--> statement-breakpoint
ALTER TABLE `shift_notes` ADD `shift_id` text REFERENCES scheduled_shifts(id);--> statement-breakpoint
ALTER TABLE `shift_notes` ADD `participant_id` text REFERENCES provider_participants(id);--> statement-breakpoint
ALTER TABLE `shift_notes` ADD `participant_snapshot_json` text;--> statement-breakpoint
ALTER TABLE `shift_notes` ADD `expected_start` text;--> statement-breakpoint
ALTER TABLE `shift_notes` ADD `expected_end` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_shift_notes_shift` ON `shift_notes` (`shift_id`);
--> statement-breakpoint
-- Preserve historical attribution, planned times and the profile used for a note.
CREATE TRIGGER protect_note_shift_update BEFORE UPDATE OF shift_id,participant_id,participant_snapshot_json,expected_start,expected_end ON shift_notes
WHEN OLD.shift_id IS NOT NEW.shift_id OR OLD.participant_id IS NOT NEW.participant_id
  OR OLD.participant_snapshot_json IS NOT NEW.participant_snapshot_json
  OR OLD.expected_start IS NOT NEW.expected_start OR OLD.expected_end IS NOT NEW.expected_end
BEGIN SELECT RAISE(ABORT, 'The shift and participant snapshot of a saved note cannot be changed'); END;
--> statement-breakpoint
CREATE TRIGGER validate_note_shift_insert BEFORE INSERT ON shift_notes
WHEN NEW.shift_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM scheduled_shifts AS shift
  WHERE shift.id=NEW.shift_id AND shift.provider_id=NEW.provider_id
    AND shift.participant_id=NEW.participant_id AND shift.worker_id=NEW.owner_id
    AND NEW.expected_start=shift.expected_start AND NEW.expected_end=shift.expected_end
    AND json_extract(NEW.participant_snapshot_json,'$.id')=shift.participant_id
    AND json_extract(NEW.fields_json,'$.participant')=json_extract(NEW.participant_snapshot_json,'$.name')
)
BEGIN SELECT RAISE(ABORT, 'The note must belong to its assigned shift'); END;
--> statement-breakpoint
CREATE TRIGGER protect_note_participant_update BEFORE UPDATE OF fields_json ON shift_notes
WHEN OLD.shift_id IS NOT NULL AND json_extract(OLD.fields_json,'$.participant') IS NOT json_extract(NEW.fields_json,'$.participant')
BEGIN SELECT RAISE(ABORT, 'The participant of a scheduled note cannot be changed'); END;
