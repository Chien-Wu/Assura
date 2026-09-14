import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { headers } from "next/headers";
import { authSchema } from "../../../database/schema/auth";
import {
  allowedAuthRoutes,
  createAppAuth,
  readAuthConfiguration,
  type AuthEnvironment,
} from "./config";
import { initializeWorkflowDemoAccounts } from "./test-account-seed";
import { readAssuraSetting } from "../shared/environment";
import {
  getTestAccountByIdentity,
  isReservedTestEmail,
  testAccountScopeParams,
  testAccountScopeQuery,
} from "./test-accounts";

type AppUser = {
  userId: string;
  email: string;
  fullName: string | null;
  displayName: string;
  displayEmail?: string;
};

function authEnvironment(): AuthEnvironment {
  const bindings = env as typeof env & AuthEnvironment;
  const names = [
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "RESEND_API_KEY",
  ] as const;
  return {
    ...Object.fromEntries(
      names.map((name) => [name, bindings[name] || process.env[name]]),
    ),
    ASSURA_PUBLIC_ORIGIN: readAssuraSetting(
      "PUBLIC_ORIGIN",
      bindings,
      process.env,
    ),
    ASSURA_EMAIL_FROM: readAssuraSetting("EMAIL_FROM", bindings, process.env),
    ASSURA_TEST_PASSWORD: readAssuraSetting(
      "TEST_PASSWORD",
      bindings,
      process.env,
    ),
  };
}

export function getAuthStatus(): {
  google: boolean;
  email: boolean;
  testAccounts: boolean;
} {
  const config = readAuthConfiguration(authEnvironment());
  return {
    google: Boolean(env.DB && config.google),
    email: Boolean(env.DB && config.email),
    testAccounts: Boolean(env.DB && config.testAccounts),
  };
}

export function getTestAccountPrefillPassword(): string {
  const configuration = authEnvironment();
  if (!env.DB || !readAuthConfiguration(configuration).testAccounts) return "";
  // Shared demo credentials are intentionally prefilled for all visitors.
  // Only the fixed test-account password is sent to the entry form.
  return configuration.ASSURA_TEST_PASSWORD ?? "";
}

function getAuth() {
  if (!env.DB) return null;
  const configuration = authEnvironment();
  return createAppAuth(
    configuration,
    drizzleAdapter(drizzle(env.DB, { schema: authSchema }), {
      provider: "sqlite",
      schema: authSchema,
      transaction: false,
    }),
    async (email, otp) => {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${configuration.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: configuration.ASSURA_EMAIL_FROM,
          to: [email],
          subject: "Your Assura sign-in code",
          text: `Your Assura sign-in code is ${otp}. It expires in 5 minutes. If you did not request this code, you can ignore this email.`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("Sign-in email delivery failed.");
    },
    async (account) =>
      Boolean(
        await env
          .DB!.prepare(testAccountScopeQuery)
          .bind(...testAccountScopeParams(account))
          .first(),
      ),
    readAssuraSetting("WORKFLOW_ENABLED", env, process.env) === "true"
      ? () => initializeWorkflowDemoAccounts(env.DB!)
      : undefined,
  );
}

export async function getAppUser(
  requestHeaders?: Headers,
): Promise<AppUser | null> {
  const auth = getAuth();
  if (!auth) return null;
  // Only a signed, database-backed session establishes an identity. In particular,
  // legacy oai-authenticated-* request headers are never used for authentication.
  const session = await auth.api.getSession({
    headers: requestHeaders ?? (await headers()),
  });
  if (!session?.user.emailVerified) return null;
  const fullName = session.user.name.trim() || null;
  const testAccount = getTestAccountByIdentity(session.user);
  if (isReservedTestEmail(session.user.email) && !testAccount) return null;
  if (
    testAccount &&
    (!authEnvironment().ASSURA_TEST_PASSWORD ||
      !(await env
        .DB!.prepare(testAccountScopeQuery)
        .bind(...testAccountScopeParams(testAccount))
        .first()))
  )
    return null;
  return {
    userId: session.user.id,
    email: session.user.email,
    fullName,
    displayName: fullName ?? session.user.email,
    ...(testAccount ? { displayEmail: testAccount.alias } : {}),
  };
}

export async function handleAuthRequest(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname.replace(/^\/api\/auth/, "");
  if (!allowedAuthRoutes.has(`${request.method} ${pathname}`)) {
    return Response.json(
      { message: "This sign-in method is not available." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  const auth = getAuth();
  if (!auth)
    return Response.json(
      {
        code: "AUTH_NOT_CONFIGURED",
        message: "Sign-in is being set up. Please try again later.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  try {
    const response = await auth.handler(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return Response.json(
      {
        message:
          "Sign-in is temporarily unavailable. Please try again shortly.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
