import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { embeddedHostUrl } from "./support/dev-smoke";

const SESSION_ID = "g018-upload-session";
const now = "2026-07-14T16:00:00.000Z";
const session = {
  id: SESSION_ID,
  name: "File recovery proof",
  mode: "chat",
  archived: false,
  is_important: false,
  folder: null,
  message_count: 0,
  active_document_id: null,
  active_artifact_id: null,
  created_at: now,
  updated_at: now,
  last_accessed: now,
  last_message_at: null,
};

type UploadObservation = {
  authority: string;
  requestId: string;
  traceId: string;
  body: string;
};

async function fulfillJson(route: Route, body: unknown, status = 200, headers: Record<string, string> = {}): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
}

async function installHost(page: Page, observations: UploadObservation[], generateObservations: UploadObservation[]): Promise<void> {
  await page.addInitScript(() => {
    let donationRevision = 0;
    window.addEventListener("message", (event) => {
      const data = event.data as { source?: string; type?: string } | null;
      if (event.source !== window.parent || data?.source !== "sonik-agent-ui" || data.type !== "sonik:agent-ui:request-page-context") return;
      donationRevision += 1;
      window.postMessage({
        source: "sonik-agent-ui-host",
        type: "sonik:agent-ui:page-context",
        authority: {
          header: `g018_opaque_authority_${donationRevision}`,
          revision: donationRevision,
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
        payload: { route: "/operations", surface: "operations-home", title: "Operations Home" },
      }, window.location.origin);
    });
  });

  await page.route("**/api/agent-models", (route) => fulfillJson(route, { models: [], source: "fallback" }));
  await page.route("**/api/agent-definitions", (route) => fulfillJson(route, { ok: true }));
  await page.route("**/api/documents/library**", (route) => fulfillJson(route, { documents: [] }));
  await page.route("**/api/session**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/sessions") return fulfillJson(route, url.searchParams.get("archived") === "true" ? [] : [session]);
    if (url.pathname === "/api/session" && route.request().method() === "POST") return fulfillJson(route, session);
    return fulfillJson(route, {
      session,
      activeDocument: null,
      messages: [],
      runs: [],
      telemetry: [],
      reattach: null,
      activeArtifact: null,
      activeArtifactState: null,
      activeArtifactVersions: [],
    });
  });
  let recoverableUploadAttempts = 0;
  await page.route("**/api/files", async (route) => {
    const headers = route.request().headers();
    const body = route.request().postDataBuffer()?.toString("utf8") ?? "";
    const observation = {
      authority: headers["x-sonik-agent-ui-host-context"] ?? "",
      requestId: headers["x-sonik-request-id"] ?? "",
      traceId: headers["x-sonik-trace-id"] ?? "",
      body,
    };
    observations.push(observation);
    const correlationHeaders = {
      "x-sonik-request-id": observation.requestId,
      "x-sonik-trace-id": observation.traceId,
    };
    if (body.includes("permanent-error.txt")) {
      return fulfillJson(route, {
        ok: false,
        error: '{"private":"raw provider error"}',
        code: "file_upload_failed",
        phase: "post_write",
        safeToRetry: false,
        requestId: observation.requestId,
        traceId: observation.traceId,
      }, 500, correlationHeaders);
    }
    recoverableUploadAttempts += 1;
    if (recoverableUploadAttempts === 1) {
      return fulfillJson(route, {
        ok: false,
        error: "Authenticated host session required",
        code: "host_auth_required",
        phase: "pre_write",
        safeToRetry: true,
        requestId: observation.requestId,
        traceId: observation.traceId,
      }, 401, correlationHeaders);
    }
    return fulfillJson(route, {
      id: "uploaded-g018",
      session_id: SESSION_ID,
      original_filename: "authority-retry.txt",
      media_type: "text/plain",
      byte_size: 27,
      status: "ready",
    }, 201, correlationHeaders);
  });
  let generateAttempts = 0;
  await page.route("**/api/generate", async (route) => {
    const headers = route.request().headers();
    const observation = {
      authority: headers["x-sonik-agent-ui-host-context"] ?? "",
      requestId: headers["x-sonik-request-id"] ?? "",
      traceId: headers["x-sonik-trace-id"] ?? "",
      body: route.request().postData() ?? "",
    };
    generateObservations.push(observation);
    generateAttempts += 1;
    const correlationHeaders = {
      "x-sonik-request-id": observation.requestId,
      "x-sonik-trace-id": observation.traceId,
    };
    if (generateAttempts === 1) {
      return fulfillJson(route, {
        ok: false,
        error: "Authenticated host session required",
        code: "host_auth_required",
        phase: "pre_stream",
        safeToRetry: true,
        requestId: observation.requestId,
        traceId: observation.traceId,
      }, 401, correlationHeaders);
    }
    if (generateAttempts > 2) {
      return fulfillJson(route, {
        ok: false,
        error: '{"private":"raw generation provider error"}',
        code: "generation_failed",
        phase: "post_write",
        safeToRetry: false,
        requestId: observation.requestId,
        traceId: observation.traceId,
      }, 500, correlationHeaders);
    }
    const chunks = [
      { type: "start", messageId: `g018-generate-${widthSafe(observation.body)}` },
      { type: "text-start", id: "g018-text" },
      { type: "text-delta", id: "g018-text", delta: "Recovered generation." },
      { type: "text-end", id: "g018-text" },
      { type: "finish", finishReason: "stop" },
    ];
    await route.fulfill({
      status: 200,
      headers: { ...correlationHeaders, "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
      body: `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join("\n\n")}\n\ndata: [DONE]\n\n`,
    });
  });
}

function widthSafe(value: string): string {
  return String(value.length);
}

for (const width of [360, 1100]) {
  test(`file upload recovers once with newer opaque authority at ${width}px`, async ({ page }) => {
    const observations: UploadObservation[] = [];
    const generateObservations: UploadObservation[] = [];
    await page.setViewportSize({ width, height: 820 });
    await installHost(page, observations, generateObservations);
    await page.goto(embeddedHostUrl(), { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => window.__sonikAgentUI?.getPageContext?.().activeSessionId ?? null)).toBe(SESSION_ID);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({ name: "authority-retry.txt", mimeType: "text/plain", buffer: Buffer.from("same retained browser bytes") });
    await expect(page.locator("[data-file-upload-status]")).toHaveCount(0);
    const uploadedChip = page.locator('[data-context-chip="file:uploaded-g018"]');
    if (await uploadedChip.count() === 0) await page.locator("[data-staged-context-toggle]").click();
    await expect(uploadedChip).toBeVisible();

    const recovered = observations.filter((item) => item.body.includes("authority-retry.txt"));
    expect(recovered).toHaveLength(2);
    expect(recovered[0]?.authority).toBeTruthy();
    expect(recovered[1]?.authority).toBeTruthy();
    expect(recovered[1]?.authority).not.toBe(recovered[0]?.authority);
    expect(recovered[0]?.body).toContain("same retained browser bytes");
    expect(recovered[1]?.body).toContain("same retained browser bytes");
    expect(recovered[0]?.requestId).toBeTruthy();
    expect(recovered[0]?.requestId).toBe(recovered[1]?.requestId);
    expect(recovered[0]?.traceId).toBeTruthy();
    expect(recovered[0]?.traceId).toBe(recovered[1]?.traceId);

    await fileInput.setInputFiles({ name: "permanent-error.txt", mimeType: "text/plain", buffer: Buffer.from("permanent retained bytes") });
    const failed = page.locator('[data-file-upload-status][data-state="failed"]');
    await expect(failed).toBeVisible();
    await expect(failed).toContainText("The file could not be uploaded. Try again.");
    await expect(failed).not.toContainText("private");
    await expect(uploadedChip).toHaveCount(1);
    expect(observations.filter((item) => item.body.includes("permanent-error.txt"))).toHaveLength(1);
    await mkdir("test-results/g018-file-authority", { recursive: true });
    await page.getByRole("region", { name: "Message composer" }).screenshot({
      path: path.join("test-results/g018-file-authority", `failed-upload-${width}.png`),
      animations: "disabled",
    });

    await failed.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => observations.filter((item) => item.body.includes("permanent-error.txt")).length).toBe(2);
    await expect(failed).toContainText("The file could not be uploaded. Try again.");
    expect(observations.filter((item) => item.body.includes("permanent-error.txt")).every((item) => item.body.includes("permanent retained bytes"))).toBe(true);
    await failed.getByRole("button", { name: "Remove" }).click();
    await expect(failed).toHaveCount(0);

    const textarea = page.locator("textarea").first();
    await textarea.fill("Use my uploaded file");
    await textarea.press("Enter");
    await expect(page.getByText("Recovered generation.", { exact: true })).toBeVisible();
    expect(generateObservations).toHaveLength(2);
    expect(generateObservations[0]?.authority).toBeTruthy();
    expect(generateObservations[1]?.authority).toBeTruthy();
    expect(generateObservations[1]?.authority).not.toBe(generateObservations[0]?.authority);
    expect(generateObservations[0]?.body).toBe(generateObservations[1]?.body);
    expect(generateObservations[0]?.body).toContain(SESSION_ID);
    expect(generateObservations[0]?.body).toContain("Use my uploaded file");
    const replayBodies = generateObservations.slice(0, 2).map((observation) => JSON.parse(observation.body) as {
      contextSelection?: { items?: Array<{ id?: string; kind?: string; label?: string; ref?: string }> };
    });
    const replayedFileContexts = replayBodies.map((body) =>
      body.contextSelection?.items?.find((item) => item.kind === "file" && item.ref === "uploaded-g018"),
    );
    expect(replayedFileContexts[0]).toMatchObject({ id: "file:uploaded-g018", kind: "file", label: "authority-retry.txt", ref: "uploaded-g018" });
    expect(replayedFileContexts[1]).toEqual(replayedFileContexts[0]);
    expect(replayBodies.every((body) => JSON.stringify(body).includes("permanent-error.txt") === false)).toBe(true);
    expect(generateObservations[0]?.requestId).toBe(generateObservations[1]?.requestId);
    expect(generateObservations[0]?.traceId).toBe(generateObservations[1]?.traceId);

    await textarea.fill("Show a safe generation error");
    await textarea.press("Enter");
    await expect(page.getByText("Generation failed. Please try again.", { exact: true })).toBeVisible();
    await expect(page.getByText(/raw generation provider error|private/)).toHaveCount(0);
    await page.waitForTimeout(100);
    expect(generateObservations).toHaveLength(3);

    await page.getByRole("region", { name: "Message composer" }).screenshot({
      path: path.join("test-results/g018-file-authority", `composer-${width}.png`),
      animations: "disabled",
    });
  });
}
