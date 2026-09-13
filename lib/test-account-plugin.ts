import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  formCsrfMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { constantTimeEqual } from "better-auth/crypto";
import { z } from "zod";
import {
  getTestAccountByAlias,
  getTestAccountByIdentity,
  type TestAccount,
} from "./test-accounts.ts";

export type CheckTestAccountScope = (account: TestAccount) => Promise<boolean>;

export function testAccountPlugin(
  password: string | undefined,
  hasScope: CheckTestAccountScope,
  initializeDemo?: () => Promise<void>,
): BetterAuthPlugin {
  return {
    id: "legalmate-test-accounts",
    endpoints: {
      signInTestAccount: createAuthEndpoint(
        "/sign-in/test-account",
        {
          method: "POST",
          use: [formCsrfMiddleware],
          body: z.object({
            email: z.string().max(254),
            password: z.string().max(1024),
          }),
        },
        async (ctx) => {
          if (!password)
            throw new APIError("SERVICE_UNAVAILABLE", {
              message: "Test account sign-in is not enabled.",
            });
          const matches = constantTimeEqual(ctx.body.password, password);
          const account = getTestAccountByAlias(ctx.body.email);
          if (!matches || !account)
            throw new APIError("UNAUTHORIZED", {
              message: "Check the test email and password.",
            });
          let user = await ctx.context.internalAdapter.findUserById(account.id);
          if (!user && initializeDemo) {
            await initializeDemo();
            user = await ctx.context.internalAdapter.findUserById(account.id);
          }
          if (
            !user ||
            !user.emailVerified ||
            !getTestAccountByIdentity(user) ||
            !(await hasScope(account))
          ) {
            throw new APIError("SERVICE_UNAVAILABLE", {
              message:
                "Test accounts are not ready. Please contact the LegalMate team.",
            });
          }
          const session = await ctx.context.internalAdapter.createSession(
            user.id,
          );
          if (!session)
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "We could not start your test session.",
            });
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ redirectTo: account.redirectTo });
        },
      ),
    },
  };
}
