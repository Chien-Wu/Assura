# Voice integration — next step

The current MVP has a working persisted form and review flow. Live voice is intentionally unavailable until the ElevenLabs account and Agent are configured. `/api/voice/status` reports this explicitly. No simulated conversation or browser speech service is presented as ElevenLabs.

All interface copy, conversation instructions and note output should be English.

## Planned connection

- Use an ElevenLabs Agent with the React SDK and WebRTC.
- Issue a conversation token from an authenticated backend endpoint; keep the API key server-side.
- Supply this provisional form's definitions from `lib/shift-form.ts` and the currently saved note to the Agent. Replace these fields once the final form arrives.
- For this private hosted preview, use client tools that forward to the app's authenticated APIs, so callbacks use the signed-in browser's session. An unauthenticated ElevenLabs server webhook cannot pass the private Site's access gate. Move to authenticated server webhook tools when the hosting and callback access configuration supports that route.
- Register `get_form_context`, `update_and_check_form`, `prepare_confirmation`, and `finalize_form`. The Agent must wait for returned tool results before claiming success or proceeding to confirmation.
- Read the latest revision before updating. Replace only fields changed by the worker, and use the backend's returned validation issues for the next question.
- Preserve a transcript and the exact user confirmation turn when implementing oral confirmation. The current confirmation endpoint serves the explicit UI confirmation flow; merely setting a model-generated boolean does not establish reliable voice consent.
- Update the UI from saved API responses. Preserve the note ID across reconnects, require fresh readback after a correction, and stop the voice connection before opening another note.

## APIs already available

| API | Purpose |
| --- | --- |
| `POST /api/notes` | Create an empty draft with a client-generated UUID, safe to retry. |
| `GET /api/notes/:id` | Read the saved note and revision. |
| `PATCH /api/notes/:id` | Send `{revision, fields}` to apply partial field updates and return validation results. |
| `POST /api/notes/:id/review` | Send `{revision}` to obtain a confirmation ID tied to that version. |
| `POST /api/notes/:id/confirm` | Send `{revision, confirmationId, confirmed: true}` after explicit confirmation. |

Final form fields, languages (English confirmed), voice/model configuration, participant lookup and transcript retention are integration inputs. Use fictional participants during development.

References: [React SDK](https://elevenlabs.io/docs/eleven-agents/libraries/react), [Client tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools).
