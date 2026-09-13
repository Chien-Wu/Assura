import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// These are interview questions, not a care-task or clinical outcome ledger.
export const interviewQuestions = sqliteTable(
  "interview_questions",
  {
    id: text("id").primaryKey(),
    noteId: text("note_id").notNull(),
    ownerId: text("owner_id").notNull(),
    sessionId: text("session_id").notNull(),
    retrievalId: text("retrieval_id").notNull(),
    purposeKey: text("purpose_key").notNull(),
    questionText: text("question_text").notNull(),
    questionKey: text("question_key").notNull(),
    sourceIdsJson: text("source_ids_json").notNull(),
    status: text("status").notNull().default("proposed"),
    noteRevision: integer("note_revision").notNull(),
    transcriptCursor: integer("transcript_cursor").notNull(),
    emittedEventId: text("emitted_event_id"),
    answerEventId: text("answer_event_id"),
    answerQuote: text("answer_quote"),
    revision: integer("revision").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_interview_note_created").on(t.noteId, t.createdAt),
    uniqueIndex("idx_interview_active_purpose")
      .on(t.noteId, t.purposeKey)
      .where(sql`${t.status} != 'cancelled'`),
    uniqueIndex("idx_interview_active_question")
      .on(t.noteId, t.questionKey)
      .where(sql`${t.status} != 'cancelled'`),
  ],
);

export const interviewQuestionEvents = sqliteTable(
  "interview_question_events",
  {
    id: text("id").primaryKey(),
    questionId: text("question_id").notNull(),
    eventType: text("event_type").notNull(),
    transcriptEventId: text("transcript_event_id"),
    detailsJson: text("details_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_interview_events_question").on(t.questionId, t.createdAt)],
);
