import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { authSchema } from "../../db/auth-schema.ts";
import { createAppAuth } from "../../lib/auth-config.ts";
import {
  testAccountScopeQuery,
  testAccountScopeParams,
} from "../../lib/test-accounts.ts";

// This isolated test helper has no network sender and is never imported by the app.
export const testAuthEnvironment = {
  LEGALMATE_PUBLIC_ORIGIN: "https://legalmate.test",
  BETTER_AUTH_SECRET: "a-test-only-auth-secret-with-at-least-32-characters",
  RESEND_API_KEY: "test-only-email-key",
  LEGALMATE_EMAIL_FROM: "LegalMate <signin@example.test>",
};
export function createAuthFixture({
  senderFails = false,
  origin,
  secret,
  testPassword,
} = {}) {
  const input = {
    ...testAuthEnvironment,
    ...(origin ? { LEGALMATE_PUBLIC_ORIGIN: origin } : {}),
    ...(secret ? { BETTER_AUTH_SECRET: secret } : {}),
    ...(testPassword ? { LEGALMATE_TEST_PASSWORD: testPassword } : {}),
  };
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    readFileSync(
      new URL("../../drizzle/0003_auth.sql", import.meta.url),
      "utf8",
    ),
  );
  const db = drizzle(
    async (sql, parameters, method) => {
      const statement = sqlite.prepare(sql);
      if (method === "run") {
        statement.run(...parameters);
        return { rows: [] };
      }
      return {
        rows: statement.all(...parameters).map((row) => Object.values(row)),
      };
    },
    { schema: authSchema },
  );
  const mail = [];
  const auth = createAppAuth(
    input,
    drizzleAdapter(db, { provider: "sqlite", schema: authSchema }),
    async (email, otp) => {
      if (senderFails) throw new Error("test sender failed");
      mail.push({ email, otp });
    },
    async (account) =>
      Boolean(
        sqlite
          .prepare(testAccountScopeQuery)
          .get(...testAccountScopeParams(account)),
      ),
  );
  async function request(path, body, { cookie, ip = "203.0.113.1" } = {}) {
    return auth.handler(
      new Request(`${input.LEGALMATE_PUBLIC_ORIGIN}/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          Origin: input.LEGALMATE_PUBLIC_ORIGIN,
          "cf-connecting-ip": ip,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  }
  return { sqlite, auth, mail, request };
}

export function sessionCookie(response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}

export async function signInFixture(
  fixture,
  email,
  name = "Test Support Worker",
) {
  assert.equal(
    (
      await fixture.request("/email-otp/send-verification-otp", {
        email,
        type: "sign-in",
      })
    ).status,
    200,
  );
  const code = fixture.mail.findLast((message) => message.email === email)?.otp;
  assert.ok(code);
  const response = await fixture.request("/sign-in/email-otp", {
    email,
    otp: code,
    name,
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const userRow = fixture.sqlite
    .prepare("SELECT * FROM auth_user WHERE id = ?")
    .get(payload.user.id);
  const sessionRow = fixture.sqlite
    .prepare(
      "SELECT * FROM auth_session WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(payload.user.id);
  // Seed these exact rows into an isolated integration DB configured with the same
  // test origin/secret; the cookie then exercises the app's normal auth path.
  return {
    cookie: sessionCookie(response),
    user: payload.user,
    userRow,
    sessionRow,
  };
}
