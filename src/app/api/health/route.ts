import { env } from "cloudflare:workers";
import { getAuthStatus } from "@/lib/auth/server";

const requiredTables = [
  "shift_notes",
  "voice_sessions",
  "transcript_events",
  "note_changes",
  "note_snapshots",
  "risk_events",
  "risk_actions",
  "auth_user",
  "auth_session",
  "auth_account",
  "auth_verification",
  "auth_rate_limit",
  "providers",
  "app_profiles",
  "provider_memberships",
  "provider_manager_grants",
  "provider_participants",
  "scheduled_shifts",
  "knowledge_fts",
  "retrieval_runs",
  "interview_questions",
  "interview_question_events",
  "shift_assessments",
  "assessment_messages",
  "assessment_reviews",
  "assessment_runs",
  "assessment_findings",
  "assessment_manager_actions",
];

// Public readiness only: never accepts identity headers, creates a session,
// reads personal data, returns credentials, or bypasses application auth.
export async function GET() {
  let databaseReady = false;
  let auth = { google: false, email: false };
  try {
    auth = getAuthStatus();
    if (env.DB) {
      const tables = await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN (${requiredTables.map(() => "?").join(",")})`,
      )
        .bind(...requiredTables)
        .first<{ count: number }>();
      const columns = await env.DB.prepare(
        "PRAGMA table_info(shift_notes)",
      ).all<{ name: string }>();
      databaseReady =
        tables?.count === requiredTables.length &&
        [
          "provider_id",
          "shift_id",
          "participant_id",
          "participant_snapshot_json",
          "expected_start",
          "expected_end",
        ].every((name) =>
          columns.results.some((column) => column.name === name),
        );
    }
  } catch {
    // Do not expose database errors or environment values to public callers.
  }
  const ready = databaseReady && auth.google;
  return Response.json(
    {
      status: ready ? "ready" : "unavailable",
      database: databaseReady,
      authentication: auth,
    },
    {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
