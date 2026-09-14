import { getAppUser } from "@/lib/auth/server";
import { env } from "cloudflare:workers";
import { isAllowedRequestOrigin } from "../auth/request-origin";
import { readAssuraSetting } from "./environment";
export class RequestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export function database() {
  if (!env.DB)
    throw new RequestError(
      "Your notes are temporarily unavailable. Please try again.",
      503,
    );
  return env.DB;
}
export async function identity(request: Request) {
  const user = await getAppUser(new Headers(request.headers));
  if (!user)
    throw new RequestError("Sign in to create and save your notes.", 401);
  if (request.method !== "GET") {
    let allowedOrigin: boolean;
    try {
      allowedOrigin = isAllowedRequestOrigin(
        request.url,
        request.headers.get("origin"),
        readAssuraSetting("PUBLIC_ORIGIN", env, process.env),
      );
    } catch {
      throw new RequestError(
        "Application origin is not configured correctly.",
        503,
      );
    }
    if (!allowedOrigin)
      throw new RequestError("This request could not be verified.", 403);
    if (!request.headers.get("content-type")?.includes("application/json"))
      throw new RequestError("Expected a JSON request.", 415);
  }
  return user;
}
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export async function readBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > 80000)
    throw new RequestError("This note is too large.", 413);
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RequestError("Expected a JSON object.");
  return value as Record<string, unknown>;
}
export function failure(error: unknown) {
  if (error instanceof RequestError)
    return json({ error: error.message }, error.status);
  if (error instanceof SyntaxError)
    return json({ error: "The request is not valid JSON." }, 400);
  console.error("Note request failed", error);
  return json(
    {
      error:
        "We couldn’t save or load your note. Your unsaved answers are still on this page. Please try again.",
    },
    503,
  );
}
