import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { drizzle } from "drizzle-orm/d1";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { authSchema } from "../db/auth-schema";
import {
  allowedAuthRoutes,
  createAppAuth,
  readAuthConfiguration,
  type AuthEnvironment,
} from "./auth-config";

export type AppUser = {
  userId: string;
  email: string;
  fullName: string | null;
  displayName: string;
};

function authEnvironment(): AuthEnvironment {
  const bindings = env as typeof env & AuthEnvironment;
  const names = [
    "BETTER_AUTH_SECRET",
    "LEGALMATE_PUBLIC_ORIGIN",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "RESEND_API_KEY",
    "LEGALMATE_EMAIL_FROM",
  ] as const;
  return Object.fromEntries(
    names.map((name) => [name, bindings[name] || process.env[name]]),
  );
}

export function getAuthStatus(): { google: boolean; email: boolean } {
  const config = readAuthConfiguration(authEnvironment());
  return {
    google: Boolean(env.DB && config.google),
    email: Boolean(env.DB && config.email),
  };
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
          from: configuration.LEGALMATE_EMAIL_FROM,
          to: [email],
          subject: "Your LegalMate sign-in code",
          text: `Your LegalMate sign-in code is ${otp}. It expires in 5 minutes. If you did not request this code, you can ignore this email.`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("Sign-in email delivery failed.");
    },
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
  return {
    userId: session.user.id,
    email: session.user.email,
    fullName,
    displayName: fullName ?? session.user.email,
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
