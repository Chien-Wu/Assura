# Historical voice experiments

These scripts are opt-in research tools, separate from ordinary application checks. They may consume provider credits, create lab agents or start a local tunnel; inspect the matching [historical reports](../../docs/archive/README.md) first.

- `workflow-lab.mjs` and `workflow-lab-config.mjs`: initial native routing and context transfer experiments.
- `workflow-backend-live.mjs`: synthetic webhook bridge experiment, invoked with `npm run test:workflow:webhook:live`. Shared configuration is maintained in `scripts/workflow/`; its isolated D1/gateway harness is in `tests/support/`.

The current client-tool app smoke is `npm run test:workflow:live`, implemented in `scripts/workflow/workflow-app-smoke.mjs`. Historical `scripts/smoke-live-rag.mjs` also requires the old six-tool configuration; it is not acceptance testing for the current recorder.
