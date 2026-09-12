import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const shiftNotes = sqliteTable("shift_notes", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), workerName: text("worker_name").notNull(),
  fields: text("fields_json").notNull(), revision: integer("revision").notNull().default(0),
  status: text("status").notNull().default("draft"), formVersion: text("form_version").notNull(),
  timezone: text("timezone").notNull(), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
  confirmedAt: text("confirmed_at"), confirmationId: text("confirmation_id"), reviewVersion: integer("review_version"),
  confirmationEvidence: text("confirmation_evidence"),
}, table => [index("idx_shift_notes_owner_updated").on(table.ownerId,table.updatedAt)]);

export const voiceSessions = sqliteTable("voice_sessions", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), noteId: text("note_id").notNull(),
  conversationId: text("conversation_id").notNull(), createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(), stateJson: text("state_json").notNull(),
  revision: integer("revision").notNull().default(0),
}, table => [index("idx_voice_sessions_note_owner").on(table.noteId,table.ownerId)]);
