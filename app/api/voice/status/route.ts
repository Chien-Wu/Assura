import { voiceConfig } from "@/lib/voice-server";
export function GET() {
  const { key, agentId } = voiceConfig();
  const enabled = Boolean(key && agentId);
  return Response.json(
    {
      enabled,
      reason: enabled
        ? null
        : "Voice setup is pending. You can complete your note using the form.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
