import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import {
  testAccountPlugin,
  type CheckTestAccountScope,
} from "./test-account-plugin.ts";
import { isReservedTestEmail } from "./test-accounts.ts";

export type AuthEnvironment = {
  BETTER_AUTH_SECRET?: string;
  LEGALMATE_PUBLIC_ORIGIN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  LEGALMATE_EMAIL_FROM?: string;
  LEGALMATE_TEST_PASSWORD?: string;
};

export function readAuthConfiguration(input: AuthEnvironment) {
  let origin: string | null = null;
  try {
    const url = new URL(input.LEGALMATE_PUBLIC_ORIGIN ?? "");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol === "https:" || (local && url.protocol === "http:")) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
    )
      origin = url.origin;
  } catch {
    /* A missing or malformed origin disables authentication. */
  }
  const secret = input.BETTER_AUTH_SECRET?.trim();
  const configured = Boolean(origin && secret && secret.length >= 32);
  return {
    origin,
    secret: configured ? secret! : null,
    testAccounts: configured && Boolean(input.LEGALMATE_TEST_PASSWORD),
    google:
      configured &&
      Boolean(
        input.GOOGLE_CLIENT_ID?.trim() && input.GOOGLE_CLIENT_SECRET?.trim(),
      ),
    email:
      configured &&
      Boolean(
        input.RESEND_API_KEY?.trim() && input.LEGALMATE_EMAIL_FROM?.trim(),
      ),
  };
}

type SendSignInCode = (email: string, otp: string) => Promise<void>;

export function createAppAuth(
  input: AuthEnvironment,
  database: BetterAuthOptions["database"],
  sendSignInCode: SendSignInCode,
  checkTestAccountScope: CheckTestAccountScope = async () => false,
  initializeDemo?: () => Promise<void>,
) {
  const config = readAuthConfiguration(input);
  if (!config.origin || !config.secret) return null;
  const failedEmailRequests = new WeakSet<Request>();
  return betterAuth({
    appName: "LegalMate",
    baseURL: config.origin,
    basePath: "/api/auth",
    secret: config.secret,
    database,
    trustedOrigins: [config.origin],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          typeof ctx.body?.email === "string" &&
          isReservedTestEmail(ctx.body.email)
        ) {
          throw new APIError("BAD_REQUEST", {
            message: "Use a supported sign-in account.",
          });
        }
        if (
          ctx.path === "/email-otp/send-verification-otp" &&
          ctx.body?.type !== "sign-in"
        ) {
          throw new APIError("BAD_REQUEST", {
            message: "Only sign-in codes are supported.",
          });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        // Better Auth intentionally catches deferred mail errors. Preserve a clear
        // delivery failure for this app, without exposing provider error details.
        if (ctx.request && failedEmailRequests.has(ctx.request)) {
          failedEmailRequests.delete(ctx.request);
          throw new APIError("SERVICE_UNAVAILABLE", {
            message:
              "We could not send your sign-in code. Please try again shortly.",
          });
        }
      }),
    },
    emailAndPassword: { enabled: false },
    socialProviders: config.google
      ? {
          google: {
            clientId: input.GOOGLE_CLIENT_ID!,
            clientSecret: input.GOOGLE_CLIENT_SECRET!,
            requireEmailVerification: true,
            accessType: "online",
            prompt: "select_account",
          },
        }
      : {},
    user: {
      validateUserInfo: ({ user, source }) => {
        // Check Google's fresh verified-email claim even for returning users.
        if (
          source.oauth &&
          (source.oauth.providerId !== "google" ||
            isReservedTestEmail(user.email ?? "") ||
            user.emailVerified !== true ||
            source.oauth.profile?.email_verified !== true)
        ) {
          return {
            error: "email_not_verified",
            errorDescription:
              "Use a Google account with a verified email address.",
          };
        }
      },
    },
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        trustedProviders: [],
        requireLocalEmailVerified: true,
        allowDifferentEmails: false,
      },
    },
    session: {
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    verification: { storeIdentifier: "hashed" },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/email-otp/send-verification-otp": { window: 60, max: 3 },
        "/sign-in/email-otp": { window: 60, max: 5 },
        "/sign-in/social": { window: 60, max: 10 },
        "/sign-in/test-account": { window: 60, max: 5 },
      },
    },
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      cookiePrefix: "legalmate",
      useSecureCookies: config.origin.startsWith("https:"),
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      database: { generateId: () => `auth_${crypto.randomUUID()}` },
    },
    // Authentication failures must never print codes, provider responses or tokens.
    logger: { disabled: true },
    plugins: [
      testAccountPlugin(
        input.LEGALMATE_TEST_PASSWORD,
        checkTestAccountScope,
        initializeDemo,
      ),
      ...(config.email
        ? [
            emailOTP({
              otpLength: 6,
              expiresIn: 300,
              allowedAttempts: 3,
              storeOTP: "hashed",
              resendStrategy: "rotate",
              disableSignUp: false,
              async sendVerificationOTP({ email, otp, type }, ctx) {
                if (type !== "sign-in")
                  throw new APIError("BAD_REQUEST", {
                    message: "Only sign-in codes are supported.",
                  });
                try {
                  await sendSignInCode(email, otp);
                } catch {
                  if (ctx?.request) failedEmailRequests.add(ctx.request);
                  throw new APIError("SERVICE_UNAVAILABLE", {
                    message:
                      "We could not send your sign-in code. Please try again shortly.",
                  });
                }
              },
            }),
          ]
        : []),
    ],
  });
}

// Keep password reset, account deletion, linking and other unused auth APIs closed.
export const allowedAuthRoutes = new Set([
  "GET /get-session",
  "POST /sign-out",
  "POST /sign-in/social",
  "POST /sign-in/test-account",
  "GET /callback/google",
  "POST /callback/google",
  "POST /email-otp/send-verification-otp",
  "POST /sign-in/email-otp",
  "GET /error",
]);
