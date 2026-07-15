# Workflow Builder G005 — Browser and Accessibility Proof (2026-07-15)

**Source:** `506a466a70a38c011c5001e73909d3210159eefc`  
**Surface:** standalone and signed embedded Workflow Builder, desktop Chromium  
**Scope:** UI-01–UI-05, UI-06 regression, E2E-01, E2E-03, OBS-01

## Operator run

| Check | Action | Result |
|---|---|---|
| Lifecycle | Open builder, edit the draft title, attempt Back, cancel, save, then Back | PASS — `new → dirty → saved`; discard dialog appears only while dirty |
| Model catalog | Load 35 metadata-backed models; inspect collapsed viewport; search the final row; select by pointer, End/Home/Enter, expand/collapse | PASS — exactly ten 80 px rows in the 800 px viewport; all 35 searchable; count, selection, Video/Agent/Audio announced |
| Capability readiness | Open `amplify.campaign`; inspect callable preview and blocked create capability | PASS — callable state plus actionable not-implemented, incompatible, context, grant, kill-switch, pin, preview, and approval reasons; blocked family cannot leave `off` |
| Canvas focus order | Focus node, ArrowRight to output, ArrowLeft to input, Enter to title inspector | PASS — focus moves in the expected node/port/inspector order |
| Canvas editing | Add, connect, undo, redo, disconnect; inspect live status | PASS — each operation is keyboard reachable and announced through the canvas live region |
| Organizer | Open Organizer and inspect identity, instructions, knowledge, curated capabilities, test, publish, approval, recent-run, and receipt affordances | PASS — rendered as a graph-free projection; no raw graph, MCP, or model-administration surface |
| Debug context | Open Debug & Preview | PASS — persistent “Isolated preview context” and “read/preview only” truth are visible |
| Governed run | Signed embedded fixture: save, run, preview, approve, commit, inspect receipt | PASS — existing product-path test keeps the signed host header on catalog, definition, and run requests and renders `campaign-fixture-receipt` |
| Correlation | Open History with the governed causal projection | PASS — session, conversation run, workflow run, node, tool call, approval, artifact, receipt, request, and trace identifiers are visible together |

## Accessibility smoke

- PASS — browser accessibility-tree snapshot exposes Organizer configuration, Test, Publish, and Review approvals as named controls.
- PASS — focus remains visible and deterministic across node → ports → inspector; pointer-only behavior was not used for the keyboard path.
- PASS — polite live regions announce lifecycle, model count/selection, canvas changes, and builder-control availability.
- PASS — disabled capability and workflow actions expose readable reasons rather than color-only state.
- PASS — native buttons, textboxes, tabs, listbox/options, headings, and status roles provide the screen-reader navigation landmarks used by the smoke.

## Automated evidence

```text
pnpm exec playwright test -c tests/e2e/playwright.config.ts tests/e2e/workflow-builder.spec.ts --project=chromium
pnpm exec playwright test -c tests/e2e/playwright.config.ts tests/e2e/workflow-builder-embed.spec.ts --project=chromium
```

The deterministic `/api/generate` fixture asserts the outgoing `draftAgentId` before returning the workflow draft stream; it does not bypass the real composer, request, draft, canvas, or save path.
