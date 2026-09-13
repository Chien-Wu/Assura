# Risk conversation hands-on test

Entry: `/worker` → choose an assigned shift → **Try risk conversation**. The dedicated page supports voice (WebRTC), text (WebSocket), live risk drafts, source inspection, manual correction and draft review. Keep fictional participants in TestProvider.

## Connected version

Separate ElevenLabs agent: `agent_1401m2djxrgqft5s4f3vbppxr10g`, pinned version `agtvrsn_6001m2djxt1vfvvr4xv6qj6av5xz`. Gemini 2.5 Flash with thinking budget 0; Eric voice inherited from the existing main agent. Native Main plus six override-agent nodes retain one conversation. Configuration is reproducible with `node --experimental-strip-types scripts/configure-workflow-test.mjs <HTTPS application origin>`; credentials stay in ignored `.env.local` and manifests in `.secrets/workflow-app/`.

The two client tools (`get_case_context`, `save_risk_form`) await the browser's ordered source/write queue and forward to authenticated backend routes. The browser carries the scoped 15-minute workflow token in memory; no API key reaches the browser. Site owner access and normal signed application sessions still apply. There is no backend specialist model call, public tunnel, external shared sheet, or RAG request on the save path.

D1 stores case revisions, shared event facts, six form schemas and supporting worker sources. Manual corrections use field-scoped sources and update the conversation context. The server rejects stale, cross-owner, unsupported and evidence-free writes. Evidence references are validated structurally; they do not prove the model's summary semantically matches the worker's words. Workers must check the saved drafts.

**Mark risk details reviewed** applies only to these drafts. It does not confirm the General Note or claim an event is legally/clinically closed. Risk drafts currently have their own review page and are not yet merged into the manager's AI2 review view.

## Runtime setup

Required: `DB`, `BETTER_AUTH_SECRET`, `LEGALMATE_PUBLIC_ORIGIN`, `LEGALMATE_TEST_PASSWORD`, `ELEVENLABS_API_KEY`, `LEGALMATE_WORKFLOW_ENABLED=true`, and the two workflow agent/version IDs. Existing agent settings remain separate. Workflow-enabled environments can initialize the missing fixed TestProvider accounts only after a valid test password; existing providers, identities and memberships are never reactivated or overwritten by this initializer. Normal environments retain operator provisioning.

The site deliberately uses test-account login. Google OAuth and email are separate existing features and are not needed for this test. `/api/auth/status` verifies test-login availability; the existing `/api/health` also requires Google and is not a suitable test-only readiness probe.

## Verified

The live synthetic client-tool smoke (`scripts/experiments/workflow-app-smoke.mjs`) completed Main → Medication → Main, saved the Medication draft to isolated D1, marked only risk drafts reviewed, and obtained a WebRTC token with a conversation identity. Three tool requests took 142 ms, 47 ms and 28 ms locally. This measures the backend tool processing path, not full voice response latency. It did not use a microphone or assess speech recognition quality. Previous webhook experiments and their limitations remain in `workflow-backend-results.md`; they are separate configurations.
