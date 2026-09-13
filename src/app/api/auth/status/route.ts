import { getAuthStatus } from "@/lib/auth/server";

export function GET() {
  return Response.json(getAuthStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
