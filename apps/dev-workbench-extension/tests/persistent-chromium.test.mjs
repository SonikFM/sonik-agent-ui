import assert from "node:assert/strict";
import http from "node:http";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const listen = (handler, port = 0) => new Promise((resolve) => {
  const server = http.createServer(handler);
  server.listen(port, "127.0.0.1", () => resolve(server));
});
const origin = (server) => `http://127.0.0.1:${server.address().port}`;
const sendHostRequest = (frame, request, hostOrigin, timeoutMs = 15_000) => frame.evaluate(({ request, hostOrigin, timeoutMs }) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${request.operation}.`)), timeoutMs);
  addEventListener("message", (event) => {
    if (event.origin !== hostOrigin || event.data?.requestId !== request.requestId) return;
    clearTimeout(timeout);
    resolve(event.data);
  }, { once: true });
  parent.postMessage(request, hostOrigin);
}), { request, hostOrigin, timeoutMs });
const expectRejected = async (frame, request, hostOrigin) => {
  try {
    const result = await sendHostRequest(frame, request, hostOrigin, 2_000);
    assert.equal(result.status, "failed");
  } catch (error) {
    assert.match(error.message, /Timed out waiting/);
  }
};

const extension = await mkdtemp(join(tmpdir(), "sonik-dev-workbench-extension-"));
const profile = await mkdtemp(join(tmpdir(), "sonik-dev-workbench-profile-"));
let host;
let workbench;
let context;

try {
  workbench = await listen((_request, response) => response.end("<!doctype html><title>Workbench fixture</title>"));
  host = await listen((_request, response) => {
    const hostOrigin = origin(host);
    const workbenchOrigin = origin(workbench);
    response.end(`<!doctype html>
      <style>body{margin:0}.secret{position:fixed;left:40px;top:40px;width:200px;height:40px}.workbench{position:fixed;left:300px;top:40px;width:250px;height:180px}</style>
      <input class="secret" type="password" value="never-capture">
      <div data-sonik-capture-chrome style="position:fixed;left:600px;top:40px;width:100px;height:40px;background:#00ff00"></div>
      <iframe class="workbench" data-sonik-dev-workbench-origin="${workbenchOrigin}" src="${workbenchOrigin}/?agentUiHostOrigin=${encodeURIComponent(hostOrigin)}"></iframe>`);
  });
  await cp(new URL("..", import.meta.url), extension, { recursive: true });
  await writeFile(join(extension, "dist/config.js"), `export const allowedWorkbenchOrigins = new Set([${JSON.stringify(origin(workbench))}]);\n`);

  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: false,
    viewport: null,
    args: ["--window-size=800,600", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  let page = context.pages()[0] ?? await context.newPage();
  await page.goto(`${origin(host)}/booking`);
  await page.locator("iframe").waitFor();
  await page.bringToFront();
  const browser = context.browser();
  assert.ok(browser, "Persistent Chromium exposes a browser CDP session");
  const cdp = await browser.newBrowserCDPSession();
  const { extensions } = await cdp.send("Extensions.getExtensions");
  const loadedExtension = extensions.find((candidate) => candidate.name === "Sonik Exact Active Tab");
  assert.ok(loadedExtension?.enabled, "Canonical unpacked extension is enabled");
  const serviceWorker = context.serviceWorkers().find((worker) => worker.url().startsWith(`chrome-extension://${loadedExtension.id}/`));
  assert.ok(serviceWorker, "Canonical extension service worker is running");
  assert.equal(await serviceWorker.evaluate(() => chrome.runtime.id), loadedExtension.id);
  const triggerAction = async () => {
    const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }] });
    const target = targetInfos.find((candidate) => candidate.type === "tab" && candidate.url === page.url());
    assert.ok(target, `Active tab target is available for ${page.url()}`);
    await cdp.send("Target.activateTarget", { targetId: target.targetId });
    await cdp.send("Extensions.triggerAction", { id: loadedExtension.id, targetId: target.targetId });
    await page.waitForTimeout(500);
  };
  const fixtureFrame = () => {
    const frame = page.frames().find((candidate) => candidate.url().startsWith(origin(workbench)));
    assert.ok(frame, "Workbench fixture frame loaded");
    return frame;
  };
  const requestFor = (operation, route = new URL(page.url()).pathname) => ({
    messageSource: "sonik-agent-ui", type: "sonik:visual-context:request", version: "sonik.visual-context.v1",
    requestId: crypto.randomUUID(), operation, origin: origin(workbench), sourceContextRevision: 1, routeRevision: 1,
    source: { id: "host", label: "Host", surface: "embedded-host", route }, provider: "chrome-active-tab",
  });
  const pair = async () => {
    await triggerAction();
    const paired = await sendHostRequest(fixtureFrame(), requestFor("pair-extension"), origin(host));
    assert.equal(paired.status, "completed");
  };

  await pair();
  let frame = fixtureFrame();
  const captureChrome = page.locator("[data-sonik-capture-chrome]");
  const captureChromeStyle = await captureChrome.getAttribute("style");
  const captureRequest = requestFor("capture");
  const result = await sendHostRequest(frame, captureRequest, origin(host));

  assert.equal(result.screenshot.fidelity, "exact-active-tab");
  assert.equal(result.screenshot.captureBasis, "native-active-tab-redacted");
  assert.deepEqual(result.screenshot.redactionsApplied, ["Sonik capture chrome", "Sensitive form controls", "Embedded frame pixels"]);
  assert.equal(result.screenshot.width, result.screenshot.viewport.width * result.screenshot.viewport.deviceScaleFactor);
  assert.equal(result.screenshot.height, result.screenshot.viewport.height * result.screenshot.viewport.deviceScaleFactor);

  const samples = await frame.evaluate(async ({ pngBase64, deviceScaleFactor }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${pngBase64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const sample = (x, y) => [...context.getImageData(x * deviceScaleFactor, y * deviceScaleFactor, 1, 1).data.slice(0, 3)];
    return { sensitive: sample(140, 60), embeddedFrame: sample(425, 130), captureChrome: sample(650, 60) };
  }, { pngBase64: result.screenshot.pngBase64, deviceScaleFactor: result.screenshot.viewport.deviceScaleFactor });
  assert.deepEqual(samples.sensitive, [17, 17, 17]);
  assert.deepEqual(samples.embeddedFrame, [17, 17, 17]);
  assert.deepEqual(samples.captureChrome, [255, 255, 255]);
  assert.equal(await captureChrome.getAttribute("style"), captureChromeStyle);
  await assert.doesNotReject(page.waitForFunction(() => ![...document.querySelectorAll("div")].some((element) => element.style.zIndex === "2147483647")));

  await expectRejected(frame, captureRequest, origin(host));
  await expectRejected(frame, { ...requestFor("capture"), origin: "https://foreign.invalid" }, origin(host));

  const otherPage = await context.newPage();
  await otherPage.goto(`${origin(host)}/background`);
  await otherPage.bringToFront();
  await expectRejected(frame, requestFor("capture"), origin(host));
  await otherPage.close();
  await page.bringToFront();
  await pair();

  assert.equal((await sendHostRequest(frame, requestFor("unpair-extension"), origin(host))).status, "completed");
  await expectRejected(frame, requestFor("capture"), origin(host));
  await pair();

  await page.goto(`${origin(host)}/booking-next`);
  await page.locator("iframe").waitFor();
  frame = fixtureFrame();
  await expectRejected(frame, requestFor("pair-extension"), origin(host));
  await pair();

  const currentWorker = context.serviceWorkers().find((worker) => worker.url().startsWith(`chrome-extension://${loadedExtension.id}/`));
  assert.ok(currentWorker);
  const workerTargets = await cdp.send("Target.getTargets", { filter: [{ type: "service_worker", exclude: false }] });
  const workerTarget = workerTargets.targetInfos.find((candidate) => candidate.url === currentWorker.url());
  assert.ok(workerTarget, "Extension service-worker target is available");
  assert.equal((await cdp.send("Target.closeTarget", { targetId: workerTarget.targetId })).success, true);
  await expectRejected(frame, requestFor("capture"), origin(host));
  await pair();
  assert.equal((await sendHostRequest(frame, requestFor("get-capabilities"), origin(host))).status, "completed");

  console.log("dev-workbench extension persistent Chromium security lifecycle: ok");
} finally {
  await context?.close().catch(() => undefined);
  await Promise.all([host, workbench].filter(Boolean).map((server) => new Promise((resolve) => server.close(resolve))));
  await Promise.all([rm(extension, { recursive: true, force: true }), rm(profile, { recursive: true, force: true })]);
}
