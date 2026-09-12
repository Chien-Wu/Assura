# ElevenLabs Agent configuration

Status: the user explicitly approved the ElevenAgents Terms on 2026-09-12. The app has working voice and text connections to the same authenticated Agent and four client tools. The current spec adds evidence states, profile-driven elicitation, restrictive-practice metadata and truthful in-app escalation. The interview prompt and tool description were published on 2026-09-12. The files here are the maintained setup templates; the dashboard is authoritative for the exact deployed revision.

- Agent ID: `agent_8901m2a5v4rgeffbaaatcsgnhe38`
- Main branch ID: `agtbrch_0401m2a5v6szehna9ychmtnptxh8`
- [Agent dashboard](https://elevenlabs.io/app/agents/agents/agent_8901m2a5v4rgeffbaaatcsgnhe38/agent?branchId=agtbrch_0401m2a5v6szehna9ychmtnptxh8)
- Current voice: Eric — Smooth, Trustworthy. Current LLM: Qwen3.5-397B-A17B (the account's default).
- Authentication enabled; one concurrent call; bursting disabled. Audio storage and file attachments disabled. Transcript retention remains the provider default until retention requirements are agreed.
- Client events currently enabled: audio, interruption, user_transcript, agent_response, agent_response_correction. The current Dashboard does not list client_tool_call in the selectable events; verify actual tool delivery during SDK testing.
- Tool response waiting is enabled; tool timeouts are configured for 20 seconds and should be checked again through the SDK integration test.
- The user supplied an API key in `.env.local`; it successfully retrieved the Agent and a conversation token. The key is ignored by Git and configured as a Sites server secret. No permission expansion was needed. The earlier unsubmitted key dialog had suggested ElevenAgents Read, a 30-day expiry and 10,000-credit limit; the supplied key’s actual restrictions have not been independently checked.

## Agent settings

- Name: LegalMate Shift Notes — Demo
- Language: English
- Channel: browser voice via WebRTC; temporary text test mode via signed WebSocket URL and textOnly. Both use the same Agent.
- Authentication: private agent; the app backend issues a short-lived conversation token after checking the signed-in user and draft ownership.
- Tools: client tools, with **Wait for response** enabled on every tool. The signed-in browser forwards their requests to the app's own APIs.
- First message: use the exact text in `docs/elevenlabs-first-message.txt`, including the transcript recording and retention disclosure.
- Model and voice: select an available standard model and English voice during account setup; no cloned voice or additional model pipeline is needed for this MVP.

## System prompt

The current complete prompt is in `docs/elevenlabs-system-prompt.txt`. This is the maintained prompt template for the Agent dashboard. It preserves existing extraction field names, reference codes, direct quotes and timestamps, while adding the spec's elicitation and evidence safeguards. Publish that prompt and `docs/elevenlabs-first-message.txt` together.

The app supplies saved field states, the selected fictional profile, remaining clarification budget, suggested observational questions, persisted flags and truthful escalation status. The prompt must respect those returned facts, use at most three clarification questions per shift, and never claim external notification or supervisor awareness from inbox creation.

## Implemented client tool contract

All tool names and arguments must match the SDK registration exactly. Return structured results as a JSON string, including explicit `ok: false` and an actionable error on failure; never return an empty success result. No tool accepts a worker ID or arbitrary record ID from the model: the browser binds tools to the active authenticated draft.

| Tool                    | Model input                                                                                                                                                  | Successful result                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_form_context`      | None                                                                                                                                                         | Form definitions, allowed choices, timezone, saved note, selected profile, remaining clarification budget, observational questions, persisted risk flags, escalation state and validation. |
| `update_and_check_form` | `fields_json`: a JSON string containing optional `fields`, `field_states`, and `restrictive_practice` objects. Existing plain field patches remain accepted. | Saved draft and revision, validation, evidence warnings, profile-driven questions, retained flags and in-app escalation state.                                                             |
| `prepare_confirmation`  | None                                                                                                                                                         | Confirmation token tied to the current revision and the exact saved content to read back.                                                                                                  |
| `finalize_form`         | `confirmationId`: current confirmation token. Confirmation evidence must come from the recorded user turn, not a model-generated boolean.                    | Completed saved record, or a specific reason confirmation was refused.                                                                                                                     |

The published prompt asks the worker to say the complete phrase **“I confirm this shift note.”** after readback. The app must check a fresh user transcript turn for that phrase; an old or negated “yes” is insufficient.

The MVP now implements the four client tools and revision-bound oral confirmation, while retaining button confirmation. SDK transcript evidence is checked by the app; it is not independent audio verification. Run the unit and HTTP checks documented in the README, including a real token request without opening audio. A real microphone conversation remains the manual acceptance step; see `docs/voice-integration.md`.

## SDK notes

- Place SDK hooks under `ConversationProvider`.
- Start a private voice session with `conversationToken` and `connectionType: "webrtc"`; never expose the ElevenLabs API key in client code.
- Keep transcript events, errors, connection status and the active draft ID associated with the same application session.
- Stop the voice session before switching notes. Reconnect to the same saved draft and re-read its latest state.

References: [React SDK](https://elevenlabs.io/docs/eleven-agents/libraries/react), [Client tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools), [SDK client source](https://github.com/elevenlabs/packages/blob/main/packages/client/src/BaseConversation.ts).

## Expanded fields_json tool description

Use this description for the existing `fields_json` string parameter; do not rename the client tool or parameter:

> JSON-encoded object containing changed form fields in `fields`, optional `field_states` evidence entries as `{state, quote}`, and optional `restrictive_practice` details. Preserve exact reference codes, quotes and timestamps. For absence assertions, supply the worker's exact transcript quote; otherwise leave the topic not_reviewed. Use get_form_context for the current field definitions, allowed choices and profile. Send only supported changes and wait for the returned saved state, validation and warnings.

Example envelope (the quote must actually exist in the current transcript):

```json
{
  "fields": { "incidents": "no" },
  "field_states": {
    "incidents": {
      "state": "stated_negative",
      "quote": "There were no incidents or concerns."
    }
  }
}
```

The worker and manager use separate `/worker` and `/manager` windows. Demo records remain scoped to the same signed-in owner. The manager inbox is an application record; no email, Slack, SMS or Commission submission is implemented. Supervisor knowledge and notification times must be entered as separate facts.
