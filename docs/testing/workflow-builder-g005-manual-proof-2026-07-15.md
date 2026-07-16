# Workflow Builder G005 — Browser and Accessibility Proof (2026-07-15)

**Source baseline:** `f0eb3f2bb93328f903dad5daebaa7e9daae91473` plus the Task 1 UI repair recorded with this proof
**Surface:** standalone and signed embedded Workflow Builder, desktop Chromium
**Scope:** UI-01–UI-05, UI-06 regression, E2E-01, E2E-03, OBS-01

## Operator run

| Check | Action | Result |
|---|---|---|
| Lifecycle | Open builder, edit the draft title, attempt Back, cancel, save, then Back | PASS — `new → dirty → saved`; discard dialog appears only while dirty |
| Model catalog | Load 35 metadata-backed models; inspect collapsed viewport; search the final row; select by pointer, End/Home/Enter, expand/collapse | PASS — exactly ten 80 px rows in the 800 px viewport; all 35 searchable; count, selection, Video/Agent/Audio announced |
| Capability readiness | Open `amplify.campaign`; inspect callable preview and blocked create capability | PASS — callable state plus actionable not-implemented, incompatible, context, grant, kill-switch, pin, preview, and approval reasons; blocked family cannot leave `off` |
| Canvas focus order | Focus node, ArrowRight to output, ArrowLeft to input, Enter to title inspector | PASS — focus moves in the expected node/port/inspector order |
| Canvas editing | Press Alt+Shift+A, connect, undo, redo, disconnect; inspect live status | PASS — Add executes without pointer input; every mutation is announced through the canvas live region |
| Validation | Press Alt+Shift+V after a valid edit and after clearing a required field | PASS — the distinct Validate control reports “Workflow is valid” or the first actionable validation issue through the builder live region |
| Organizer | Open Organizer and inspect identity, instructions, knowledge, curated capabilities, test, publish, approval, recent-run, and receipt affordances | PASS — rendered as a graph-free projection; no raw graph, MCP, or model-administration surface |
| Debug context | Open Debug & Preview | PASS — persistent “Isolated preview context” and “read/preview only” truth are visible |
| Governed run | Signed embedded fixture: save, run, preview, approve, commit, inspect receipt | PASS — existing product-path test keeps the signed host header on catalog, definition, and run requests and renders `campaign-fixture-receipt` |
| Trace inspection | Start a run, press Alt+Shift+T | PASS — the trace disclosure opens and focus moves to its summary; trace rows are then available as named keyboard controls |
| Resume wait | Start a workflow paused at a human waitpoint, enter an answer, then press Alt+Shift+M and activate Answer & resume | PASS — focus moves to the resume action and the resumed status is announced |
| Correlation | Open History with the governed causal projection | PASS — session, conversation run, workflow run, node, tool call, approval, artifact, receipt, request, and trace identifiers are visible together |

## Accessibility smoke

- PASS — browser accessibility-tree snapshot exposes Organizer configuration, Test, Publish, and Review approvals as named controls.
- PASS — focus remains visible and deterministic across Add → node → ports → inspector → Validate → trace row → named waitpoint answer; pointer-only behavior was not used for the keyboard path.
- PASS — polite live regions announce lifecycle, model count/selection, canvas changes, and builder-control availability.
- PASS — disabled capability and workflow actions expose readable reasons rather than color-only state.
- PASS — native buttons, textboxes, tabs, listbox/options, headings, and status roles provide the screen-reader navigation landmarks used by the smoke.

## Automated evidence

```text
pnpm exec playwright test -c tests/e2e/playwright.config.ts tests/e2e/workflow-builder.spec.ts --project=chromium
pnpm exec playwright test -c tests/e2e/playwright.config.ts tests/e2e/workflow-builder-embed.spec.ts --project=chromium
```

The deterministic `/api/generate` fixture asserts the outgoing `draftAgentId` before returning the workflow draft stream; it does not bypass the real composer, request, draft, canvas, or save path.
