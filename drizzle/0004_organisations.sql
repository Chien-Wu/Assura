CREATE TABLE providers (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE TABLE app_profiles (
  user_id TEXT PRIMARY KEY NOT NULL,
  full_name TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE provider_memberships (
  provider_id TEXT NOT NULL REFERENCES providers(id),
  user_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  joined_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(provider_id,user_id)
);
CREATE INDEX idx_provider_memberships_user ON provider_memberships(user_id,active);
CREATE TABLE provider_manager_grants (
  id TEXT PRIMARY KEY NOT NULL,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  email TEXT NOT NULL CHECK (email=lower(trim(email))),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  claimed_user_id TEXT,
  claimed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_manager_grants_provider_email ON provider_manager_grants(provider_id,email);
CREATE INDEX idx_manager_grants_user ON provider_manager_grants(claimed_user_id,active);
ALTER TABLE shift_notes ADD COLUMN provider_id TEXT REFERENCES providers(id);
CREATE INDEX idx_shift_notes_provider_updated ON shift_notes(provider_id,updated_at);
-- Existing notes stay unassigned. Neither onboarding nor this migration moves
-- legacy records or changes their authors or append-only evidence.
CREATE TRIGGER protect_note_provider_update BEFORE UPDATE OF provider_id ON shift_notes
WHEN OLD.provider_id IS NOT NEW.provider_id
BEGIN SELECT RAISE(ABORT, 'The service provider of a saved note cannot be changed'); END;
