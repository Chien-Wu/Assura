# Documentation

Start with the [architecture](architecture.md) and [requirements](requirements.md). The recorder with silent AI2 and the native Workflow test are separate flows.

## Current implementation

- [Silent AI2 flow](ai2-workflow.md) and [result contract](silent-ai2-contract.md): normal note review and confirmation.
- [Native Workflow app test](workflow-app-test.md): Main, six specialists and shared draft forms.
- [Authentication](authentication.md), [provider setup](provider-setup.md) and [VM operations](vm-deployment.md).
- [Sarah Doyle synthetic history](sarah-doyle-history.md): fixture provenance and VM import record, not a current recorder RAG guarantee.
- [Extra-note request archive](extra-notes-plan.md) and [supplied six forms](sources/extra-notes-forms.txt).

## Configuration sources

- [Main prompt](../config/agents/main/system-prompt.txt), [two client tools](../config/agents/main/client-tools.json) and [first message](../config/agents/main/first-message.txt). `scripts/sync-elevenlabs-agent.mjs` reads the prompt/tools; editing files alone does not publish agent settings.
- [Silent AI2 prompt artifact](../config/agents/ai2/system-prompt.txt), checked against `lib/risk-assessment-prompt.ts` by the unit suite.
- [Native Workflow configuration](../scripts/workflow/workflow-backend-config.mjs), applied by `scripts/configure-workflow-test.mjs`.

## Historical material

[archive/](archive/README.md) retains earlier RAG, interview, webhook and transfer studies. Their results apply to the documented versions and do not describe the current two-tool recorder. [sources/](sources/) holds user-supplied originals, including earlier forms and ideas; differences between versions are intentional and have not been merged.
