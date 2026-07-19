#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createSvelteMountWorkspace } from "../lib/svelte-mount-harness.mjs";

const NAME = "question-card-error-lifecycle";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const appLib = path.join(repoRoot, "apps/standalone-sveltekit/src/lib");

const checks = {};
function record(name, ok, detail = {}) {
  checks[name] = { ok, detail };
}

function relativeImport(fromDir, target) {
  let rel = path.relative(fromDir, target).split(path.sep).join("/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

function questionElement(id, title) {
  return {
    type: "QuestionCard",
    props: {
      questionId: id,
      title,
      body: "Provide an answer.",
      answerType: "short_text",
      value: { $bindState: `/answers/${id}` },
      errorMessage: { $bindState: `/questionErrors/${id}` },
      lifecycleState: { $bindState: `/questionStates/${id}` },
      required: { $bindState: `/config/${id}/required` },
      allowSkip: { $bindState: `/config/${id}/allowSkip` },
    },
  };
}

function fixtureSpec() {
  const ids = ["answer-change", "validation-change", "persisted-error", "network-overwrite", "id-change"];
  return {
    root: "root",
    elements: {
      root: { type: "Container", props: {}, children: ids },
      "answer-change": questionElement("answer-change", "Answer change"),
      "validation-change": questionElement("validation-change", "Validation change"),
      "persisted-error": questionElement("persisted-error", "Persisted error"),
      "network-overwrite": questionElement("network-overwrite", "Network overwrite"),
      "id-change": {
        ...questionElement("id-change", "Question ID change"),
        props: {
          ...questionElement("id-change", "Question ID change").props,
          questionId: { $bindState: "/config/id-change/questionId" },
        },
      },
    },
  };
}

function initialState() {
  return {
    answers: {
      "answer-change": "",
      "validation-change": "",
      "persisted-error": "",
      "network-overwrite": "",
      "id-change": "",
    },
    questionErrors: {
      "answer-change": null,
      "validation-change": null,
      "persisted-error": "Save failed. Retry this question.",
      "network-overwrite": null,
      "id-change": null,
    },
    questionStates: {
      "answer-change": "draft",
      "validation-change": "draft",
      "persisted-error": "error",
      "network-overwrite": "draft",
      "id-change": "draft",
    },
    config: Object.fromEntries([
      "answer-change",
      "validation-change",
      "persisted-error",
      "network-overwrite",
      "id-change",
    ].map((id) => [id, {
      required: true,
      allowSkip: false,
      ...(id === "id-change" ? { questionId: "id-change" } : {}),
    }])),
  };
}

function buildHarness(workspace) {
  const stateProvider = relativeImport(workspace.tmpDir, path.join(workspace.svelteDistDir, "contexts/StateProvider.svelte"));
  const visibilityProvider = relativeImport(workspace.tmpDir, path.join(workspace.svelteDistDir, "contexts/VisibilityProvider.svelte"));
  const validationProvider = relativeImport(workspace.tmpDir, path.join(workspace.svelteDistDir, "contexts/ValidationProvider.svelte"));
  const actionProvider = relativeImport(workspace.tmpDir, path.join(workspace.svelteDistDir, "contexts/ActionProvider.svelte"));
  const renderer = relativeImport(workspace.tmpDir, path.join(workspace.svelteDistDir, "Renderer.svelte"));
  return `<script>
  import StateProvider from "${stateProvider}";
  import VisibilityProvider from "${visibilityProvider}";
  import ValidationProvider from "${validationProvider}";
  import ActionProvider from "${actionProvider}";
  import Renderer from "${renderer}";
  let { store, spec, registry, onStateChange } = $props();
</script>

<StateProvider {store} {onStateChange}>
  <VisibilityProvider>
    <ValidationProvider>
      <ActionProvider handlers={{}}>
        <Renderer {spec} {registry} />
      </ActionProvider>
    </ValidationProvider>
  </VisibilityProvider>
</StateProvider>
`;
}

function buildMain(workspace) {
  const rendererModule = relativeImport(workspace.tmpDir, path.join(workspace.svelteDistDir, "renderer.js"));
  const container = relativeImport(workspace.tmpDir, path.join(workspace.svelteDistDir, "TestContainer.svelte"));
  const questionCard = relativeImport(workspace.tmpDir, path.join(appLib, "render/components/QuestionCard.svelte"));
  return `import { mount } from "svelte";
import { createStateStore } from "@json-render/core";
import { defineRegistry } from "${rendererModule}";
import Container from "${container}";
import QuestionCard from "${questionCard}";
import Harness from "./Harness.svelte";

const spec = ${JSON.stringify(fixtureSpec())};
const store = createStateStore(${JSON.stringify(initialState())});
const changes = [];
const { registry } = defineRegistry(null, { components: { Container, QuestionCard } });

mount(Harness, {
  target: document.getElementById("app"),
  props: {
    store,
    spec,
    registry,
    onStateChange: (next) => changes.push(...next),
  },
});

window.__questionCardEval = {
  get: (path) => store.get(path),
  set: (path, value) => store.set(path, value),
  update: (updates) => store.update(updates),
  snapshot: () => store.getSnapshot(),
  changes,
};
`;
}

async function run() {
  const workspace = await createSvelteMountWorkspace({ repoRoot, resolveAlias: { $lib: appLib } });
  let devServer;
  let browser;
  try {
    await workspace.writeFile("Harness.svelte", buildHarness(workspace));
    await workspace.writeFile("main.js", buildMain(workspace));
    await workspace.writeFile("index.html", '<!doctype html><html><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
    devServer = await workspace.start();
    record("viteServerStarted", true, { url: devServer.url });

    browser = await chromium.launch({ headless: process.env.HEADLESS !== "false", args: ["--disable-gpu", "--no-sandbox"] });
    const page = await browser.newPage();
    const pageErrors = [];
    await page.route("**/api/telemetry", (route) => route.fulfill({ status: 204, body: "" }));
    page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));
    page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });
    await page.goto(devServer.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.__questionCardEval), undefined, { timeout: 15_000 });
    await page.waitForSelector('[data-question-card-id="answer-change"]');

    const initialChanges = await page.evaluate(() => window.__questionCardEval.changes.slice());
    const persistedCard = page.locator('[data-question-card-id="persisted-error"]').first();
    record("initialPersistedErrorEmitsNoNull", initialChanges.length === 0, initialChanges);
    record("initialPersistedErrorVisible", await persistedCard.locator("p.text-destructive").innerText() === "Save failed. Retry this question.");
    record("initialPersistedLifecycleFailed", await persistedCard.getAttribute("data-question-state") === "failed");

    const answerCard = page.locator('[data-question-card-id="answer-change"]').first();
    await answerCard.locator('[data-question-action="submit"]').click();
    const answerValidationMessage = await answerCard.locator("p.text-destructive").innerText();
    record("blankRequiredSubmitWritesValidationError", (await page.evaluate(() => window.__questionCardEval.get("/questionErrors/answer-change"))) === answerValidationMessage, { answerValidationMessage });
    await page.evaluate(() => window.__questionCardEval.set("/answers/answer-change", "external answer"));
    await page.waitForFunction(() => window.__questionCardEval.get("/questionErrors/answer-change") === null);
    record("externalAnswerClearsLocalValidationUi", await answerCard.locator("p.text-destructive").count() === 0);
    record("externalAnswerClearsFailedStatus", await answerCard.getAttribute("data-question-state") !== "failed");

    const validationCard = page.locator('[data-question-card-id="validation-change"]').first();
    await validationCard.locator('[data-question-action="submit"]').click();
    await validationCard.locator("p.text-destructive").waitFor();
    await page.evaluate(() => window.__questionCardEval.update({
      "/config/validation-change/required": false,
      "/config/validation-change/allowSkip": true,
    }));
    await page.waitForFunction(() => window.__questionCardEval.get("/questionErrors/validation-change") === null);
    record("externalValidationTransitionClearsUi", await validationCard.locator("p.text-destructive").count() === 0);
    record("externalValidationTransitionClearsFailedStatus", await validationCard.getAttribute("data-question-state") !== "failed");

    await page.evaluate(() => window.__questionCardEval.set("/answers/persisted-error", "later external answer"));
    await page.waitForTimeout(50);
    record("persistedErrorSurvivesExternalAnswer", (await page.evaluate(() => window.__questionCardEval.get("/questionErrors/persisted-error"))) === "Save failed. Retry this question.");
    record("persistedErrorRemainsVisible", await persistedCard.locator("p.text-destructive").innerText() === "Save failed. Retry this question.");

    const overwriteCard = page.locator('[data-question-card-id="network-overwrite"]').first();
    await overwriteCard.locator('[data-question-action="submit"]').click();
    await overwriteCard.locator("p.text-destructive").waitFor();
    await page.evaluate(() => window.__questionCardEval.set("/questionErrors/network-overwrite", "Network save failed."));
    await page.evaluate(() => window.__questionCardEval.set("/answers/network-overwrite", "external answer"));
    await page.waitForFunction(() => document.querySelector('[data-question-card-id="network-overwrite"] p.text-destructive')?.textContent === "Network save failed.");
    record("networkOverwriteSurvivesSignatureChange", (await page.evaluate(() => window.__questionCardEval.get("/questionErrors/network-overwrite"))) === "Network save failed.");
    record("networkOverwriteRemainsVisible", await overwriteCard.locator("p.text-destructive").innerText() === "Network save failed.");

    const idChangeCard = page.locator("[data-question-card]").filter({ hasText: "Question ID change" });
    await idChangeCard.locator('[data-question-action="submit"]').click();
    await idChangeCard.locator("p.text-destructive").waitFor();
    await page.evaluate(() => window.__questionCardEval.set("/config/id-change/questionId", "renamed-question"));
    await page.waitForFunction(() => window.__questionCardEval.get("/questionErrors/id-change") === null);
    record("questionIdChangeClearsOriginalProvenancePath", await idChangeCard.locator("p.text-destructive").count() === 0);
    record("questionIdChangeDoesNotWriteNewErrorPath", (await page.evaluate(() => window.__questionCardEval.get("/questionErrors/renamed-question"))) === undefined);

    const persistedNullWrites = await page.evaluate(() => window.__questionCardEval.changes.filter((change) => change.path === "/questionErrors/persisted-error" && change.value === null));
    record("persistedErrorNeverClearedByComponent", persistedNullWrites.length === 0, persistedNullWrites);
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
  const failing = Object.entries(checks).filter(([, check]) => check.ok !== true);
  const status = failing.length === 0 ? "PASS" : "FAIL";
  console.log(JSON.stringify({
    name: NAME,
    status,
    durationMs: Date.now() - startedAt,
    checks,
    failingChecks: failing.map(([name]) => name),
    approach: "browser-mounted: real QuestionCard through the real Renderer/StateProvider stack",
  }));
  process.exit(status === "FAIL" ? 1 : 0);
} catch (error) {
  console.log(JSON.stringify({ name: NAME, status: "FAIL", durationMs: Date.now() - startedAt, checks, error: error?.stack || error?.message || String(error) }));
  process.exit(1);
}
