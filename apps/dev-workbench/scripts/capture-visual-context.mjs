import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";
import {
  maxVisualContextAriaLength,
  maxVisualContextImageBytes,
  visualContextRequestSchema,
  visualContextResultSchema,
} from "@sonik-agent-ui/tool-contracts/visual-context";

const secretPattern = /(?:\bbearer\s+[a-zA-Z0-9._-]{12,}|\b(?:api[_ -]?key|access[_ -]?token|client[_ -]?secret|password)\b\s*[:=]\s*\S+|\beyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,}|\b(?:sk|vck)[_-][a-zA-Z0-9_-]{12,})/gi;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phonePattern = /(?<!\d)(?:\+?\d[\d ().-]{7,}\d)(?!\d)/g;
const sensitiveSelector = "input,textarea,select,[contenteditable],[data-sonik-sensitive]";
export const PLAYWRIGHT_PREVIEW_READINESS_RULE = "domcontentloaded+bounded-networkidle+document-fonts-ready";

export function appliedRedactions(input) {
  return [
    ...(input.sensitiveCount ? ["sensitive form fields"] : []),
    ...(input.declaredSensitiveCount ? ["declared sensitive content"] : []),
    ...(input.crossOriginFrameCount ? ["cross-origin frames"] : []),
    ...((input.sensitiveCount || input.declaredSensitiveCount) ? ["AI accessibility sensitive content"] : []),
    ...(input.ariaSnapshot !== input.rawAriaSnapshot ? ["AI accessibility text"] : []),
  ];
}

function sanitizeAria(value) {
  return value.split("\n").map((line) => line
    .replace(secretPattern, "[redacted credential]")
    .replace(emailPattern, "[redacted email]")
    .replace(phonePattern, "[redacted phone]"))
    .join("\n")
    .slice(0, maxVisualContextAriaLength);
}

async function readRequest() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return visualContextRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

function resultFor(request, input) {
  const { targetId: _targetId, targetInstanceId: _targetInstanceId, viewport: _viewport, ...correlation } = request;
  return visualContextResultSchema.parse({
    ...correlation,
    messageSource: "sonik-agent-host",
    type: "sonik:visual-context:result",
    ...input,
  });
}

function previewOrigin() {
  const url = new URL(process.env.SONIK_VISUAL_CONTEXT_PREVIEW_URL ?? "");
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("The controlled Preview origin is invalid.");
  }
  return url.origin;
}

async function exactTarget(page, targetId, targetInstanceId) {
  const candidates = page.locator("[data-sonik-target]");
  const indexes = [];
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if (await candidate.getAttribute("data-sonik-target") === targetId
      && (!targetInstanceId || await candidate.getAttribute("data-sonik-target-instance") === targetInstanceId)) indexes.push(index);
  }
  if (indexes.length !== 1) throw new Error("Stable visual target must resolve to exactly one instance.");
  return candidates.nth(indexes[0]);
}

export async function captureVisualContext(request, options = {}) {
  if (request.operation !== "capture" || request.provider !== "playwright") throw new Error("Invalid Playwright capture request.");
  if (request.targetInstanceId && !request.targetId) throw new Error("Target instances require a target id.");
  const outputPath = options.outputPath ?? `/vercel/sandbox/workspace/.sonik/screenshots/requests/${request.requestId}.png`;
  const browser = await (options.chromium ?? chromium).launch({ headless: true });
  let completed = false;
  try {
    const context = await browser.newContext({
      viewport: { width: request.viewport?.width ?? 1440, height: request.viewport?.height ?? 900 },
      deviceScaleFactor: request.viewport?.deviceScaleFactor ?? 1,
    });
    const page = await context.newPage();
    await page.goto(new URL(request.source.route, options.previewOrigin ?? previewOrigin()).href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined),
      page.evaluate(() => Promise.race([
        document.fonts?.ready ?? Promise.resolve(),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ])),
    ]);
    await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}" });
    await page.locator("iframe").evaluateAll((frames) => {
      for (const frame of frames) {
        try {
          if (new URL(frame.getAttribute("src") || location.href, location.href).origin !== location.origin) frame.setAttribute("data-sonik-capture-cross-origin", "");
        } catch {
          frame.setAttribute("data-sonik-capture-cross-origin", "");
        }
      }
    });

    const stableTarget = request.targetId && !request.targetId.startsWith("ephemeral:");
    const capture = stableTarget ? await exactTarget(page, request.targetId, request.targetInstanceId) : page;
    const ariaRoot = stableTarget ? capture : page.locator("body");
    const sensitive = page.locator("input,textarea,select,[contenteditable]");
    const declaredSensitive = page.locator("[data-sonik-sensitive]");
    const crossOriginFrames = page.locator("[data-sonik-capture-cross-origin]");
    const visibleCount = (locator) => locator.evaluateAll((elements) => elements.filter((element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return bounds.width > 0 && bounds.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    }).length);
    const [sensitiveCount, declaredSensitiveCount, crossOriginFrameCount] = await Promise.all([
      visibleCount(sensitive), visibleCount(declaredSensitive), visibleCount(crossOriginFrames),
    ]);
    const mask = page.locator(`${sensitiveSelector},[data-sonik-capture-cross-origin]`);
    const screenshotOptions = { path: outputPath, type: "png", animations: "disabled", caret: "hide", scale: "css", mask: [mask] };
    if (stableTarget) await capture.screenshot(screenshotOptions);
    else await page.screenshot(screenshotOptions);

    await page.locator(sensitiveSelector).evaluateAll((elements) => {
      for (const element of elements) {
        for (const attribute of ["aria-label", "alt", "title", "value"]) if (element.hasAttribute(attribute)) element.setAttribute(attribute, "[redacted]");
        if (element.hasAttribute("contenteditable") || element.hasAttribute("data-sonik-sensitive")) element.textContent = "[redacted]";
      }
    });
    const bytes = await readFile(outputPath);
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (bytes.length < 24 || bytes.length > maxVisualContextImageBytes || !bytes.subarray(0, 8).equals(pngSignature) || bytes.toString("ascii", 12, 16) !== "IHDR") {
      throw new Error("Playwright produced an invalid PNG.");
    }
    const rawAriaSnapshot = await ariaRoot.ariaSnapshot({ timeout: 5_000 });
    const ariaSnapshot = sanitizeAria(rawAriaSnapshot);
    const redactionsApplied = appliedRedactions({ sensitiveCount, declaredSensitiveCount, crossOriginFrameCount, ariaSnapshot, rawAriaSnapshot });
    completed = true;
    return resultFor(request, {
      status: "completed",
      selectionResolution: stableTarget ? "stable-target" : request.targetId ? "unavailable-in-playwright" : "not-requested",
      ariaSnapshot,
      screenshot: {
        mime: "image/png",
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        provider: "playwright",
        fidelity: "controlled-preview",
        captureBasis: "fresh-playwright-navigation",
        viewport: { ...page.viewportSize(), deviceScaleFactor: request.viewport?.deviceScaleFactor ?? 1 },
        redactionsApplied,
        capturedAt: new Date().toISOString(),
        temporaryPath: outputPath,
      },
    });
  } finally {
    await browser.close().catch(() => undefined);
    if (!completed) await rm(outputPath, { force: true }).catch(() => undefined);
  }
}

export async function probeBrowserCapabilities(options = {}) {
  const browserApi = options.chromium ?? chromium;
  const accessFile = options.access ?? access;
  const setupCapability = { operation: "setup-browser", status: "available", provider: "playwright" };
  try {
    await accessFile(browserApi.executablePath());
  } catch {
    return [
      { operation: "capture", status: "unavailable", provider: "playwright", disabledReason: "Chromium is not installed in this workspace." },
      setupCapability,
    ];
  }
  let browser;
  try {
    browser = await browserApi.launch({ headless: true });
    return [{ operation: "capture", status: "available", provider: "playwright" }, setupCapability];
  } catch {
    return [
      { operation: "capture", status: "failed", provider: "playwright", disabledReason: "Chromium is installed but could not launch." },
      setupCapability,
    ];
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function installChromium() {
  return new Promise((resolveExit) => {
    const child = spawn("pnpm", ["exec", "playwright", "install", "chromium"], { stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", () => resolveExit(1));
    child.on("close", (code) => resolveExit(code ?? 1));
  });
}

async function browserCapabilities(request) {
  return resultFor(request, { status: "completed", capabilities: await probeBrowserCapabilities() });
}

export async function setupBrowser(request, options = {}) {
  const exitCode = await (options.install ?? installChromium)();
  const capabilities = await (options.probe ?? probeBrowserCapabilities)();
  if (exitCode !== 0) return resultFor(request, { status: "failed", disabledReason: "Chromium setup failed in this workspace.", capabilities });
  const capture = capabilities.find((capability) => capability.operation === "capture");
  return resultFor(request, capture?.status === "available"
    ? { status: "completed", capabilities }
    : { status: "failed", disabledReason: capture?.disabledReason ?? "Chromium setup could not be verified.", capabilities });
}

async function main() {
  let request;
  try {
    request = await readRequest();
    const result = request.operation === "get-capabilities"
      ? await browserCapabilities(request)
      : request.operation === "setup-browser"
        ? await setupBrowser(request)
        : await captureVisualContext(request);
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    if (request) {
      const disabledReason = request.operation === "setup-browser"
        ? "Chromium setup failed in this workspace."
        : request.operation === "get-capabilities"
          ? "Browser capabilities could not be checked."
          : "Controlled Preview capture failed.";
      process.stdout.write(JSON.stringify(resultFor(request, { status: "failed", disabledReason })));
      return;
    }
    console.error(error instanceof Error ? error.message : "Invalid visual context request.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
