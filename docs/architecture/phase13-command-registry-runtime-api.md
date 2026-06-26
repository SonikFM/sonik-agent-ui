# Phase 13 — Command registry runtime API v0

This slice makes the generated global command registry smoke-testable at runtime without mounting generated booking writes.

## Boundary

The runtime API is read-only discovery/learning:

- `GET /api/command-registry` returns global registry summary, host-family registry, and schema-free startup index.
- `GET /api/commands/search?q=...` searches the generated command catalog and annotates commands that are relevant to the supplied page/surface context.
- `GET /api/commands/learn?id=...` returns one selected command's schema/policy/auth/transport details.

Generated ORPC/OpenAPI commands remain `runtimeStatus: shadow` in the global registry. This API does **not** execute booking writes, create reservations, or bypass host approval. Runtime execution still belongs to mounted host adapters and trusted session/org context.

## Smoke examples

Registry summary:

```bash
curl -fsS 'https://sonik-agent-ui.liam-trampota.workers.dev/api/command-registry' | jq '.summary'
```

Booking surface search:

```bash
curl -fsS 'https://sonik-agent-ui.liam-trampota.workers.dev/api/commands/search?q=booking%20context&surface=booking-admin&commandFamilies=booking&skillFamilies=sonik-booking&authenticated=true&organizationId=org_smoke&limit=8' \
  | jq '.commands[] | {id,title,effect,approval,contextLoaded}'
```

Learn before execution:

```bash
curl -fsS 'https://sonik-agent-ui.liam-trampota.workers.dev/api/commands/learn?id=booking.create.booking&aspects=schema,policy,transport,auth' \
  | jq '{ok,commandId,effect,approval,transport,auth}'
```

Expected posture for booking creation commands in v0:

- discoverable through search;
- learnable with schemas and policy;
- `effect: write` and `approval: required`;
- `transport.runtimeStatus: shadow` until a booking runtime adapter explicitly mounts writes.

## Embedding smoke use cases

### Booking app

Open the booking host and use the embedded Agent UI:

```text
Using the current page context, search the command registry for booking context and reservation commands. Show me what can be learned now and what cannot execute yet.
```

Expected: the assistant can show command ids and explain that creation requires a mounted runtime adapter and trusted approval.

### Amplify campaign wizard

Open Amplify on a campaign wizard page and use the embedded Agent UI:

```text
Using this page context, search for campaign wizard commands and explain the next command you would learn before creating a campaign wizard execution.
```

Expected: Amplify host context should narrow command discovery to the campaign family once the Amplify host registry is donated. Amplify remains a host availability/grant envelope, not a separate canonical command manifest.

## Verification

- `pnpm check:commands:sonik-global`
- `node --experimental-strip-types tests/unit/sonik-global-command-registry.test.mjs`
- `node --experimental-strip-types tests/unit/global-command-registry-runtime.test.mjs`
- `pnpm test`
- `pnpm check-types`
- `pnpm build`
