import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { boundSql } from "./provision-provider.mjs";
import {
  TEST_ACCOUNTS,
  TEST_PROVIDER_ID,
  TEST_PROVIDER_NAME,
} from "../src/lib/auth/test-accounts.ts";

// No password is read, printed, hashed or stored by this operator-only script.
// The login password belongs solely in LEGALMATE_TEST_PASSWORD server secrets.
export function testAccountStatements(now = new Date().toISOString()) {
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp))
    throw new Error("Provide a valid provisioning timestamp.");
  const statements = [
    {
      sql: "INSERT INTO providers (id,name,active,created_at) VALUES (?,?,1,?) ON CONFLICT(id) DO NOTHING",
      params: [TEST_PROVIDER_ID, TEST_PROVIDER_NAME, now],
    },
  ];
  for (const account of TEST_ACCOUNTS) {
    statements.push({
      sql: `INSERT INTO auth_user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,1,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,email_verified=1,updated_at=excluded.updated_at
        WHERE auth_user.email=excluded.email`,
      params: [account.id, account.name, account.email, timestamp, timestamp],
    });
    if (account.role === "worker") {
      statements.push(
        {
          sql: `INSERT INTO app_profiles (user_id,full_name,provider_id,created_at,updated_at)
          SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM auth_user WHERE id=? AND email=? AND email_verified=1)
          ON CONFLICT(user_id) DO UPDATE SET full_name=excluded.full_name,provider_id=excluded.provider_id,updated_at=excluded.updated_at`,
          params: [
            account.id,
            account.name,
            TEST_PROVIDER_ID,
            now,
            now,
            account.id,
            account.email,
          ],
        },
        {
          sql: `INSERT INTO provider_memberships (provider_id,user_id,active,joined_at,updated_at)
          SELECT ?,?,1,?,? WHERE EXISTS (SELECT 1 FROM auth_user WHERE id=? AND email=? AND email_verified=1)
          ON CONFLICT(provider_id,user_id) DO UPDATE SET active=1,updated_at=excluded.updated_at`,
          params: [
            TEST_PROVIDER_ID,
            account.id,
            now,
            now,
            account.id,
            account.email,
          ],
        },
      );
    } else {
      statements.push({
        sql: `INSERT INTO provider_manager_grants (id,provider_id,email,active,claimed_user_id,claimed_at,created_at)
          SELECT ?,?,?,1,?,?,? WHERE EXISTS (SELECT 1 FROM auth_user WHERE id=? AND email=? AND email_verified=1)
          ON CONFLICT(provider_id,email) DO UPDATE SET active=1,claimed_user_id=excluded.claimed_user_id,claimed_at=excluded.claimed_at
          WHERE provider_manager_grants.claimed_user_id IS NULL OR provider_manager_grants.claimed_user_id=excluded.claimed_user_id`,
        params: [
          "grant_test_manager_testprovider",
          TEST_PROVIDER_ID,
          account.email,
          account.id,
          now,
          now,
          account.id,
          account.email,
        ],
      });
    }
  }
  return statements;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const args = process.argv.slice(2);
  if (
    args.length > 1 ||
    (args.length === 1 && !["--sql", "--help"].includes(args[0]))
  ) {
    throw new Error(
      "Use --sql to print provisioning SQL, or no arguments for parameterized JSON. This script does not execute database changes.",
    );
  }
  if (args[0] === "--help") {
    console.log(
      "Usage: node --experimental-strip-types scripts/provision-test-accounts.mjs [--sql]\nPrints test-only provisioning statements. Apply them to the intended database after migrations. Set LEGALMATE_TEST_PASSWORD separately in server secrets. Never use real participant data in TestProvider.",
    );
  } else if (args[0] === "--sql") {
    console.log(testAccountStatements().map(boundSql).join("\n"));
  } else {
    console.log(
      JSON.stringify(
        { providerId: TEST_PROVIDER_ID, statements: testAccountStatements() },
        null,
        2,
      ),
    );
  }
}
