# Deep-Dive Suite — Build Specification (binding for all page builders)

Output dir: `docs/product/agent-workspace-marketplace/deep-dive/`
Shared assets (already written, do not modify): `assets/tokens.css`, `assets/nav.js`.

## Page skeleton (exact)

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><NN> · <Title> — Agent Marketplace Deep Dive</title>
<link rel="stylesheet" href="assets/tokens.css">
<script src="assets/nav.js" defer></script>
<style>/* page-specific styles ONLY, composed from tokens.css variables */</style>
</head>
<body data-doc="<doc-id from nav.js manifest>">
<main class="page">
  <header class="page-head">
    <h1><Title></h1>
    <p class="lead">One-paragraph thesis of the document.</p>
    <p class="doc-meta">Source: docs/.../<file>.md · Corpus 2026-07-07 · Status updated 2026-07-11</p>
  </header>
  <!-- sections -->
</main>
</body>
</html>
```

Nav bar and prev/next pager are injected by `nav.js` — do not hand-build them.

## Design law (violations are rejects, not style preferences)

BANNED: gradients anywhere (including gradient text); emoji; `border-left`/`border-right`
accent stripes; Inter/Roboto (fonts come from tokens.css only); glassmorphism/backdrop
blur; box shadows; uppercase tracked eyebrows above sections; numbered section
eyebrows (01 · / 02 ·) as scaffolding; hero-metric template (big number + tiny label
grids); identical repeated card grids; chart libraries or any external resource
(every page fully self-contained except the two shared assets); `<canvas>` charts.

REQUIRED: components from tokens.css (`.panel`, `.callout[.ok|.warn|.danger]`,
`.chip`, `.ledger`, `.flow`, `.viz-frame`, tables); body text uses `--body` on
`--bg`/`--surface-*` only (contrast is pre-verified in the tokens — do not invent
colors; raw hex outside tokens.css variables is a reject, use `var(--...)`);
density over decoration — operational facts, not marketing air; headings carry
hierarchy, not decoration.

## Visualization law

- Charts are inline SVG built from REAL data in the source document (counts,
  dates, tiers, matrices, sequences). Fabricating numbers or benchmarks is the
  worst possible failure. If a dataset is thin, render a table instead — an
  honest table beats a decorative chart.
- SVG conventions: `role="img"` + `<title>`; text >= 12px, fill `var(--muted)`
  or `var(--ink)`; gridlines `var(--line)`; axes `var(--line-strong)`; series
  colors in order `var(--accent)`, `var(--viz-2..5)`; no gradients or filters.
  Wrap charts in `<figure class="viz-frame">` with a real `<figcaption>`.
- Good shapes for this corpus: release-slice timelines (R0–R6), trust-tier
  ladders, flow diagrams (`.flow` divs for pipelines; SVG for branching graphs),
  coverage matrices (built vs planned), decision timelines, dependency maps,
  comparison tables with chips.
- Every page needs at least two genuine visualizations IF the source data
  supports them; never pad with decorative ones.

## Content law

- The source markdown is authoritative for direction; the STATUS ADDENDUM below
  is authoritative for current implementation truth. The corpus was written
  2026-07-07; several things it calls "planned" have since shipped. Every
  built/planned claim on your page must be reconciled against the addendum and
  marked with chips: `SHIPPED` (.chip.ok), `FIXTURE` (.chip.accent), `PLANNED`
  (.chip), `BLOCKED/OPEN` (.chip.warn), `MISSING` (.chip.danger).
- Do not soften or editorialize invariants (execution-inert renderer, chat is
  never approval, receipts-only success copy). Quote command/field names in
  `<code>`. Cite file paths in `.doc-meta`-style mono where load-bearing.
- Prose is tight and technical. No filler ("in today's fast-moving world"),
  no repeated title-then-restated-description stuffing.

## STATUS ADDENDUM — implementation truth as of 2026-07-11 (branch emdash/yellow-zebras-smell-txxjz)

Shipped this week on top of the corpus (all full-chain green, committed, pushed):
- Capability-ID registry (D013): `packages/tool-contracts/src/capability-registry.ts`
  — registered/versioned ids, per-call gating (`evaluateCapabilityAccess`),
  write-implies-read implication (direct grants take precedence; implication
  never narrows), kill-switch via `revokedCapabilityIds`.
- Workflow run state machine (consensus plan Phase 1): `workflow-run-state.ts` —
  Zod-validated `WorkflowRunState`, pure reducer (Decider pattern), host-signed
  approval structurally required (`model_supplied_approval_is_not_trusted`),
  phase `committed` only on semantic-success receipts.
- Read-side convergence (Phase 2): one shared approval-affordance builder feeds
  both intake and reservation flows (D011 seam), proven byte-identical.
- Workflow controller (Phase 3a): `workflow-controller.ts` — one generic
  interpreter over `workflowDefinitionSchema`; reservation fixture revised to
  ONE compound commit node matching shipped one-Approve behavior; mutating
  effects refused outside the commit gate at schema AND controller layers.
  NOT yet wired into the live request path (open decision: Phase 3a-2 cutover).
- Per-node approval (Phase 3b): approving commit node A never approves node B;
  untargeted approvals rejected in multi-commit graphs; terminal phase requires
  all commit nodes committed.
- Grant synthesis (Phase 4 part 1): live policy reproduced exactly through the
  registry; live pinning BLOCKED on registry coverage (8 registered capabilities
  vs 72 live catalog commands — open decision).
- A2 reservation commit path is MERGED and live (preview tool + approval card +
  `/api/reservation/commit`); the 2026-07-08 handoff's "A2 UI half open" is stale.
- New research doc: `docs/research/stateful-runtimes-landscape-2026-07.md` —
  July 2026 ecosystem scan; direction ratified: keep the Decider-pattern reducer;
  no OSS engine combines JSON workflow docs + one interpreter + typed host-signed
  approval boundary.

Still NOT built: marketplace ORPC routes, persistence/RLS tables, install UI,
publishing/moderation, trust-tier field, revocation UI, live controller cutover.

## Acceptance (self-check before finishing)

1. File opens standalone (only relative links to the two shared assets).
2. Zero grep hits in your file for: `gradient`, `border-left`, `border-right`,
   `Inter`, `Roboto`, `box-shadow`, emoji codepoints, `http://`/`https://`
   resource loads (external links in prose `<a href>` are fine; loading
   resources is not), `#` raw hex colors outside an svg `fill`/`stroke` that
   should be var() anyway (use var() everywhere).
3. Headings form a strict h1>h2>h3 outline; tables have `<th>`; SVGs have titles.
4. Chips/status reconciled against the STATUS ADDENDUM.
5. It reads like a senior platform engineer's brief, not a template.
