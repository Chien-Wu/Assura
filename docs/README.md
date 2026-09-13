# Documentation

Start with the [architecture](architecture.md). Current setup instructions are in `guides/`, behaviour contracts in `flows/`, and original requests in `sources/`. [Original requirements](sources/requirements.md) record the project input, not the current deployment state. The recorder with silent AI2 and the native Workflow test are separate flows.

## Current implementation

- [Silent AI2 flow](flows/note-review.md) and [result contract](flows/assessment-contract.md): normal note review and confirmation.
- [Native Workflow app test](flows/risk-workflow.md): Main, six specialists and shared draft forms.
- [Authentication](guides/authentication.md), [provider setup](guides/providers.md) and [VM operations](guides/deployment.md).
- [Sarah Doyle synthetic history](guides/test-data.md): fixture provenance and VM import record, not a current recorder RAG guarantee.
- [Extra-note request archive](sources/extra-notes-plan.md) and [supplied six forms](sources/extra-notes-forms.txt).

## Configuration sources

- [Main prompt](../config/agents/main/system-prompt.txt), [two client tools](../config/agents/main/client-tools.json) and [first message](../config/agents/main/first-message.txt). `scripts/sync-elevenlabs-agent.mjs` reads the prompt/tools; editing files alone does not publish agent settings.
- [Silent AI2 prompt artifact](../config/agents/ai2/system-prompt.txt), checked against `src/lib/assessment/prompt.ts` by the unit suite.
- [Native Workflow configuration](../config/agents/workflow.mjs), applied by `scripts/configure-workflow-test.mjs`.

## Supplied material and history

[sources/](sources) preserves the supplied forms and ideas. Earlier RAG, interview, webhook and transfer studies have been removed from the current tree; they remain available in Git at `c5c5021`. Use the current guides above for setup.
