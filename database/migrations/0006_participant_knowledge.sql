CREATE VIRTUAL TABLE knowledge_fts USING fts5(note_id UNINDEXED, revision UNINDEXED, content, tokenize='porter unicode61');
--> statement-breakpoint
CREATE TRIGGER knowledge_note_insert AFTER INSERT ON shift_notes
WHEN NEW.status='complete' AND NEW.confirmed_at IS NOT NULL AND json_valid(NEW.fields_json)
BEGIN
  INSERT INTO knowledge_fts(note_id,revision,content) VALUES (NEW.id,NEW.revision,
    COALESCE(json_extract(NEW.fields_json,'$.activities'),'') || char(10) ||
    COALESCE(json_extract(NEW.fields_json,'$.supportProvided'),'') || char(10) ||
    COALESCE(json_extract(NEW.fields_json,'$.participantResponse'),'') || char(10) ||
    COALESCE(json_extract(NEW.fields_json,'$.goalProgress'),'') || char(10) ||
    COALESCE(json_extract(NEW.fields_json,'$.incidentDetails'),'') || char(10) ||
    COALESCE(json_extract(NEW.fields_json,'$.followUpDetails'),''));
END;
--> statement-breakpoint
CREATE TRIGGER knowledge_note_update AFTER UPDATE ON shift_notes
BEGIN
  DELETE FROM knowledge_fts WHERE note_id=OLD.id;
  INSERT INTO knowledge_fts(note_id,revision,content)
  SELECT NEW.id,NEW.revision,
    COALESCE(json_extract(NEW.fields_json,'$.activities'),'') || char(10) ||
    COALESCE(json_extract(NEW.fields_json,'$.supportProvided'),'') || char(10) ||
    COALESCE(json_extract(NEW.fields_json,'$.participantResponse'),'') || char(10) ||
    COALESCE(json_extract(NEW.fields_json,'$.goalProgress'),'') || char(10) ||
    COALESCE(json_extract(NEW.fields_json,'$.incidentDetails'),'') || char(10) ||
    COALESCE(json_extract(NEW.fields_json,'$.followUpDetails'),'')
  WHERE NEW.status='complete' AND NEW.confirmed_at IS NOT NULL AND json_valid(NEW.fields_json);
END;
--> statement-breakpoint
CREATE TRIGGER knowledge_note_delete AFTER DELETE ON shift_notes
BEGIN DELETE FROM knowledge_fts WHERE note_id=OLD.id; END;
--> statement-breakpoint
INSERT INTO knowledge_fts(note_id,revision,content)
SELECT id,revision,
  COALESCE(json_extract(fields_json,'$.activities'),'') || char(10) ||
  COALESCE(json_extract(fields_json,'$.supportProvided'),'') || char(10) ||
  COALESCE(json_extract(fields_json,'$.participantResponse'),'') || char(10) ||
  COALESCE(json_extract(fields_json,'$.goalProgress'),'') || char(10) ||
  COALESCE(json_extract(fields_json,'$.incidentDetails'),'') || char(10) ||
  COALESCE(json_extract(fields_json,'$.followUpDetails'),'')
FROM shift_notes WHERE status='complete' AND confirmed_at IS NOT NULL AND json_valid(fields_json);
--> statement-breakpoint
CREATE TABLE retrieval_runs (
  id text PRIMARY KEY NOT NULL,
  note_id text NOT NULL,
  owner_id text NOT NULL,
  session_id text,
  query text NOT NULL,
  note_revision integer NOT NULL,
  transcript_cursor integer NOT NULL,
  sources_json text NOT NULL CHECK(json_valid(sources_json)),
  status text NOT NULL,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_retrieval_runs_note_owner ON retrieval_runs(note_id,owner_id,created_at);
