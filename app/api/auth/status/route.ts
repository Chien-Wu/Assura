import { getAuthStatus } from "@/lib/auth";

export function GET() {
  return Response.json(getAuthStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
