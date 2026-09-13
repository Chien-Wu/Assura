import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const providers = sqliteTable(
  "providers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    active: integer("active").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (t) => [check("chk_providers_active", sql`${t.active} IN (0, 1)`)],
);
export const appProfiles = sqliteTable("app_profiles", {
  userId: text("user_id").primaryKey(),
  fullName: text("full_name").notNull(),
  providerId: text("provider_id")
    .notNull()
    .references(() => providers.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const providerMemberships = sqliteTable(
  "provider_memberships",
  {
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id),
    userId: text("user_id").notNull(),
    active: integer("active").notNull().default(1),
    joinedAt: text("joined_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.providerId, t.userId] }),
    index("idx_provider_memberships_user").on(t.userId, t.active),
    check("chk_memberships_active", sql`${t.active} IN (0, 1)`),
  ],
);
export const providerManagerGrants = sqliteTable(
  "provider_manager_grants",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id),
    email: text("email").notNull(),
    active: integer("active").notNull().default(1),
    claimedUserId: text("claimed_user_id"),
    claimedAt: text("claimed_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_manager_grants_provider_email").on(t.providerId, t.email),
    index("idx_manager_grants_user").on(t.claimedUserId, t.active),
    check("chk_manager_grants_active", sql`${t.active} IN (0, 1)`),
    check(
      "chk_manager_grants_normalized_email",
      sql`${t.email} = lower(trim(${t.email}))`,
    ),
  ],
);
