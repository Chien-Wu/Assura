# Documentation

Start with the [architecture](architecture.md). Current setup instructions are in `guides/` and behaviour contracts in `flows/`. The recorder with silent AI2 and the native Workflow test are separate flows.

## Current implementation

- [Silent AI2 flow](flows/note-review.md) and [result contract](flows/assessment-contract.md): normal note review and confirmation.
- [Native Workflow app test](flows/risk-workflow.md): Main, six specialists and shared draft forms.
- [Authentication](guides/authentication.md), [provider setup](guides/providers.md) and [VM operations](guides/deployment.md).
- [Sarah Doyle synthetic history](guides/test-data.md): fixture provenance and VM import record, not a current recorder RAG guarantee.
- [Supplied form reference](sources/extra-notes-forms.txt): original intake questions and remaining planning decisions; current Workflow fields are defined in `src/lib/workflow/case.ts`.

## Configuration sources

- [Main prompt](../config/agents/main/system-prompt.txt) and [two client tools](../config/agents/main/client-tools.json). `scripts/sync-elevenlabs-agent.mjs` reads these files; editing them alone does not publish agent settings. The first message is maintained in ElevenLabs and preserved by this script.
- [Silent AI2 runtime prompt](../src/lib/assessment/prompt.ts), used directly by the model adapter and unit tests.
- [Native Workflow configuration](../config/agents/workflow.mjs), applied by `scripts/configure-workflow-test.mjs`.

## Supplied material and history

The supplied form reference remains in `sources/`. Superseded product briefs, implementation diaries and the original form submission are available in [Git history](https://github.com/Chien-Wu/legalMate/tree/4af05a27f4d9e3100f037470f02cef3060e47ec6/docs/sources). Earlier RAG, interview, webhook and transfer studies remain available at `c5c5021`. Use the current guides above for setup.
