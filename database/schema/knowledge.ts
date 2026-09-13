import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// knowledge_fts is a virtual FTS5 table managed by migration 0006 and triggers.
export const retrievalRuns = sqliteTable(
  "retrieval_runs",
  {
    id: text("id").primaryKey(),
    noteId: text("note_id").notNull(),
    ownerId: text("owner_id").notNull(),
    sessionId: text("session_id"),
    query: text("query").notNull(),
    noteRevision: integer("note_revision").notNull(),
    transcriptCursor: integer("transcript_cursor").notNull(),
    sourcesJson: text("sources_json").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_retrieval_runs_note_owner").on(
      table.noteId,
      table.ownerId,
      table.createdAt,
    ),
  ],
);
