# Booking command copy-retrofit proof pack

## Outcome

This slice preserves booking-service generated command truth before expanding live agent execution. The Agent UI should not handwrite the booking command catalog. It should consume generated OpenAPI/command-registry artifacts, validate them deterministically, then mount live execution through a trusted host/runtime adapter.

## Direct-copied upstream proofs

| Upstream | Revision | Destination | Purpose |
| --- | --- | --- | --- |
| `sonik-booking-service` | `4324559be7f9533a0557dc0363f2fcfebb1cb6d9` | `docs/upstream-proofs/booking-service/` | Full booking OpenAPI, generated SDK command registry, SDK registry constants, booking-side registry check script. |
| `sonik-mcp` | `befe393f69580297eff5605938f1ee9e685af245` | `docs/upstream-proofs/sonik-mcp/` | Command-OS doctrine and CLI/MCP parity-policy test patterns. |

The copy manifests are:

- `manifests/copy-retrofit/booking-service-generated-command-registry.json`
- `manifests/copy-retrofit/sonik-mcp-command-doctrine.json`

Both manifests have `allowedLocalModifications: []`; copied proof files must remain direct-copy islands.

## Booking command counts

The copied full booking OpenAPI currently contains **72** HTTP operations. The Agent UI generator fixture now uses that full copied OpenAPI as the authoritative command-generation surface:

- copied full OpenAPI operations: `72`
- Agent UI generator fixture operations: `72`
- Agent UI generated commands: `72`
- copied booking SDK command registry commands: `71`
- global Agent UI registry commands after promotion: `72`

The full copied OpenAPI is the source of truth for Agent UI. The copied booking SDK command registry is retained as provenance evidence and as a booking-side drift signal, but it is no longer allowed to mask current OpenAPI operations.

## Known upstream registry drift

The copied booking SDK `sonik-command-registry.generated.json` still embeds older source provenance from `emdash/major-schools-raise-3zsc2` and lags the current copied OpenAPI surface. The explicit reviewed drift is:

- missing from copied SDK registry but present/generated from current OpenAPI: `booking.search.guests`, `booking.create.guest`, `booking.get.media.asset.variant`
- stale in copied SDK registry but absent from current OpenAPI: `booking.search.customers`, `booking.create.customer`

The Agent UI fixture anchors its provenance to the copied current full OpenAPI hash:

```txt
936f732d40a9dada43bc6986b9871e8e3c4ee538c4547c5199f66646b0951955
```

Follow-up for booking-service: regenerate/publish its SDK command registry so the copied SDK registry provenance and command set point at the same current OpenAPI source revision/hash. Until then, Agent UI gates every generated command against the copied full OpenAPI method/path/operationId and separately gates the exact known copied-SDK drift list above.

## Deterministic gates

Run:

```bash
pnpm check:copy-retrofit:booking
pnpm check:commands
pnpm test
```

`check:copy-retrofit:booking` proves:

1. copied upstream files match manifest integrity;
2. fixture provenance cites the copied full OpenAPI revision/hash;
3. full source operation count is 72 and the generated fixture uses all 72 operations;
4. every generated Agent UI command maps back to the copied OpenAPI method/path/operationId;
5. copied booking SDK command-registry drift is limited to the explicit reviewed guest/customer/media delta;
6. global registry promotes all 72 booking commands without local absolute paths;
7. copied Sonik MCP doctrine/proof files remain direct-copy only.

## Runtime boundary

This slice does **not** mark all booking commands executable. Generated booking commands stay metadata/shadow until a trusted booking runtime adapter mounts them. The execution rules remain:

- reads use `executeCommand`;
- writes/destructive actions use `commitCommand`;
- model input cannot self-approve;
- trusted host/session/org context controls authorization;
- receipts include policy, trace, next actions, and errors.
