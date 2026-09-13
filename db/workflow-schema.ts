import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const workflowCases = sqliteTable(
  "workflow_cases",
  {
    id: text("id").primaryKey(),
    noteId: text("note_id").notNull(),
    ownerId: text("owner_id").notNull(),
    stateJson: text("state_json").notNull(),
    revision: integer("revision").notNull(),
    lastMutationId: text("last_mutation_id").notNull(),
    reviewRevision: integer("review_revision"),
    reviewedNoteRevision: integer("reviewed_note_revision"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("idx_workflow_case_note").on(t.noteId)],
);

export const workflowSessions = sqliteTable(
  "workflow_sessions",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    ownerId: text("owner_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    closedAt: text("closed_at"),
    conversationId: text("conversation_id").notNull(),
    agentId: text("agent_id").notNull(),
    versionId: text("version_id").notNull(),
    toolCalls: integer("tool_calls").notNull().default(0),
  },
  (t) => [
    uniqueIndex("idx_workflow_token").on(t.tokenHash),
    index("idx_workflow_session_case").on(t.caseId),
  ],
);

export const workflowReceipts = sqliteTable(
  "workflow_receipts",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    eventId: text("event_id"),
    acceptedRevision: integer("accepted_revision"),
    errorCode: text("error_code"),
    attempts: integer("attempts").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_workflow_receipt_request").on(t.sessionId, t.fingerprint),
  ],
);
