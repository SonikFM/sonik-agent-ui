# Phase 2 Command Registry Discovery Gate

Phase 2 keeps the global command registry agent-facing without turning generated OpenAPI/ORPC descriptors into broad runtime execution.

## Boundary

- `/api/command-registry` is a bounded registry summary. It may expose providers, families, startup command summaries, approval posture, and runtime posture; it must not load full schemas into the model context by default.
- `/api/commands/search` is a bounded discovery endpoint. It returns summary descriptors plus explicit non-executable `execution.runtimeStatus`, `effect`, and `approval` so agents can decide what to learn next without receiving full request schemas.
- `/api/commands/learn` is the explicit detail endpoint for a selected command. It may return schema, policy, transport, and auth details for one command, but it is still read-only and must not mint handles or execute commands.

## Generated booking posture

Generated booking commands sourced from the Sonik booking OpenAPI/ORPC contract remain:

- `transport.runtimeStatus: "shadow"`
- `effect: "write" | "destructive"` for mutations
- `approval: "required"` for mutations
- non-executable through registry/search/learn/catalog helpers

Runtime promotion must happen through a trusted mounted host adapter and explicit grants, not by editing generated artifacts to mark broad generated writes as mounted.

## Release evidence

The release gate is encoded in `tests/unit/global-command-registry-discovery-gate.test.mjs` and is part of `pnpm test`. It proves:

1. registry summary includes generated provider and command counts;
2. default registry payloads stay bounded and schema-free;
3. booking page context narrows discovery without broad schema loading;
4. selected demo write commands are discoverable, approval-gated, explicitly non-executable in search, and still shadow;
5. destructive generated commands remain approval-gated and shadow;
6. discovery/catalog helpers deny execution with `runtime_not_mounted:shadow` and `orpc_execution_adapter_not_mounted`.
