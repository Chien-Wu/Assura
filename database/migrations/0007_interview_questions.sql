CREATE TABLE interview_questions (
  id TEXT PRIMARY KEY NOT NULL,
  note_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  retrieval_id TEXT NOT NULL,
  purpose_key TEXT NOT NULL,
  question_text TEXT NOT NULL,
  question_key TEXT NOT NULL,
  source_ids_json TEXT NOT NULL CHECK(json_valid(source_ids_json)),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','emitted','answered','unknown','cancelled')),
  note_revision INTEGER NOT NULL,
  transcript_cursor INTEGER NOT NULL,
  emitted_event_id TEXT,
  answer_event_id TEXT,
  answer_quote TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_interview_note_created ON interview_questions(note_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_interview_active_purpose ON interview_questions(note_id,purpose_key) WHERE status!='cancelled';
--> statement-breakpoint
CREATE UNIQUE INDEX idx_interview_active_question ON interview_questions(note_id,question_key) WHERE status!='cancelled';
--> statement-breakpoint
CREATE TABLE interview_question_events (
  id TEXT PRIMARY KEY NOT NULL,
  question_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  transcript_event_id TEXT,
  details_json TEXT NOT NULL CHECK(json_valid(details_json)),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_interview_events_question ON interview_question_events(question_id,created_at);
--> statement-breakpoint
CREATE TRIGGER validate_interview_source_insert BEFORE INSERT ON interview_questions
WHEN NOT EXISTS (
  SELECT 1 FROM retrieval_runs r JOIN shift_notes n ON n.id=r.note_id
  JOIN voice_sessions v ON v.id=NEW.session_id AND v.note_id=n.id AND v.owner_id=n.owner_id
  WHERE r.id=NEW.retrieval_id AND r.note_id=NEW.note_id AND r.owner_id=NEW.owner_id
    AND n.owner_id=NEW.owner_id AND n.revision=NEW.note_revision AND n.status='draft'
)
BEGIN SELECT RAISE(ABORT, 'Interview question must belong to the retrieved draft'); END;
--> statement-breakpoint
CREATE TRIGGER protect_interview_event_update BEFORE UPDATE ON interview_question_events
BEGIN SELECT RAISE(ABORT, 'Interview question events are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER protect_interview_event_delete BEFORE DELETE ON interview_question_events
BEGIN SELECT RAISE(ABORT, 'Interview question events are append-only'); END;
