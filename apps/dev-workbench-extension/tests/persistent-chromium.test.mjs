import assert from "node:assert/strict";
import http from "node:http";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const listen = (handler, port = 0) => new Promise((resolve) => {
  const server = http.createServer(handler);
  server.listen(port, "127.0.0.1", () => resolve(server));
});
const origin = (server) => `http://127.0.0.1:${server.address().port}`;
const sendHostRequest = (frame, request, hostOrigin) => frame.evaluate(({ request, hostOrigin }) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${request.operation}.`)), 15_000);
  addEventListener("message", (event) => {
    if (event.origin !== hostOrigin || event.data?.requestId !== request.requestId) return;
    clearTimeout(timeout);
    resolve(event.data);
  }, { once: true });
  parent.postMessage(request, hostOrigin);
}), { request, hostOrigin });

const extension = await mkdtemp(join(tmpdir(), "sonik-dev-workbench-extension-"));
const profile = await mkdtemp(join(tmpdir(), "sonik-dev-workbench-profile-"));
let host;
let workbench;
let context;

try {
  await cp(new URL("..", import.meta.url), extension, { recursive: true });

  workbench = await listen((_request, response) => response.end("<!doctype html><title>Workbench fixture</title>"), 5173);
  host = await listen((_request, response) => {
    const hostOrigin = origin(host);
    const workbenchOrigin = origin(workbench);
    response.end(`<!doctype html>
      <style>body{margin:0}.secret{position:fixed;left:40px;top:40px;width:200px;height:40px}.workbench{position:fixed;left:300px;top:40px;width:250px;height:180px}</style>
      <input class="secret" type="password" value="never-capture">
      <iframe class="workbench" data-sonik-dev-workbench-origin="${workbenchOrigin}" src="${workbenchOrigin}/?agentUiHostOrigin=${encodeURIComponent(hostOrigin)}"></iframe>`);
  });

  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: false,
    viewport: { width: 800, height: 600 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
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
  const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }] });
  const bookingTarget = targetInfos.find((candidate) => candidate.type === "tab" && candidate.url === `${origin(host)}/booking`);
  assert.ok(bookingTarget, "Booking active-tab target is available");
  await cdp.send("Extensions.triggerAction", { id: loadedExtension.id, targetId: bookingTarget.targetId });
  await page.waitForTimeout(500);
  page = context.pages().find((candidate) => candidate.url() === `${origin(host)}/booking`) ?? page;

  const frame = page.frames().find((candidate) => candidate.url().startsWith(origin(workbench)));
  assert.ok(frame, "Workbench fixture frame loaded");
  const request = {
    messageSource: "sonik-agent-ui", type: "sonik:visual-context:request", version: "sonik.visual-context.v1",
    requestId: crypto.randomUUID(), operation: "pair-extension", origin: origin(workbench), sourceContextRevision: 1, routeRevision: 1,
    source: { id: "host", label: "Host", surface: "embedded-host", route: "/booking" }, provider: "chrome-active-tab",
  };
  const paired = await sendHostRequest(frame, request, origin(host));
  assert.equal(paired.status, "completed");
  const result = await sendHostRequest(frame, { ...request, requestId: crypto.randomUUID(), operation: "capture" }, origin(host));

  assert.equal(result.screenshot.fidelity, "exact-active-tab");
  assert.equal(result.screenshot.captureBasis, "native-active-tab-redacted");
  assert.deepEqual(result.screenshot.redactionsApplied, ["Sensitive form controls", "Embedded frame pixels"]);
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
    return { sensitive: sample(140, 60), embeddedFrame: sample(425, 130) };
  }, { pngBase64: result.screenshot.pngBase64, deviceScaleFactor: result.screenshot.viewport.deviceScaleFactor });
  assert.deepEqual(samples.sensitive, [17, 17, 17]);
  assert.deepEqual(samples.embeddedFrame, [17, 17, 17]);
  await assert.doesNotReject(page.waitForFunction(() => ![...document.querySelectorAll("div")].some((element) => element.style.zIndex === "2147483647")));

  console.log("dev-workbench extension persistent Chromium active-tab capture: ok");
} finally {
  await context?.close().catch(() => undefined);
  await Promise.all([host, workbench].filter(Boolean).map((server) => new Promise((resolve) => server.close(resolve))));
  await Promise.all([rm(extension, { recursive: true, force: true }), rm(profile, { recursive: true, force: true })]);
}
