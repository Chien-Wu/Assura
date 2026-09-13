import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const shiftAssessments = sqliteTable(
  "shift_assessments",
  {
    id: text("id").primaryKey(),
    noteId: text("note_id").notNull(),
    ownerId: text("owner_id").notNull(),
    sourceRevision: integer("source_revision").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    revision: integer("revision").notNull().default(0),
    status: text("status").notNull(),
    sourceJson: text("source_json").notNull(),
    resultJson: text("result_json"),
    error: text("error"),
    leaseToken: text("lease_token"),
    leaseUntil: text("lease_until"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_assessment_note_revision").on(
      t.noteId,
      t.sourceRevision,
      t.schemaVersion,
    ),
    index("idx_assessment_owner_note").on(t.ownerId, t.noteId),
  ],
);

export const assessmentMessages = sqliteTable(
  "assessment_messages",
  {
    id: text("id").primaryKey(),
    assessmentId: text("assessment_id").notNull(),
    requestId: text("request_id"),
    role: text("role").notNull(),
    text: text("text").notNull(),
    questionId: text("question_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_assessment_answer_request").on(
      t.assessmentId,
      t.requestId,
    ),
    index("idx_assessment_messages_order").on(t.assessmentId, t.createdAt),
  ],
);

export const assessmentRuns = sqliteTable(
  "assessment_runs",
  {
    id: text("id").primaryKey(),
    assessmentId: text("assessment_id").notNull(),
    assessmentRevision: integer("assessment_revision").notNull(),
    model: text("model").notNull(),
    inputJson: text("input_json").notNull(),
    resultJson: text("result_json"),
    status: text("status").notNull(),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (t) => [index("idx_assessment_runs").on(t.assessmentId, t.createdAt)],
);

export const assessmentReviews = sqliteTable(
  "assessment_reviews",
  {
    confirmationId: text("confirmation_id").primaryKey(),
    noteId: text("note_id").notNull(),
    ownerId: text("owner_id").notNull(),
    sourceRevision: integer("source_revision").notNull(),
    assessmentId: text("assessment_id").notNull(),
    assessmentRevision: integer("assessment_revision").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_assessment_review_note").on(t.noteId, t.createdAt)],
);

export const assessmentFindings = sqliteTable(
  "assessment_findings",
  {
    id: text("id").primaryKey(),
    assessmentId: text("assessment_id").notNull(),
    type: text("type").notNull(),
    aiLevel: text("ai_level").notNull(),
    evidenceJson: text("evidence_json").notNull(),
    summary: text("summary").notNull(),
    createdAt: text("created_at").notNull(),
    reviewStatus: text("review_status").notNull().default("open"),
    managerLevel: text("manager_level"),
    reviewRevision: integer("review_revision").notNull().default(0),
    lastActionId: text("last_action_id"),
  },
  (t) => [
    uniqueIndex("idx_finding_assessment_type").on(t.assessmentId, t.type),
    index("idx_finding_status").on(t.reviewStatus, t.createdAt),
  ],
);

export const assessmentManagerActions = sqliteTable(
  "assessment_manager_actions",
  {
    id: text("id").primaryKey(),
    findingId: text("finding_id").notNull(),
    requestId: text("request_id").notNull(),
    requestJson: text("request_json").notNull(),
    actorId: text("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    createdAt: text("created_at").notNull(),
    status: text("status").notNull(),
    managerLevel: text("manager_level"),
    comment: text("comment").notNull(),
    reviewRevision: integer("review_revision").notNull(),
  },
  (t) => [
    uniqueIndex("idx_finding_action_request").on(t.findingId, t.requestId),
    index("idx_finding_action_order").on(t.findingId, t.reviewRevision),
  ],
);
