import assert from "node:assert/strict";
import test from "node:test";
import {
  readAuthConfiguration,
  allowedAuthRoutes,
} from "../lib/auth-config.ts";
import {
  createAuthFixture as fixture,
  testAuthEnvironment as input,
  sessionCookie,
} from "./auth-fixture.mjs";

test("auth configuration fails closed without a strong secret and an explicit safe origin", () => {
  assert.equal(readAuthConfiguration({}).google, false);
  assert.equal(
    readAuthConfiguration({ ...input, BETTER_AUTH_SECRET: "short" }).email,
    false,
  );
  for (const origin of [
    "http://legalmate.example",
    "https://user:pass@legalmate.test",
    "https://legalmate.test/path",
    "https://legalmate.test?x=1",
  ]) {
    assert.equal(
      readAuthConfiguration({ ...input, LEGALMATE_PUBLIC_ORIGIN: origin })
        .email,
      false,
    );
  }
  assert.equal(readAuthConfiguration(input).email, true);
  assert.equal(
    readAuthConfiguration({
      ...input,
      LEGALMATE_PUBLIC_ORIGIN: "http://localhost:5173",
    }).email,
    true,
  );
  assert.equal(readAuthConfiguration(input).google, false);
});

test("unused authentication methods are not exposed", () => {
  assert.equal(allowedAuthRoutes.has("POST /sign-in/email"), false);
  assert.equal(allowedAuthRoutes.has("POST /sign-up/email"), false);
  assert.equal(allowedAuthRoutes.has("POST /email-otp/reset-password"), false);
  assert.equal(allowedAuthRoutes.has("POST /link-social"), false);
});

test("email OTP creates a verified identity, stores a hash, rejects replay and revokes session at sign-out", async () => {
  const f = fixture();
  try {
    const email = "worker@example.test";
    const sent = await f.request("/email-otp/send-verification-otp", {
      email,
      type: "sign-in",
    });
    assert.equal(sent.status, 200);
    assert.equal(f.mail.length, 1);
    const otp = f.mail[0].otp;
    const stored = f.sqlite
      .prepare("SELECT identifier, value FROM auth_verification")
      .get();
    assert.equal(stored.value.includes(otp), false);
    assert.equal(stored.identifier.includes(email), false);
    const signedIn = await f.request("/sign-in/email-otp", { email, otp });
    assert.equal(signedIn.status, 200);
    const payload = await signedIn.json();
    assert.equal(payload.user.emailVerified, true);
    assert.match(payload.user.id, /^auth_/);
    const cookie = sessionCookie(signedIn);
    assert.match(signedIn.headers.get("set-cookie"), /HttpOnly/i);
    assert.match(signedIn.headers.get("set-cookie"), /Secure/i);
    assert.match(signedIn.headers.get("set-cookie"), /SameSite=Lax/i);
    const session = await f.auth.api.getSession({
      headers: new Headers({ Cookie: cookie }),
    });
    assert.equal(session.user.id, payload.user.id);
    const spoofed = await f.auth.api.getSession({
      headers: new Headers({
        "oai-authenticated-user-id": payload.user.id,
        "oai-authenticated-user-email": email,
      }),
    });
    assert.equal(spoofed, null);
    const replay = await f.request(
      "/sign-in/email-otp",
      { email, otp },
      { ip: "203.0.113.2" },
    );
    assert.notEqual(replay.status, 200);
    const signOut = await f.request("/sign-out", {}, { cookie });
    assert.equal(signOut.status, 200);
    assert.equal(
      await f.auth.api.getSession({ headers: new Headers({ Cookie: cookie }) }),
      null,
    );
  } finally {
    f.sqlite.close();
  }
});

test("OTP expires and too many wrong attempts invalidate it", async () => {
  const f = fixture();
  try {
    const email = "worker@example.test";
    await f.request("/email-otp/send-verification-otp", {
      email,
      type: "sign-in",
    });
    const otp = f.mail[0].otp;
    const wrong = otp === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) {
      const response = await f.request(
        "/sign-in/email-otp",
        { email, otp: wrong },
        { ip: `203.0.113.${i + 2}` },
      );
      assert.notEqual(response.status, 200);
    }
    const denied = await f.request(
      "/sign-in/email-otp",
      { email, otp },
      { ip: "203.0.113.8" },
    );
    assert.notEqual(denied.status, 200);
    await f.request("/email-otp/send-verification-otp", {
      email,
      type: "sign-in",
    });
    f.sqlite.exec("UPDATE auth_verification SET expires_at = 0");
    const expired = await f.request(
      "/sign-in/email-otp",
      { email, otp: f.mail.at(-1).otp },
      { ip: "203.0.113.9" },
    );
    assert.notEqual(expired.status, 200);
    assert.equal(
      f.sqlite.prepare("SELECT count(*) AS total FROM auth_session").get()
        .total,
      0,
    );
  } finally {
    f.sqlite.close();
  }
});

test("send-code rate limits persist in the database and reject cross-origin requests", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 3; i++) {
      assert.equal(
        (
          await f.request("/email-otp/send-verification-otp", {
            email: `worker${i}@example.test`,
            type: "sign-in",
          })
        ).status,
        200,
      );
    }
    const limited = await f.request("/email-otp/send-verification-otp", {
      email: "worker4@example.test",
      type: "sign-in",
    });
    assert.equal(limited.status, 429);
    assert.ok(
      f.sqlite.prepare("SELECT count(*) AS total FROM auth_rate_limit").get()
        .total > 0,
    );
    const response = await f.auth.handler(
      new Request(
        `${input.LEGALMATE_PUBLIC_ORIGIN}/api/auth/email-otp/send-verification-otp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://attacker.test",
          },
          body: JSON.stringify({
            email: "worker@example.test",
            type: "sign-in",
          }),
        },
      ),
    );
    assert.equal(response.status, 403);
  } finally {
    f.sqlite.close();
  }
});

test("failed email delivery does not report that a code was sent", async () => {
  const f = fixture({ senderFails: true });
  try {
    const response = await f.request("/email-otp/send-verification-otp", {
      email: "worker@example.test",
      type: "sign-in",
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.match(body.message, /could not send/i);
    assert.equal(f.mail.length, 0);
  } finally {
    f.sqlite.close();
  }
});

test("Google requires a fresh verified email and never trusts an unverified linking assertion", () => {
  const f = fixture();
  try {
    const validate = f.auth.options.user.validateUserInfo;
    const source = {
      method: "oauth",
      action: "sign-in",
      oauth: { providerId: "google", profile: { email_verified: false } },
    };
    assert.equal(
      validate({ user: { emailVerified: true }, source }).error,
      "email_not_verified",
    );
    assert.equal(
      validate({
        user: { emailVerified: false },
        source: {
          ...source,
          oauth: { ...source.oauth, profile: { email_verified: true } },
        },
      }).error,
      "email_not_verified",
    );
    assert.equal(
      validate({
        user: { emailVerified: true },
        source: {
          ...source,
          oauth: { ...source.oauth, profile: { email_verified: true } },
        },
      }),
      undefined,
    );
    assert.deepEqual(
      f.auth.options.account.accountLinking.trustedProviders,
      [],
    );
    assert.equal(
      f.auth.options.account.accountLinking.requireLocalEmailVerified,
      true,
    );
  } finally {
    f.sqlite.close();
  }
});
