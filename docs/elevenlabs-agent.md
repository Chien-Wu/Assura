# ElevenLabs Agent configuration

Status: the user explicitly approved the ElevenAgents Terms on 2026-09-12. The existing voice/text Agent used four form tools. This checkout adds two participant-history tools, source-backed question registration and updated interview instructions. These files are local configuration artifacts; the RAG prompt and new tools have not been published to the remote Agent by this implementation. The dashboard remains authoritative for the deployed revision.

- Agent ID: `agent_8901m2a5v4rgeffbaaatcsgnhe38`
- Main branch ID: `agtbrch_0401m2a5v6szehna9ychmtnptxh8`
- [Agent dashboard](https://elevenlabs.io/app/agents/agents/agent_8901m2a5v4rgeffbaaatcsgnhe38/agent?branchId=agtbrch_0401m2a5v6szehna9ychmtnptxh8)
- Current voice: Eric — Smooth, Trustworthy. Current LLM: Qwen3.5-397B-A17B (the account's default).
- Authentication enabled; one concurrent call; bursting disabled. Audio storage and file attachments disabled. Transcript retention remains the provider default until retention requirements are agreed.
- Client events currently enabled: audio, interruption, user_transcript, agent_response, agent_response_correction. The current Dashboard does not list client_tool_call in the selectable events; verify actual tool delivery during SDK testing.
- The new tool configuration requires response waiting on all six tools. Its timeout values allow the browser's bounded API requests; verify these values when applying the configuration.
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

The current complete prompt is in `docs/elevenlabs-system-prompt.txt`. It preserves extraction field names, reference codes, direct quotes, timestamps, evidence checks and confirmation safeguards. It replaces named demo-patient question banks with questions formed by the same conversational Agent from current facts, selected background and retrieved historical sources. Apply it together with `docs/elevenlabs-first-message.txt` and the six tool configurations when deploying this change.

The app supplies saved field states, a limited projection of the selected fictional profile, remaining clarification budget, prior question status, dated historical source records, persisted flags and truthful escalation status. Model responses omit administrative profile fields such as NDIS number/date of birth and the full participant snapshot. There is no separate question-generating model. The prompt must respect returned facts, use at most three clarification questions per shift, and never claim external notification or supervisor awareness from inbox creation.

## Implemented client tool contract

All tool names and arguments must match the SDK registration exactly. Return structured results as a JSON string, including explicit `ok: false` and an actionable error on failure; never return an empty success result. No tool accepts a worker ID or arbitrary record ID from the model: the browser binds tools to the active authenticated draft.

| Tool                         | Model input                                                                                                                                                              | Successful result                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_form_context`           | None                                                                                                                                                                     | Limited saved note/profile, field definitions, validation, safety context and `participantContext` from `/knowledge/context`, including recent dated sources and persisted question status.                                                                                                                                      |
| `search_participant_records` | `query`, `current_turn_quote` (exact worker quote)                                                                                                                       | Selected whole notes with their form fields, dates, source IDs/revisions, coverage, retrieval ID and current question state. The duplicated participant field is omitted. Oversized notes are omitted and reported in coverage rather than silently truncated. `no_match` is a successful empty lookup, not evidence of absence. |
| `register_followup`          | `retrieval_id`, `source_ids` (array), `purpose_key`, `question`                                                                                                          | A saved question with its source references, remaining clarification budget and `canAsk`. Ask only when `canAsk` is true.                                                                                                                                                                                                        |
| `update_and_check_form`      | `fields_json`: a JSON string containing optional `fields`, `field_states`, `restrictive_practice`, and `question_updates`. Existing plain field patches remain accepted. | Saved draft and revision, validation, evidence warnings, retained flags, in-app escalation and saved question-answer state.                                                                                                                                                                                                      |
| `prepare_confirmation`       | None                                                                                                                                                                     | Confirmation token tied to the current revision and the exact saved content to read back.                                                                                                                                                                                                                                        |
| `finalize_form`              | `confirmationId`: current confirmation token. Confirmation evidence must come from the recorded user turn, not a model-generated boolean.                                | Completed saved record, or a specific reason confirmation was refused.                                                                                                                                                                                                                                                           |

The published prompt asks the worker to say the complete phrase **“I confirm this shift note.”** after readback. The app must check a fresh user transcript turn for that phrase; an old or negated “yes” is insufficient.

This checkout registers all six browser client tools and retains revision-bound oral and button confirmation. SDK transcript evidence is checked by the app; it is not independent audio verification. Run the unit and HTTP checks documented in the README. End-to-end Agent acceptance requires applying the updated remote configuration first; local wiring alone does not make an older remote Agent call new tools. The new RAG flow has not yet been verified in a real voice conversation. See the microphone acceptance steps in `docs/voice-integration.md`.

## Tool configuration artifact

[`elevenlabs-client-tools.json`](elevenlabs-client-tools.json) contains the six `tool_config` objects, with parameter names matching `VoicePanel`. For the vendor create-tool API, wrap each object as `{ "tool_config": ... }`; created tool IDs must then be attached to the intended Agent using its current configuration workflow. Preserve unrelated Agent settings when applying updates. This file is not an instruction to create duplicate tools: update existing matching tools where present.

The dashboard's **Wait for response** corresponds to `expects_response: true` in the [official tool API](https://elevenlabs.io/docs/eleven-agents/api-reference/tools/create). `wait_for_response` is not the field used by this artifact. See the [client-tool response guide](https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools) for response delivery to the conversation. No patient-history corpus is uploaded to the provider's knowledge base; the browser returns only the app-authorized result for this note.

`register_followup` takes one to four returned source IDs, a stable `purpose_key` of 3–100 lowercase letters/digits/underscores/hyphens, and one complete 12–700 character question ending in a single question mark. Successful registration reserves a question; the app's recorded assistant turn establishes emission, and a later exact worker quote establishes answered/unknown state. The same information gap must not be renamed to bypass duplicate checks.

## SDK notes

- Place SDK hooks under `ConversationProvider`.
- Start a private voice session with `conversationToken` and `connectionType: "webrtc"`; never expose the ElevenLabs API key in client code.
- Keep transcript events, errors, connection status and the active draft ID associated with the same application session.
- Stop the voice session before switching notes. Reconnect to the same saved draft and re-read its latest state.

References: [React SDK](https://elevenlabs.io/docs/eleven-agents/libraries/react), [Client tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools), [SDK client source](https://github.com/elevenlabs/packages/blob/main/packages/client/src/BaseConversation.ts).

## Expanded fields_json tool description

Use this description for the existing `fields_json` string parameter; do not rename the client tool or parameter:

> JSON-encoded object containing changed form fields in `fields`, optional `field_states` evidence entries as `{state, quote}`, optional `restrictive_practice` details, and optional `question_updates` as `[{questionId,state,quote}]`. A question update uses the returned question's `id`, state `answered` or `unknown`, and an exact current worker quote after that question was emitted. Preserve exact reference codes, quotes and timestamps. For absence assertions, supply the worker's exact transcript quote; otherwise leave the topic not_reviewed. Keep metadata outside `fields`. Send only supported changes and wait for the returned saved state, validation and warnings.

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
