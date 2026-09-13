# Native voice workflow experiment

> Historical scope: see the [current flows](../README.md) and [archive notes](README.md) before using configuration or commands below.

Test date: 2026-09-13. This is an isolated prototype, not an application deployment.

The experiment uses one private ElevenLabs agent with native Main and Medication workflow nodes. Both use the existing account's `qwen35-397b-a17b` model and Eric voice configuration. The specialist speaks directly; there is no external question-generation model. The shared form is a synthetic local JSON adapter, not the production D1 database or authenticated application API. All participant details are fictional.

## What was tested

The worker describes a routine library shift, then a missed medication dose. Before specialist entry, a worker edit in the synthetic form changes the scheduled time to 1 pm. That edit is outside the spoken transcript. Medication name and dose are explicitly unknown. Later, the worker supplies current observations and an already-contacted manager, corrects the contact time, and requests a final summary.

Three context strategies were exercised:

- **Conversation only:** the native nodes retain conversation history, but receive no live form update. This is a control, not a recommended synchronization strategy.
- **Push:** an initial `case_context` dynamic variable provides the starting snapshot; `contextual_update` sends the updated saved case before the next worker message.
- **Pull:** a native tool node reads the latest shared case before entering Medication.

The prototype validates field names, note revision and exact source quotations before saving. Validation only verifies that a quotation exists; it does not establish that every interpretation in a field follows from that quotation. This limitation also applies to the existing assessment evidence approach.

## Observed results

Times below are client-observed time from sending a user text message to receiving the complete `agent_response` text event. They are individual observations, not averages, percentile guarantees or microphone-to-speech latency. The form adapter runs locally, so a production API lookup would add its own latency.

| Run                         | First specialist response / handling |        Save and return to Main | Later correction | Result                                                                                                                   |
| --------------------------- | -----------------------------------: | -----------------------------: | ---------------: | ------------------------------------------------------------------------------------------------------------------------ |
| Push, fully supplied pilot  |          3.048 s (saved immediately) |         Included in prior cell |          5.028 s | Completed; no unnecessary specialist question                                                                            |
| Push, missing details v2    |             0.912 s (asked symptoms) |                        2.939 s |          8.875 s | Completed; read the UI-edited 1 pm time; omitted an explicit unknown from the form                                       |
| Pull, missing details v2    |      1.219 s (asked symptoms/advice) |                        2.463 s |           Failed | Read the UI-edited 1 pm time; repeated an invalid quote during correction until the 45-second turn deadline              |
| Conversation-only control   |        5.079 s (save/conflict/retry) | 3.316 s after additional facts |          5.661 s | Completed after a stale-revision rejection supplied the missing current snapshot; skipped the intended symptom follow-up |
| Push, shared corrections v3 |             0.900 s (asked symptoms) |                        2.863 s |          1.788 s | Completed; explicit unknown saved; simple correction handled in Main                                                     |

These are sequential development runs. Prompt and failure-handling refinements changed between versions, so the table is not a controlled claim that a particular transport produces a fixed speedup.

One additional v3 push run requested real generated speech, with typed input and the same voice/model. Client-observed **first audio delivery** was:

| Turn                                 | First audio | Complete text event |
| ------------------------------------ | ----------: | ------------------: |
| Routine Main response                |     0.567 s |             1.469 s |
| Medication's direct symptom question |     1.010 s |             2.859 s |
| Save event and return to Main        |     2.881 s |             5.176 s |
| Main saves the corrected time        |     1.919 s |             3.759 s |
| Final summary                        |     0.648 s |             9.233 s |

Audio arrives while the full text response is still being generated, so the complete-text event must not be interpreted as time until speech starts. These values exclude speech recognition, end-of-user-turn detection and browser playback buffering. The saved specialist sample is at `test-results/workflow-lab/2026-09-13T13-02-10.497Z-push-audio/specialist-question.wav`.

The six runs comprise five completed conversations and one failed pull-v2 correction run. This small synthetic sample establishes feasibility and exposes failure modes; it is not a latency benchmark or a clinical quality evaluation.

Live provider workflow tool events confirm transfers between Main and Medication. Completed conversation records additionally include `agent_metadata.workflow_node_id` and per-turn provider metrics. Main and Medication remained within the same provider conversation.

## Changes prompted by failures

- A form-validation rejection is returned as an explicit application result with `ok:false`, rather than as a transport failure that the provider may repeatedly retry. The failed run remains in the evidence.
- The harness stops after two identical rejected writes, caps total tool calls and has bounded turn timeouts. Saved data is retained when a run fails.
- The specialist is told to save applicable unknowns already stated by the worker, and to ask about relevant absent current observations/advice before closing a missed-dose account.
- Both nodes share the form tool. Main can apply a simple factual correction to an already-recorded event directly, without another specialist transition. New events or new risk details still route to Medication.
- Updates are patches: unchanged fields should not be regenerated. Exact quotations must not be reconstructed by joining different utterances.

## Recommended shared context

Use one application-owned case record as the source of truth. The six forms are views of that case plus their own specialist fields. Conversation context is a projection of the saved record, not its storage layer.

```text
case / shift ID + revision
  participant context: small scoped profile with provenance
  current events: stable event IDs and shared facts
  forms: values, known/unknown/not-discussed state, source references
  question state: answered facts and any active question
  background references: document ID, revision, effective date, scope
```

Recommended delivery:

1. At conversation start, supply a compact initial snapshot via dynamic variables or the existing context tool.
2. After an accepted form edit, provide the latest revision and changed facts to the active conversation. Every workflow node has access to the shared conversation; a new session and full patient-data reload are unnecessary.
3. Do not wait until a node-enter event to send its first context update: the destination may already be generating. Push before routing where possible. Use a native entry tool node when a fresh external read must precede the first question.
4. Fetch authoritative structured data by case/document ID when exact current values are needed. Use RAG only for relevant passages from longer plans or historical documents, with the application's existing participant/provider access checks and dates.
5. Historical observations are background. An earlier nausea report must not become a symptom in today's form. Missing retrieval is not proof of absence.
6. Production field evidence should reference persisted source IDs, including multiple sources for a correction that preserves earlier facts. The server can attach the original text, reducing the need for a speaking model to reproduce long quotations. This source-ID variant was not implemented in this experiment.

The existing `lib/knowledge.ts` already preserves source IDs, revisions, dates, ownership scope and background guidance. That can be reused; no new vector database is needed for the live form state.

## Reproduce and inspect

```sh
node scripts/experiments/workflow-lab.mjs setup
node scripts/experiments/workflow-lab.mjs run push
node scripts/experiments/workflow-lab.mjs run pull
node scripts/experiments/workflow-lab.mjs run conversation
node scripts/experiments/workflow-lab.mjs run push --audio
node scripts/experiments/workflow-lab.mjs collect
```

These commands use real ElevenLabs credits. They load the existing server key privately from `.env.local`. Setup creates dedicated lab tools and a private agent, recorded in ignored `.secrets/workflow-lab/manifest.json`; it never patches the application's configured agent. Runs are capped at ten in the manifest and the test agent is limited to one concurrent call. Results and synthetic transcripts are written under ignored `test-results/workflow-lab/`.

`--audio` sends typed user messages and requests generated speech. It can measure first-audio delivery, but does not test microphone recognition, voice activity detection, acoustic interruption or perceived browser playback. It saves a PCM WAV sample of the specialist response when the provider uses `pcm_16000`.

The current script uses the v3 prompts. Earlier results remain preserved but require their recorded provider agent version for exact reproduction. This experiment does not validate all six risk categories, production authentication, database persistence, RAG retrieval quality, clinical suitability or end-to-end microphone behavior.

## Primary references

- [ElevenLabs workflows](https://elevenlabs.io/docs/eleven-agents/customization/agent-workflows)
- [ElevenLabs OpenAPI schema](https://api.elevenlabs.io/openapi.json): `workflow` is top-level in create/update requests; one edge is permitted per node pair, with a backward condition for return.
- [Client-to-server context updates](https://elevenlabs.io/docs/eleven-agents/customization/events/client-to-server-events)
- [Dynamic variables](https://elevenlabs.io/docs/eleven-agents/customization/personalization/dynamic-variables)
