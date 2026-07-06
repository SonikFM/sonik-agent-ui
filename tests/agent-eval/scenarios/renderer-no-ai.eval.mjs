#!/usr/bin/env node
// Browser-mounted conformance check for packages/svelte's actual renderer, in
// the spirit of json-render/examples/no-ai (a static spec fixture with no AI
// generation — just $bindState/$cond/$template resolved against
// hand-authored state, driven purely by user interaction).
//
// This mounts the REAL `RendererWithProvider.test.svelte` (the same
// StateProvider → VisibilityProvider → ValidationProvider → ActionProvider →
// Renderer stack packages/svelte/src/renderer.test.ts uses) via Playwright
// against a real, running Svelte 5 app, served by a Vite dev server started
// programmatically for this one page (lib/svelte-mount-harness.mjs). No
// custom reimplementation of prop/visibility resolution — the rendered DOM is
// whatever the shipped renderer actually produces.
//
// Fixture proves, by driving real DOM input events and reading real DOM
// output (no shortcuts through internal state):
//   - $bindState: typing into an input round-trips through the real state
//     store and back into a $template-bound preview.
//   - $cond as a `visible` gate: a section only renders once a bound field
//     matches a condition.
//   - $cond/$then/$else in a prop value: two elements bound to different
//     fixed initial state paths render their `then` vs. `else` branch.
//
// Run directly: node --experimental-strip-types scenarios/renderer-no-ai.eval.mjs
// (normally invoked by scripts/agent-eval-gate.mjs)

import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createSvelteMountWorkspace } from "../lib/svelte-mount-harness.mjs";

const NAME = "renderer-no-ai";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const checks = {};
function record(name, ok, detail) {
  checks[name] = { ok, detail };
}

// Relative-to-`svelteDistDir` posix paths the generated main.js will import.
// All are plain filesystem paths (not bare "@json-render/svelte" specifiers),
// so they aren't subject to that package's public `exports` map — see
// lib/svelte-mount-harness.mjs header for why.
function distImport(svelteDistDir, tmpMainJsDir, ...segments) {
  const abs = path.join(svelteDistDir, ...segments);
  let rel = path.relative(tmpMainJsDir, abs).split(path.sep).join("/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

const INPUT_COMPONENT = `<script>
  import { getBoundProp } from "%STATE_PROVIDER%";
  let { props, bindings } = $props();
  let bound = getBoundProp(() => props.value, () => bindings?.value);
</script>

<input data-testid={props.testId} value={bound.current ?? ""} oninput={(e) => (bound.current = e.currentTarget.value)} />
`;

// packages/svelte/dist/TestText.svelte doesn't forward a `data-testid`
// attribute (it only renders `props.text`), so it can't be located by
// Playwright. Reimplementing that one attribute here — rather than editing
// the existing component — keeps this scenario read-only against the
// package under test.
const TEXT_COMPONENT = `<script>
  let { props } = $props();
</script>

<span data-testid={props.testId} class="test-text">{props.text ?? ""}</span>
`;

function buildFixtureSpec() {
  return {
    root: "root",
    state: {
      form: { name: "", email: "", accountType: "personal" },
      resultPending: { valid: false },
      resultValid: { valid: true },
    },
    elements: {
      root: { type: "Container", props: {}, children: ["nameInput", "emailInput", "preview", "accountInput", "companyGate", "statusPending", "statusValid"] },
      nameInput: { type: "Input", props: { testId: "name-input", value: { $bindState: "/form/name" } } },
      emailInput: { type: "Input", props: { testId: "email-input", value: { $bindState: "/form/email" } } },
      preview: {
        type: "Text",
        props: { testId: "preview", text: { $template: "Welcome, ${/form/name}! Your email: ${/form/email}" } },
        visible: { $state: "/form/name", neq: "" },
      },
      accountInput: { type: "Input", props: { testId: "account-input", value: { $bindState: "/form/accountType" } } },
      companyGate: {
        type: "Text",
        props: { testId: "company-gate", text: "Business fields visible" },
        visible: { $state: "/form/accountType", eq: "business" },
      },
      statusPending: {
        type: "Text",
        props: {
          testId: "status-pending",
          text: { $cond: { $state: "/resultPending/valid", eq: true }, $then: "valid", $else: "invalid" },
        },
      },
      statusValid: {
        type: "Text",
        props: {
          testId: "status-valid",
          text: { $cond: { $state: "/resultValid/valid", eq: true }, $then: "valid", $else: "invalid" },
        },
      },
    },
  };
}

function buildMainJs(svelteDistDir, tmpDir) {
  const rendererWithProviderRel = distImport(svelteDistDir, tmpDir, "RendererWithProvider.test.svelte");
  const rendererJsRel = distImport(svelteDistDir, tmpDir, "renderer.js");
  const testContainerRel = distImport(svelteDistDir, tmpDir, "TestContainer.svelte");
  const spec = buildFixtureSpec();

  return `import { mount } from "svelte";
import RendererWithProvider from "${rendererWithProviderRel}";
import { defineRegistry } from "${rendererJsRel}";
import TestContainer from "${testContainerRel}";
import Text from "./Text.svelte";
import Input from "./Input.svelte";

const spec = ${JSON.stringify(spec)};

const { registry } = defineRegistry(null, {
  components: { Container: TestContainer, Text, Input },
});

mount(RendererWithProvider, {
  target: document.getElementById("app"),
  props: { spec, registry, initialState: spec.state },
});

window.__rendererEvalMounted = true;
`;
}

async function run() {
  const workspace = await createSvelteMountWorkspace({ repoRoot });
  let devServer;
  let browser;
  try {
    const inputComponent = INPUT_COMPONENT.replace(
      "%STATE_PROVIDER%",
      distImport(workspace.svelteDistDir, workspace.tmpDir, "contexts/StateProvider.svelte"),
    );
    await workspace.writeFile("Input.svelte", inputComponent);
    await workspace.writeFile("Text.svelte", TEXT_COMPONENT);
    await workspace.writeFile("main.js", buildMainJs(workspace.svelteDistDir, workspace.tmpDir));
    await workspace.writeFile(
      "index.html",
      `<!doctype html>\n<html><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>\n`,
    );

    devServer = await workspace.start();
    record("viteServerStarted", true, { url: devServer.url });

    browser = await chromium.launch({ headless: process.env.HEADLESS !== "false", args: ["--disable-gpu", "--no-sandbox"] });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));
    page.on("console", (msg) => { if (msg.type() === "error") pageErrors.push(msg.text()); });

    await page.goto(devServer.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => window.__rendererEvalMounted === true, undefined, { timeout: 15_000 });
    record("mounted", true, {});

    // --- $bindState + $template: empty state renders inputs, preview hidden ---
    await page.waitForSelector('[data-testid="name-input"]', { timeout: 10_000 });
    record("previewHiddenWhenNameEmpty", (await page.locator('[data-testid="preview"]').count()) === 0, {});
    record("companyGateHiddenForPersonal", (await page.locator('[data-testid="company-gate"]').count()) === 0, {});

    // --- $cond/$then/$else: two independently-seeded state paths pick correct branch ---
    record("condElseForPendingResult", (await page.locator('[data-testid="status-pending"]').innerText()) === "invalid", {});
    record("condThenForValidResult", (await page.locator('[data-testid="status-valid"]').innerText()) === "valid", {});

    // --- Drive real input events: $bindState round-trips through the real state store ---
    await page.locator('[data-testid="name-input"]').fill("Ada Lovelace");
    await page.waitForSelector('[data-testid="preview"]', { timeout: 5_000 });
    record("previewVisibleAfterNameFilled", true, {});
    record(
      "templateInterpolatesNameBeforeEmail",
      (await page.locator('[data-testid="preview"]').innerText()) === "Welcome, Ada Lovelace! Your email: ",
      {},
    );

    await page.locator('[data-testid="email-input"]').fill("ada@example.com");
    await page.waitForFunction(
      () => document.querySelector('[data-testid="preview"]')?.textContent === "Welcome, Ada Lovelace! Your email: ada@example.com",
      undefined,
      { timeout: 5_000 },
    );
    record("templateInterpolatesBothPaths", true, {});

    // --- $cond as a `visible` gate reacts to a bound field changing ---
    await page.locator('[data-testid="account-input"]').fill("business");
    await page.waitForSelector('[data-testid="company-gate"]', { timeout: 5_000 });
    record("companyGateVisibleAfterAccountTypeBusiness", true, {});

    record("noPageErrors", pageErrors.length === 0, pageErrors);
  } finally {
    await browser?.close().catch(() => undefined);
    await devServer?.close().catch(() => undefined);
    await workspace.cleanup().catch(() => undefined);
  }
}

const startedAt = Date.now();
try {
  await run();
  const failing = Object.entries(checks).filter(([, v]) => v.ok !== true);
  const status = failing.length === 0 ? "PASS" : "FAIL";
  const result = {
    name: NAME,
    status,
    durationMs: Date.now() - startedAt,
    checks,
    failingChecks: failing.map(([k]) => k),
    approach: "browser-mounted: real packages/svelte RendererWithProvider.test.svelte served by a programmatic Vite dev server, driven by Playwright",
  };
  console.log(JSON.stringify(result));
  process.exit(status === "FAIL" ? 1 : 0);
} catch (error) {
  const result = {
    name: NAME,
    status: "FAIL",
    durationMs: Date.now() - startedAt,
    checks,
    error: error?.stack || error?.message || String(error),
  };
  console.log(JSON.stringify(result));
  process.exit(1);
}
