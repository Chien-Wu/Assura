import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { providers } from "./organisation-schema";

export const providerParticipants = sqliteTable(
  "provider_participants",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id),
    profileJson: text("profile_json").notNull(),
    active: integer("active").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_provider_participants_provider_active").on(
      t.providerId,
      t.active,
    ),
    check("chk_provider_participants_active", sql`${t.active} IN (0,1)`),
    check(
      "chk_provider_participants_profile",
      sql`json_valid(${t.profileJson}) AND json_type(${t.profileJson})='object' AND json_extract(${t.profileJson},'$.id') IS ${t.id}`,
    ),
  ],
);
