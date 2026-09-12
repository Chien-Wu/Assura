# Voice integration

The English MVP connects a private ElevenLabs Agent using `@elevenlabs/react` 1.15.2. Temporary **Text · Test mode** is the default; Voice remains selectable before starting. Both use the same Agent, model, system prompt and four form tools. The API key stays on the server. The provisional form remains editable manually when voice is unavailable.

## Configuration

Set `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` in the ignored `.env.local` for development and in Sites runtime environment variables for the hosted app. Store the key as a secret. Agent configuration is documented in the project-level `docs/elevenlabs-agent.md`.

`POST /api/voice/sessions` requires a signed-in owner and a saved draft. For voice it obtains a short-lived ElevenLabs WebRTC token. For text it obtains a signed WebSocket URL with `include_conversation_id=true`, parses the returned conversation ID from that URL, and stores the provider conversation ID and note ID, expires older app sessions for the same note, and returns the connection credential to that browser. No API key is returned. App sessions expire after 15 minutes; the Agent's configured call limit is 10 minutes.

## Conversation and persistence

Four client tools forward to the app's authenticated APIs. This allows tools to use the private Site's signed-in browser session without an unauthenticated external webhook.

| Client tool | Action |
| --- | --- |
| `get_form_context` | Read the saved note, field definitions, choices, validation and Melbourne time. |
| `update_and_check_form` | Parse partial string fields from `fields_json`, update with a revision check, return saved data and missing answers. |
| `prepare_confirmation` | Prepare a saved revision and bind its confirmation ID to the current voice session. |
| `finalize_form` | Require a new exact confirmation transcript and matching current review, then mark the note complete. |

The UI uses saved API responses. Tools and transcript events share a serial queue. Manual edits and navigation to another note are disabled during a call. Ending a call drains admitted saves, closes the app session, refreshes the saved note and remounts the SDK provider before another call can start. A restarted call resumes the same draft.

Transcript events are saved to the owner-scoped D1 session. Text sessions use `textOnly: true`; they request no microphone and create no audio context. Typed user messages are displayed and persisted before `sendUserMessage`, since the SDK does not echo them locally. Incoming user echoes are ignored in text mode. The saved assistant review makes text confirmation ready without waiting for audio events. Typed evidence is labelled `method: text` and `source: browser_text_input`; voice evidence keeps its existing labels. Completion stores the browser SDK's user transcript, receipt time, note revision, confirmation ID and provider conversation ID. The required phrase is **I confirm this shift note.** A generic yes, old confirmation, interruption, correction, or closing the call cannot by itself complete the note. A new user answer before readback is ready invalidates that pending review. The confirmation write checks both the note revision and voice-session revision atomically.

This is browser SDK transcript evidence, not an independent audio audit or identity verification. SDK speaking/listening events indicate activity and can include pauses; a short stable-listening delay reduces early prompting but does not prove every word was heard. The Agent is instructed to read every saved field and wait. Review wording and speech recognition still require a real microphone acceptance test. ElevenLabs recording is disabled; transcripts are retained by both the app and the currently configured provider. Retention and real participant use need a later product decision.

## Temporary text test

1. Open the app, sign in, keep **Text · Test mode** selected and press **Start text note**.
2. Type the fictional shift below. Press Enter or Send; Shift + Enter adds a line.
3. Check the same automatic form updates, follow-up questions and corrections. Read the assistant's review and type **I confirm this shift note.** when ready.
4. Wait for **Complete**, then end the conversation. Ending before confirmation must leave a draft.
5. Select **Voice** before starting to restore spoken testing. Text removes speech recognition and audio latency, so its speed does not represent full voice performance.

## Voice acceptance test

1. Open the private hosted app, sign in, choose a new note, and press **Start voice note**. Allow microphone access.
2. Use fictional details: “Today I supported Alex from nine a.m. to three p.m. We went grocery shopping. I gave verbal prompts at checkout. Alex chose items independently and practised budgeting. There were no incidents and no follow-up needed.”
3. Answer any missing questions. Confirm the saved fields appear on screen.
4. Say “Actually, the shift ended at three thirty.” Check the end time changes and a fresh review follows.
5. Listen to the review. When asked, say “I confirm this shift note.” Wait for the app's saved/completed state, then end the call. Check the same note in **Review notes** and download its text.
6. In a separate note, end before confirming. It must remain a draft. Reopen that draft and resume it, without creating a duplicate.
7. Try interrupting the review with a correction, and denying microphone permission. Neither should complete a note. Already saved draft data must remain available.

## Automated validation

- `node --experimental-strip-types --test tests/shift-form.test.mjs tests/voice-state.test.mjs`
- `npx tsc --noEmit`
- Build with the Sites build helper.
- Against the local server: `node tests/notes-api.mjs` and `node tests/voice-api.mjs`. The voice API test requests a connection token but opens no audio connection and sends no participant fields to ElevenLabs.

References: [React SDK](https://elevenlabs.io/docs/eleven-agents/libraries/react), [Client tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools).

`node --experimental-strip-types tests/text-conversation.mjs` is an optional real Agent integration test. It consumes Agent credits, uses fictional details and verifies filling, an end-time correction, fresh review and typed completion through the local APIs. It does not test browser layout or keyboard interaction.

References for text mode: [Chat mode](https://elevenlabs.io/docs/eleven-agents/guides/chat-mode), [signed URL](https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get-signed-url).

Observed Agent behavior in the live text test: it can save fields and announce that it will prepare a review, then end that turn without calling the review tool. Sending “Please prepare the current saved note for confirmation and show the full review now.” triggers that step. This behavior is kept visible for performance evaluation; the app does not inject follow-up messages or alter the Agent prompt. The optional integration test includes explicit follow-up user turns for this case.
