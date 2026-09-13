CREATE TABLE `assessment_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`assessment_id` text NOT NULL,
	`type` text NOT NULL,
	`ai_level` text NOT NULL,
	`evidence_json` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL,
	`review_status` text DEFAULT 'open' NOT NULL,
	`manager_level` text,
	`review_revision` integer DEFAULT 0 NOT NULL,
	`last_action_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finding_assessment_type` ON `assessment_findings` (`assessment_id`,`type`);--> statement-breakpoint
CREATE INDEX `idx_finding_status` ON `assessment_findings` (`review_status`,`created_at`);--> statement-breakpoint
CREATE TABLE `assessment_manager_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`finding_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_json` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`created_at` text NOT NULL,
	`status` text NOT NULL,
	`manager_level` text,
	`comment` text NOT NULL,
	`review_revision` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finding_action_request` ON `assessment_manager_actions` (`finding_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_finding_action_order` ON `assessment_manager_actions` (`finding_id`,`review_revision`);--> statement-breakpoint
DROP INDEX `idx_assessment_note_revision`;--> statement-breakpoint
ALTER TABLE `shift_assessments` ADD `schema_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_assessment_note_revision` ON `shift_assessments` (`note_id`,`source_revision`,`schema_version`);
--> statement-breakpoint
CREATE TRIGGER protect_assessment_schema_update BEFORE UPDATE OF schema_version ON shift_assessments
BEGIN SELECT RAISE(ABORT, 'Assessment schema versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER validate_assessment_finding_insert BEFORE INSERT ON assessment_findings
WHEN NEW.ai_level NOT IN ('P1','P2','P3','P4') OR NEW.type NOT IN ('incident_safeguarding','health_medication','behaviour_restrictive_practice','complaint','service_exception') OR NOT EXISTS (SELECT 1 FROM shift_assessments a WHERE a.id=NEW.assessment_id AND a.schema_version=2 AND a.status='ready')
BEGIN SELECT RAISE(ABORT, 'Findings require a published risk assessment'); END;
--> statement-breakpoint
CREATE TRIGGER protect_assessment_finding_original BEFORE UPDATE OF id,assessment_id,type,ai_level,evidence_json,summary,created_at ON assessment_findings
BEGIN SELECT RAISE(ABORT, 'Original AI findings are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER protect_assessment_finding_delete BEFORE DELETE ON assessment_findings
BEGIN SELECT RAISE(ABORT, 'AI findings are retained for review'); END;
--> statement-breakpoint
CREATE TRIGGER protect_assessment_manager_action_update BEFORE UPDATE ON assessment_manager_actions
BEGIN SELECT RAISE(ABORT, 'Manager actions are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER protect_assessment_manager_action_delete BEFORE DELETE ON assessment_manager_actions
BEGIN SELECT RAISE(ABORT, 'Manager actions are append-only'); END;
