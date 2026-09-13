# Retired protocol tests

These scripts reproduce the earlier recorder-led confirmation, early risk and six-tool interview/RAG protocol. The current normal flow uses a recorder followed by silent AI2. Use `npm run test:api` for current isolated HTTP coverage.

Nothing here runs as part of `npm test`, `npm run check` or `npm run test:api`. The scripts fail before requests unless `LEGALMATE_TEST_LEGACY_PROTOCOL=1` is explicitly set. Reproduction requires a matching historical application and agent configuration, synthetic assigned shifts and the signed session fixture. The existing `LEGALMATE_TEST_MATCHING_AGENT_CONFIG=1` guard is also required for the paid text conversation. These scripts write to the configured test server; they are not a current production smoke test.

- `notes-api.mjs`: historical revision and recorder confirmation flow.
- `voice-api.mjs`: historical recorder session/tool flow.
- `safety-api.mjs`: early candidate capture and review.
- `text-conversation.mjs`: paid historical six-tool conversation.

The files remain for regression archaeology. They are not expected to pass against today's recorder contract.
