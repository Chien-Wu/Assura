import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { providers } from "./organisation-schema";
import { providerParticipants } from "./roster-schema";
import { scheduledShifts } from "./shift-schema";
export * from "./organisation-schema";
export * from "./roster-schema";
export * from "./shift-schema";
export * from "./knowledge-schema";
export * from "./interview-schema";
export * from "./assessment-schema";
export * from "./workflow-schema";
export {
  authUser,
  authSession,
  authAccount,
  authVerification,
  authRateLimit,
} from "./auth-schema";
export const shiftNotes = sqliteTable(
  "shift_notes",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    providerId: text("provider_id").references(() => providers.id),
    shiftId: text("shift_id").references(() => scheduledShifts.id),
    participantId: text("participant_id").references(
      () => providerParticipants.id,
    ),
    participantSnapshotJson: text("participant_snapshot_json"),
    expectedStart: text("expected_start"),
    expectedEnd: text("expected_end"),
    workerName: text("worker_name").notNull(),
    fields: text("fields_json").notNull(),
    revision: integer("revision").notNull().default(0),
    status: text("status").notNull().default("draft"),
    formVersion: text("form_version").notNull(),
    timezone: text("timezone").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    confirmedAt: text("confirmed_at"),
    confirmationId: text("confirmation_id"),
    reviewVersion: integer("review_version"),
    confirmationEvidence: text("confirmation_evidence"),
    safetyJson: text("safety_json").notNull().default("{}"),
    mutationId: text("mutation_id"),
    retentionUntil: text("retention_until"),
  },
  (table) => [
    uniqueIndex("idx_shift_notes_shift").on(table.shiftId),
    index("idx_shift_notes_owner_updated").on(table.ownerId, table.updatedAt),
    index("idx_shift_notes_provider_updated").on(
      table.providerId,
      table.updatedAt,
    ),
  ],
);

export const voiceSessions = sqliteTable(
  "voice_sessions",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    noteId: text("note_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    stateJson: text("state_json").notNull(),
    revision: integer("revision").notNull().default(0),
  },
  (table) => [
    index("idx_voice_sessions_note_owner").on(table.noteId, table.ownerId),
  ],
);

export const transcriptEvents = sqliteTable(
  "transcript_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    noteId: text("note_id").notNull(),
    ownerId: text("owner_id").notNull(),
    sequence: integer("sequence").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    receivedAt: text("received_at").notNull(),
    questionCount: integer("question_count").notNull().default(0),
  },
  (t) => [index("idx_transcript_note_sequence").on(t.noteId, t.receivedAt)],
);
export const noteChanges = sqliteTable(
  "note_changes",
  {
    id: text("id").primaryKey(),
    noteId: text("note_id").notNull(),
    ownerId: text("owner_id").notNull(),
    revision: integer("revision").notNull(),
    field: text("field").notNull(),
    before: text("before_value").notNull(),
    after: text("after_value").notNull(),
    actor: text("actor").notNull(),
    source: text("source").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_changes_note_revision").on(t.noteId, t.revision)],
);
export const noteSnapshots = sqliteTable("note_snapshots", {
  noteId: text("note_id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  snapshot: text("snapshot_json").notNull(),
  createdAt: text("created_at").notNull(),
});
export const riskEvents = sqliteTable(
  "risk_events",
  {
    id: text("id").primaryKey(),
    noteId: text("note_id").notNull(),
    ownerId: text("owner_id").notNull(),
    code: text("code").notNull(),
    category: text("category").notNull(),
    data: text("data_json").notNull(),
    capturedAt: text("captured_at").notNull(),
    inboxAt: text("inbox_at"),
  },
  (t) => [
    index("idx_risk_owner_capture").on(t.ownerId, t.capturedAt),
    index("idx_risk_note").on(t.noteId),
  ],
);
export const riskActions = sqliteTable(
  "risk_actions",
  {
    id: text("id").primaryKey(),
    riskId: text("risk_id").notNull(),
    ownerId: text("owner_id").notNull(),
    action: text("action").notNull(),
    details: text("details_json").notNull(),
    actor: text("actor").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_risk_actions_risk").on(t.riskId, t.createdAt)],
);
