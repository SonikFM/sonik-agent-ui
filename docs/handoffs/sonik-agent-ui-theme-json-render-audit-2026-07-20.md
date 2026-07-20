# Sonik Agent UI theme and JSON-render audit

**Audit date:** 2026-07-20  
**Scope:** current `sonik-agent-ui` checkout plus fresh GitHub evidence for `SonikFM/sonik-svelte` PRs [#2](https://github.com/SonikFM/sonik-svelte/pull/2)–[#8](https://github.com/SonikFM/sonik-svelte/pull/8).  
**Labels:** **complete** = implemented and covered in this repository; **partial** = useful implementation with a named gap; **stub** = demonstrator or inventory without a production path; **missing** = no current implementation.

## Executive status

| Area | Status | Current truth |
|---|---|---|
| DaisyUI/Tailwind theme authority | **complete** | The standalone app installs DaisyUI `5.5.23` and Tailwind 4. `app.css` imports DaisyUI themes first and maps compatibility aliases back to Daisy semantic variables rather than creating another token authority. |
| Operator Dark and embedded host precedence | **complete** | `sonik-operator-dark` is the registry default. `resolveEmbeddedThemeSetting` prefers a valid host theme, then stored preference, then the operator default; the targeted unit test covers all three branches. |
| Theme picker and system response | **complete** | The native select exposes product, experimental, and DaisyUI comparison themes. Runtime application updates `data-theme`, `data-theme-setting`, `data-color-scheme`, and `color-scheme`; system-mode media changes are observed. |
| Theme/component conformance | **partial** | Most shared primitives consume semantic aliases. The audited baseline still has a left-stripe `Callout` and a gradient-text shimmer; these conflict with the stated Sonik/Hallmark bans even though their colors are semantic. The shimmer does stop animation for reduced motion, but the fallback does not restore ordinary text paint. |
| JSON-render core and Svelte runtime | **complete** | Workspace packages provide `@json-render/core` and `@json-render/svelte`, including validation, state, actions, repeat/visibility, streaming, directives, and the Svelte provider/renderer path. |
| Sonik JSON-render catalog/registry | **complete** | `explorerCatalog` and `registry.ts` bind 33 components across layout, display, input, intake, and action tiers. Tool input validates against the same catalog schemas used by rendering. |
| Artifact creation, promotion, state, and receipts | **complete** | `createJsonArtifact` parses bounded stringified input, applies lossless repair, validates structure and catalog props, then emits the artifact envelope. Promotion, controlled state persistence, version conflict handling, and inert intake/action receipts have targeted tests. |
| Devtools | **partial** | Vendored core and Svelte adapters are mounted only in dev and protected by their production no-op. The panel receives the live state store, but the audited baseline passes `catalog={null}`, so its catalog tab cannot describe the real 33-component surface. |
| JSONL and mixed streams | **complete** | Core implements JSONL patch parsing and mixed prose/spec streams; the app taps generate streams and promotes partial/complete specs into the canvas. |
| YAML wire path | **partial** | Core prompt/edit-mode code contains YAML instructions, but this checkout has no `@json-render/yaml` workspace package or wired standalone YAML intake. It is upstream inventory, not a product path here. |
| shadcn-svelte relationship | **partial** | The app retains copied shadcn-style Svelte primitives for selected controls, but `app.css` projects them onto Daisy/Sonik variables. There is no separate `@json-render/shadcn-svelte` package in this checkout; the product registry remains the authority. |
| Codegen, Ink, MCP, image, React Email/PDF/Three | **missing** | No production integration was found in the audited JSON-render path. Upstream changelog mentions some adjacent renderers, but that is not local functionality. |

## Theme and component architecture

```text
theme-registry.ts
  ├─ custom product/experimental IDs
  ├─ bundled DaisyUI IDs
  └─ metadata: group + light/dark scheme
            │
            ▼
theme-runtime.ts ── local preference / system / embedded host precedence
            │
            ▼
<html data-theme data-theme-setting data-color-scheme style.colorScheme>
            │
            ▼
DaisyUI semantic variables
  ├─ app surface aliases in app.css
  ├─ copied shadcn-style primitives
  └─ JSON-render components
```

The authority boundary is coherent: DaisyUI owns semantic colors and geometry; Sonik custom themes supply Daisy variables; compatibility aliases consume those variables. Gunmetal remains a supported product family, but it is not the embedded default. A valid embedded host theme wins by contract.

### Hallmark and Impeccable findings

These are review lenses, not additional design systems.

1. **High — Hallmark / design-ban mismatch:** `Callout.svelte` uses `border-l-4` as a structural status accent. The colors are semantic (`info`, `success`, `warning`, `secondary`), but the left stripe is explicitly banned by the current product guidance. Use the existing Daisy alert/status vocabulary without a directional stripe.
2. **High — Hallmark / motion mismatch:** `.animate-shimmer` uses a text gradient. It is applied to thinking/tool status copy, conflicts with the no-gradient rule, and reduced-motion mode only disables animation without restoring normal text fill. A semantic solid-color status is the smaller and clearer solution.
3. **Medium — Impeccable / hierarchy:** the theme picker is a native, labeled select and is appropriately low-risk. However, exposing every bundled Daisy theme makes a comparison tool visually adjacent to product themes; the existing grouping prevents authority confusion and should be preserved.
4. **Medium — Impeccable / system feedback:** JSON-render state and receipt paths are explicit and tested, but devtools omits the actual catalog. Passing the type-compatible catalog would make component validity inspectable rather than forcing developers to infer it.
5. **Low — anti-slop boundary:** copied shadcn-style primitives are acceptable only as implementation details backed by Daisy/Sonik variables. Do not import donor theme systems, generated tokens, or a second registry to solve isolated component gaps.

## Functional JSON-render path

```text
agent / trusted tool call
        │
        ▼
createJsonArtifact
  parse → lossless repair → core structural validation → explorerCatalog validation
        │
        ▼
tool result / stream data parts
        │
        ├─ mixed JSONL stream → partial preview
        └─ complete spec → promotion decision / artifact warehouse
                              │
                              ▼
                    JsonArtifactRenderer
                    JsonUIProvider + Renderer
                              │
                              ▼
                  33-component Sonik registry
                              │
                actions + controlled state changes
                              │
                              ▼
          trusted state endpoint / versioned persistence / telemetry
                              │
                              └─ dev-only JsonRenderDevtools
                                 (live store, catalog absent in baseline)
```

The primary files are:

- `packages/core/src/` — spec types, validation, JSONL/mixed streams, directives, actions, prompt/edit modes.
- `packages/svelte/src/` — Svelte providers, element rendering, state, actions, validation, visibility, repeat scopes, and directives.
- `apps/standalone-sveltekit/src/lib/render/catalog.ts` — agent-visible component schemas.
- `apps/standalone-sveltekit/src/lib/render/registry.ts` — Svelte component bindings.
- `apps/standalone-sveltekit/src/lib/render/component-registry.ts` — readable 33-component inventory.
- `apps/standalone-sveltekit/src/lib/tools/artifact.ts` — strict creation boundary.
- `packages/json-ui-runtime/src/renderer/JsonArtifactRenderer.svelte` — app-facing provider/renderer wrapper.
- `apps/standalone-sveltekit/src/routes/+page.svelte` — stream intake, promotion, canvas, controlled store, and devtools mount.

Directives are implemented in core and propagated through the Svelte provider, but the standalone catalog does not register product-specific directives. That is correct until a concrete use case needs one. Markdown streaming and structured JSON rendering remain separate paths.

## Fresh donor PR audit

All seven PRs were still open when queried on 2026-07-20. None is approved for bulk merge.

| PR | Fresh GitHub state | Local status | Decision |
|---|---|---|---|
| [#2 — remaining 18 AI elements](https://github.com/SonikFM/sonik-svelte/pull/2) | **OPEN / BEHIND**; `unit + build + size` failed; 210-file scope exceeded automated review limits. | **partial** — this repo has its own chat surface and JSON-render components, not this 18-family donor wave. | Salvage only a named behavior after a local gap, token, accessibility, and test review. Do not adopt its parallel registry wholesale. |
| [#3 — svelte-streamdown](https://github.com/SonikFM/sonik-svelte/pull/3) | **OPEN / UNSTABLE**; CI failed and a11y E2E was skipped. | **missing** as a dependency; current chat text and JSON-render streaming are independent. | Evaluate streamed Markdown separately only if current Markdown behavior is proven insufficient. It does not replace JSON-render. |
| [#4 — Chat + EmojiPicker](https://github.com/SonikFM/sonik-svelte/pull/4) | **OPEN / UNSTABLE**; CI failed and a11y E2E was skipped. | **partial** — local chat exists; the donor Chat/EmojiPicker pair is not integrated. | Reject direct copy. Product guidance bans emoji as structural chrome; salvage only an explicit user-content requirement with Sonik tokens and accessibility proof. |
| [#5 — FinalChat composer/scroll](https://github.com/SonikFM/sonik-svelte/pull/5) | **OPEN / BLOCKED**; CI failed, a11y E2E skipped, review changes requested. | **partial** — local composer/conversation behaviors exist without this donor branch. | Keep blocked until the review and accessibility contract are resolved; compare behaviors, not files. |
| [#6 — hooks + Kbd/Separator](https://github.com/SonikFM/sonik-svelte/pull/6) | **OPEN / UNSTABLE**; CI failed and a11y E2E was skipped. | **partial** — a local Separator already exists; no equivalent donor hook/Kbd adoption was found. | Reuse the local primitive. Inventory a hook only when a caller needs it; avoid duplicate component families. |
| [#7 — theme toggle/kitchen sink](https://github.com/SonikFM/sonik-svelte/pull/7) | **OPEN / BLOCKED**; CI failed; review requested safe storage parsing and deduplicated slug logic. | **complete** for the needed theme runtime; **stub** for a donor kitchen-sink demo. | Keep the stronger local registry/runtime and host precedence. Salvage isolated demo scenarios, never the donor theme authority. |
| [#8 — Sonik Inbox](https://github.com/SonikFM/sonik-svelte/pull/8) | **OPEN / CLEAN**, but based on PR #2 rather than `main`; automated review was skipped for the non-default base. The PR describes local mock data and no backend/DB/LLM. | **stub** — product exploration, not a production inbox path in this repo. | Treat as a behavior prototype. Extract queue, capability-honesty, or approval-node requirements independently after #2 coupling is removed. |

The common CI failure shown on the donor branches is dependency/lockfile drift during `npm ci`, including Storybook and `streamdown-svelte` mismatches. A green malware scan or CodeRabbit status does not make the implementation merge-ready, and PR #8's clean merge state does not remove its dependency on unmerged PR #2.

## Ranked follow-up

1. **P0 — finish the two surgical conformance fixes:** replace the Callout stripe with semantic Daisy status styling and replace shimmer gradient text with a solid semantic status; retain a reduced-motion regression check.
2. **P0 — attach the real catalog to devtools:** pass `explorerCatalog` if its type matches the Svelte adapter, preserving both the `$app/environment` dev gate and package production guard. Test that the catalog is non-null and production remains inert.
3. **P1 — run integrated visual/accessibility proof:** verify Operator Dark, gunmetal light/dark, system mode, embedded host override, keyboard focus, contrast, and reduced motion against representative chat, canvas, and intake artifacts.
4. **P1 — keep one catalog authority:** add or adapt components only through `catalog.ts` + `registry.ts` + a targeted rendering test. Do not introduce the donor AI-elements registry or a separate shadcn theme authority.
5. **P2 — donor behavior matrix:** if a current product story needs streamed Markdown, composer scroll, Kbd, or Inbox behavior, extract one behavior at a time from PRs #2–#8 after their failing checks and accessibility findings are resolved.
6. **P3 — defer secondary renderers:** codegen, Ink, MCP, image, React Email/PDF/Three, and a full YAML wire package remain out of the primary product path until a concrete user story and trust boundary exist.

## Evidence and commands

Fresh GitHub evidence:

```bash
gh pr list -R SonikFM/sonik-svelte --state all --limit 20 \
  --json number,title,state,isDraft,createdAt,updatedAt,closedAt,mergedAt,mergeStateStatus,url,headRefName,baseRefName,statusCheckRollup
gh pr view {2..8} -R SonikFM/sonik-svelte \
  --json number,title,body,files,reviews,comments,commits
```

Repository evidence:

```bash
node --experimental-strip-types -e \
  "import('./apps/standalone-sveltekit/src/lib/render/component-registry.ts').then(m => console.log(m.JSON_RENDER_COMPONENT_IDS.length))"
rg -n "data-theme|DaisyUI|daisyui" apps/standalone-sveltekit/src tests/unit/theme-runtime.test.mjs
rg -n "JsonArtifactRenderer|JsonRenderDevtools|json-render|JSONL|yaml|directive" apps packages tests/unit
rg -n -C 8 "animate-shimmer|prefers-reduced-motion" apps/standalone-sveltekit/src packages/chat-surface/src
pnpm why daisyui
```

This report intentionally makes no donor merge, dependency change, generated-token edit, runtime edit, test edit, or `.omx/ultragoal` mutation.
