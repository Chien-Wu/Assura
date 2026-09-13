import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { providers } from "./organisations";
import { providerParticipants } from "./participants";

export const scheduledShifts = sqliteTable(
  "scheduled_shifts",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id),
    participantId: text("participant_id")
      .notNull()
      .references(() => providerParticipants.id),
    workerId: text("worker_id").notNull(),
    workerName: text("worker_name").notNull(),
    expectedStart: text("expected_start").notNull(),
    expectedEnd: text("expected_end").notNull(),
    timezone: text("timezone").notNull().default("Australia/Melbourne"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_scheduled_shifts_provider_start").on(
      t.providerId,
      t.expectedStart,
    ),
    index("idx_scheduled_shifts_worker_start").on(t.workerId, t.expectedStart),
    check(
      "chk_scheduled_shift_times",
      sql`${t.expectedEnd}>${t.expectedStart}`,
    ),
  ],
);
