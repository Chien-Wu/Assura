import {
  TEST_ACCOUNTS,
  TEST_PROVIDER_ID,
  TEST_PROVIDER_NAME,
} from "./test-accounts";

// Initial setup for the explicitly enabled, password-protected workflow demo.
// Never changes an existing identity, grant, membership or disabled provider.
export async function initializeWorkflowDemoAccounts(db: D1Database) {
  if (
    await db
      .prepare("SELECT id FROM providers WHERE id=?")
      .bind(TEST_PROVIDER_ID)
      .first()
  )
    return;
  const now = new Date().toISOString();
  const timestamp = Date.parse(now);
  const statements = [
    db
      .prepare(
        "INSERT OR IGNORE INTO providers (id,name,active,created_at) VALUES (?,?,1,?)",
      )
      .bind(TEST_PROVIDER_ID, TEST_PROVIDER_NAME, now),
  ];
  for (const account of TEST_ACCOUNTS) {
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO auth_user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,1,?,?)",
        )
        .bind(account.id, account.name, account.email, timestamp, timestamp),
    );
    if (account.role === "worker") {
      statements.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO app_profiles (user_id,full_name,provider_id,created_at,updated_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM auth_user WHERE id=? AND email=? AND email_verified=1)",
          )
          .bind(
            account.id,
            account.name,
            TEST_PROVIDER_ID,
            now,
            now,
            account.id,
            account.email,
          ),
      );
      statements.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO provider_memberships (provider_id,user_id,active,joined_at,updated_at) SELECT ?,?,1,?,? WHERE EXISTS(SELECT 1 FROM auth_user WHERE id=? AND email=? AND email_verified=1)",
          )
          .bind(
            TEST_PROVIDER_ID,
            account.id,
            now,
            now,
            account.id,
            account.email,
          ),
      );
    } else
      statements.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO provider_manager_grants (id,provider_id,email,active,claimed_user_id,claimed_at,created_at) SELECT ?,?,?,1,?,?,? WHERE EXISTS(SELECT 1 FROM auth_user WHERE id=? AND email=? AND email_verified=1)",
          )
          .bind(
            "grant_test_manager_testprovider",
            TEST_PROVIDER_ID,
            account.email,
            account.id,
            now,
            now,
            account.id,
            account.email,
          ),
      );
  }
  await db.batch(statements);
}
