# Dev Workbench runtime ownership

Status: implementation handoff for the Agent UI Dev Workbench.

## Decisions

- Keep executable skills and JavaScript on the filesystem. SQLite may store blobs, but it stores only the installed version, digest, enabled state, onboarding completion, event index, and derived memories.
- Install skills from a pinned manifest. On startup, compare the installed digest and run `npx skills add` only when the manifest changed; persistent sandbox snapshots make reinstalling every boot unnecessary.
- Launch OMX inside the Workbench-owned tmux session with `omx --direct`; do not launch a second nested tmux session.
- Treat the sandbox SQLite database as rebuildable local state. Beacon actor `c.db`, Postgres, and private object storage own state that must survive sandbox deletion.
- Persist observable traces and explicit session summaries, not private chain-of-thought.
- Use the provider HTTPS domain returned by Vercel Sandbox for hot servers. A Cloudflare Tunnel is unnecessary inside Vercel Sandbox; use one only for a developer-machine server that an HTTPS deployment must reach.
- Agent UI, Booking, and Amplify each receive a server-owned repository profile with pinned clone revision and repository-owned install, dev, test, build, and database commands. Browser input cannot supply arbitrary commands or repositories.

## Sonik Agent UI team owns

1. Bootstrap OMX, project hooks, the pinned skill manifest, and the startup context prompt.
2. Provide authenticated CLI seams without putting credentials in page state.
3. Add repository profiles for Agent UI, Booking, and Amplify, including hot-server ports and local development database commands.
4. Keep booking and Amplify domain databases compatible with their production contracts. The Workbench memory SQLite database is not a substitute for Postgres.
5. Subscribe to the Beacon `agentChannel`, persist a bounded local JSONL/SQLite index, and restore from the last cursor.
6. Consume a normalized visual-grounding response and map its box or point to the existing DOM target registry, source metadata, and repository file.
7. Inject only a short startup summary plus paths to current page context, host authority, OpenAPI, sitemap, screenshot, visual target, logs, and memory search.
8. Verify reload, navigation, sandbox resume, hot reload, and teardown behavior before promotion.

## Operator / companion-agent owns

1. Host and authenticate the visual-grounding service.
2. Return normalized boxes or points; Workbench does not depend on the model implementation.
3. Run the Hermes post-session job that turns immutable event evidence into versioned derived memories.
4. Implement and approve MCP servers and their scopes.
5. Create secret values and choose which Vercel environments receive them.
6. Operate Beacon, Pipe B, model-serving hardware, and database infrastructure.
7. Review model licensing. `yuuko-eth/LocateAnything-3B-GGUF` inherits NVIDIA's non-commercial research license and requires a forked `llama.cpp` build, the vision projector, and `--special` for coordinate tokens.

## Visual-grounding seam

The operator-owned service returns:

```json
{
  "requestId": "uuid",
  "screenshotDigest": "sha256:...",
  "query": "reorganize this segment",
  "targets": [
    {
      "label": "Reservation controls",
      "kind": "box",
      "coordinates": [112, 220, 718, 368],
      "coordinateSpace": "pixels",
      "confidence": 0.94
    }
  ]
}
```

Workbench validates the screenshot digest and page revision, intersects the result with captured DOM rectangles, and produces the agent-facing target:

```json
{
  "targetId": "booking.reservation.toolbar",
  "role": "toolbar",
  "label": "Reservation controls",
  "source": {
    "file": "apps/booking/src/lib/ReservationToolbar.svelte",
    "line": 48
  },
  "screenshotPath": "/vercel/sandbox/workspace/.sonik/screenshots/latest.png"
}
```

## Memory contract

- Raw events are append-only evidence.
- Derived memories retain their source event IDs, summarizer version, creation time, confidence, and verification result.
- Success is measured from commands, tests, deployment receipts, or user confirmation, never the agent's self-report.
- SQLite FTS5 is the first search implementation. Add embeddings only after measured retrieval failures.
- Startup loads a bounded summary; detailed memories are searched on demand.

## Configuration boundary

Vercel configuration selects profiles and supplies secrets. Workbench code explicitly allowlists what crosses into the sandbox.

Suggested server-side keys:

```text
DEV_WORKBENCH_STARTUP_PROFILE
DEV_WORKBENCH_BEACON_URL
DEV_WORKBENCH_BEACON_TOKEN
DEV_WORKBENCH_VISUAL_GROUNDING_URL
DEV_WORKBENCH_VISUAL_GROUNDING_TOKEN
DEV_WORKBENCH_MCP_PROFILE
DEV_WORKBENCH_GITHUB_TOKEN
DEV_WORKBENCH_CLOUDFLARE_ACCOUNT_ID
DEV_WORKBENCH_CLOUDFLARE_API_TOKEN
DEV_WORKBENCH_PIPE_B_WORKER
```

Rules:

- Mark credentials sensitive and scope them to the minimum environment and permissions.
- Never forward Vercel, GitHub, Cloudflare, host-authority, or database credentials to browser JavaScript.
- The sandbox receives only the variables required by its selected profile.
- Environment changes require a new Workbench deployment and a fresh sandbox.
- Startup commands are checked-in profile data, not arbitrary environment-variable or browser input.

## Hot-server and database profiles

- **Agent UI:** run the standalone SvelteKit development server with its isolated development session store and configured private file bucket.
- **Booking:** run its repository-owned development server against an isolated Postgres database or disposable database branch seeded with development fixtures.
- **Amplify:** use the same isolated-database rule and its repository-owned development commands.
- Each profile publishes its port through `sandbox.domain(port)`, records the resulting HTTPS origin in page context, and prohibits production database credentials.

## Promotion gate

1. `pnpm check:workbench`
2. `pnpm build:workbench`
3. Deploy a Vercel Preview from `apps/dev-workbench`.
4. Verify Basic Auth, workspace creation, terminal, preview hydration, page-context sync, screenshot capture, reload, navigation, and sandbox resume.
5. Promote only after the Preview receipt and manual evidence are attached to the PR.
