import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// E1 (Epic 1 - Observation commands) red acceptance suite.
// Pinned wished-for API (.omc/plans/2026-07-21-dev-workbench-agent-tdd-plan.md):
//   packages/tool-contracts/src/observe.ts
//   packages/agent-embed/src/observation-capture.ts
//   packages/tool-contracts/src/capability-matrix.ts
//   apps/dev-workbench bootstrap env + observation-mirror.ts
// None of these exist yet. Every test below must FAIL with a clear
// "not implemented: ..." message (via assert.fail) rather than crash with an
// import error, so a reviewer can see intent even before green.

async function importOrFail(specifier, what) {
  try {
    return await import(specifier);
  } catch (error) {
    assert.fail(`not implemented: ${what} (import of ${specifier} failed: ${error.message})`);
  }
}

async function loadObservationCapture() {
  const mod = await importOrFail("../../packages/agent-embed/src/observation-capture.ts", "packages/agent-embed/src/observation-capture.ts exporting createObservationCapture");
  if (typeof mod.createObservationCapture !== "function") {
    assert.fail("not implemented: createObservationCapture export from packages/agent-embed/src/observation-capture.ts");
  }
  return mod;
}

async function loadObserveContracts() {
  return importOrFail("../../packages/tool-contracts/src/observe.ts", "packages/tool-contracts/src/observe.ts (observe.console.read / observe.network.read schemas + constants)");
}

async function loadCapabilityMatrix() {
  const mod = await importOrFail("../../packages/tool-contracts/src/capability-matrix.ts", "packages/tool-contracts/src/capability-matrix.ts exporting buildCapabilityMatrix");
  if (typeof mod.buildCapabilityMatrix !== "function") {
    assert.fail("not implemented: buildCapabilityMatrix export from packages/tool-contracts/src/capability-matrix.ts");
  }
  return mod;
}

test("E1.1: console redaction — recordConsole redacts secret values from readConsole output", async () => {
  const { createObservationCapture } = await loadObservationCapture();
  const capture = createObservationCapture();
  capture.recordConsole("error", ["boom", { apiKey: "sk-live-abc123" }]);
  const result = capture.readConsole({});
  assert.equal(result.entries.length, 1, "expected exactly one recorded console entry");
  const [entry] = result.entries;
  assert.equal(entry.level, "error");
  assert.match(entry.message, /boom/);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("sk-live-abc123"), false, "raw secret value must never appear anywhere in the read payload");
});

test("E1.2: ring buffer bounds — 500 rapid logs keep only the most recent 200, report droppedCount, stay under the byte budget", async () => {
  const { createObservationCapture } = await loadObservationCapture();
  const { CONSOLE_RING_CAPACITY, OBSERVE_RESPONSE_MAX_BYTES } = await loadObserveContracts();
  assert.equal(CONSOLE_RING_CAPACITY, 200, "not implemented: CONSOLE_RING_CAPACITY constant must equal 200 per plan D4");
  assert.equal(OBSERVE_RESPONSE_MAX_BYTES, 32768, "not implemented: OBSERVE_RESPONSE_MAX_BYTES constant must equal 32768 per plan D4");

  const capture = createObservationCapture();
  for (let index = 0; index < 500; index += 1) {
    capture.recordConsole("info", [`entry-${index}`]);
  }
  const result = capture.readConsole({ limit: 200 });
  assert.equal(result.entries.length, 200, "expected exactly 200 entries returned");
  assert.equal(result.droppedCount, 300, "expected droppedCount to report the 300 evicted entries");
  const seqs = result.entries.map((entry) => entry.seq);
  const sorted = [...seqs].sort((a, b) => a - b);
  assert.deepEqual(seqs, sorted, "entries must be seq-ordered ascending");
  assert.equal(seqs[seqs.length - 1] - seqs[0], 199, "returned entries must be the most recent contiguous window");
  assert.ok(JSON.stringify(result).length <= 32768, "serialized response must stay within the 32KB token budget");
});

test("E1.3: network redaction — recordNetwork for a 500-status fetch never leaks auth headers/cookies/tokens", async () => {
  const { createObservationCapture } = await loadObservationCapture();
  const capture = createObservationCapture();
  capture.recordNetwork({
    method: "POST",
    url: "https://booking.sonik.local/api/reservations",
    status: 500,
    durationMs: 842,
    sizeBytes: 1024,
    requestHeaders: { authorization: "Bearer secret-token-value-123456789", cookie: "session=super-secret-cookie" },
  });
  const result = capture.readNetwork({});
  assert.equal(result.entries.length, 1, "expected exactly one recorded network entry");
  const [entry] = result.entries;
  assert.equal(entry.method, "POST");
  assert.equal(entry.url.startsWith("https://booking.sonik.local/api/reservations"), true);
  assert.equal(entry.status, 500);
  assert.equal(entry.durationMs, 842);
  const serialized = JSON.stringify(result).toLowerCase();
  assert.equal(serialized.includes("authorization"), false, "authorization header key/value must never appear in the payload");
  assert.equal(serialized.includes("cookie"), false, "cookie header key/value must never appear in the payload");
  assert.equal(serialized.includes("secret-token-value-123456789"), false, "token value must never appear in the payload");
  assert.equal(serialized.includes("super-secret-cookie"), false, "cookie value must never appear in the payload");
});

test("E1.4: navigation survival — serialize()/restore() round-trips entries with identical seqs across a fresh capture instance", async () => {
  const { createObservationCapture } = await loadObservationCapture();
  const before = createObservationCapture();
  before.recordConsole("warn", ["first"]);
  before.recordConsole("error", ["second"]);
  before.recordNetwork({ method: "GET", url: "https://booking.sonik.local/api/health", status: 200, durationMs: 12, sizeBytes: 128 });
  const snapshot = before.serialize();

  const after = createObservationCapture();
  after.restore(snapshot);
  const restoredConsole = after.readConsole({});
  const beforeConsole = before.readConsole({});
  assert.deepEqual(
    restoredConsole.entries.map((entry) => [entry.seq, entry.message]),
    beforeConsole.entries.map((entry) => [entry.seq, entry.message]),
    "console entries must survive serialize()/restore() with identical seqs, simulating navigation within a session",
  );
  const restoredNetwork = after.readNetwork({});
  assert.equal(restoredNetwork.entries.length, 1, "network entries must also survive serialize()/restore()");
});

test("E1.5: bootstrap env + sandbox mirror — dev-workbench bootstrap plan carries SONIK_CONSOLE_LOG_PATH/SONIK_NETWORK_LOG_PATH, and appendObservationEvents writes JSONL", async () => {
  const bootstrapPlanMod = await importOrFail(
    "../../apps/dev-workbench/src/lib/server/bootstrap-plan.ts",
    "apps/dev-workbench/src/lib/server/bootstrap-plan.ts must include SONIK_CONSOLE_LOG_PATH/SONIK_NETWORK_LOG_PATH in bootstrap env",
  );
  if (typeof bootstrapPlanMod.createDevWorkbenchBootstrapPlan !== "function") {
    assert.fail("not implemented: createDevWorkbenchBootstrapPlan export from apps/dev-workbench/src/lib/server/bootstrap-plan.ts");
  }
  const workbenchContracts = await importOrFail(
    "../../apps/dev-workbench/src/lib/contracts/workbench.ts",
    "apps/dev-workbench/src/lib/contracts/workbench.ts repositoryManifestSchema/DEFAULT_REPOSITORY_COMMANDS fixtures",
  );
  const repository = workbenchContracts.repositoryManifestSchema.parse({
    schemaVersion: workbenchContracts.DEV_WORKBENCH_SCHEMA_VERSION,
    repositoryId: "sonikfm.sonik-agent-ui",
    cloneUrl: "https://github.com/sonikfm/sonik-agent-ui.git",
    revision: "abc123def456",
    branch: "main",
    deployment: null,
    commands: workbenchContracts.DEFAULT_REPOSITORY_COMMANDS,
  });

  const plan = bootstrapPlanMod.createDevWorkbenchBootstrapPlan({
    sessionId: "observe-commands-red-suite",
    repository,
  });
  const flattenedPlan = JSON.stringify(plan);
  assert.equal(flattenedPlan.includes("SONIK_CONSOLE_LOG_PATH"), true, "bootstrap plan env must include SONIK_CONSOLE_LOG_PATH");
  assert.equal(flattenedPlan.includes("SONIK_NETWORK_LOG_PATH"), true, "bootstrap plan env must include SONIK_NETWORK_LOG_PATH");

  const mirrorMod = await importOrFail(
    "../../apps/dev-workbench/src/lib/server/observation-mirror.ts",
    "apps/dev-workbench/src/lib/server/observation-mirror.ts exporting appendObservationEvents",
  );
  if (typeof mirrorMod.appendObservationEvents !== "function") {
    assert.fail("not implemented: appendObservationEvents export from apps/dev-workbench/src/lib/server/observation-mirror.ts");
  }
  const dir = await mkdtemp(path.join(tmpdir(), "sonik-observe-mirror-"));
  const consolePath = path.join(dir, "console.jsonl");
  const networkPath = path.join(dir, "network.jsonl");
  try {
    await mirrorMod.appendObservationEvents(
      { consolePath, networkPath },
      [{ kind: "console", seq: 1, level: "error", message: "boom", timestamp: new Date().toISOString() }],
    );
    const written = await readFile(consolePath, "utf8");
    const lines = written.split("\n").filter(Boolean);
    assert.ok(lines.length >= 1, "appendObservationEvents must write at least one JSONL line to the console mirror path");
    assert.doesNotThrow(() => JSON.parse(lines[0]), "each mirrored line must be valid JSON");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("E1.6: capability matrix — every registered command appears exactly once with {enabled, reason}, disabled reasons are non-empty", async () => {
  const { buildCapabilityMatrix } = await loadCapabilityMatrix();
  const targetRegistryMod = await importOrFail(
    "../../packages/tool-contracts/src/target-registry.ts",
    "packages/tool-contracts/src/target-registry.ts (existing target-registry fixture source for capability matrix)",
  );
  const registry = targetRegistryMod.createHostUiTargetRegistry({
    provider: "observe-commands-red-suite",
    generatedAt: "2026-07-21T00:00:00.000Z",
    targets: [
      targetRegistryMod.normalizeHostUiTarget({
        targetId: "observe.console.read",
        label: "Console read",
        description: "Redacted host console ring buffer.",
        surface: "observability",
        capabilities: ["describe"],
      }),
      targetRegistryMod.normalizeHostUiTarget({
        targetId: "observe.network.read",
        label: "Network read",
        description: "Redacted host network ring buffer.",
        surface: "observability",
        capabilities: ["describe"],
      }),
      targetRegistryMod.normalizeHostUiTarget({
        targetId: "workspace.preview.restart",
        label: "Preview restart",
        description: "Restart the preview server.",
        surface: "dev-loop",
        capabilities: ["run"],
        enabled: false,
        disabledReason: "Preview restart is a permanent stub today.",
        policy: { actionMode: "block", reason: "Preview restart is a permanent stub today." },
      }),
    ],
  });

  const matrix = buildCapabilityMatrix(registry);
  assert.ok(Array.isArray(matrix), "not implemented: buildCapabilityMatrix must return an array of {commandId, enabled, reason}");
  for (const target of registry.targets) {
    const rows = matrix.filter((row) => row.commandId === target.targetId);
    assert.equal(rows.length, 1, `expected command ${target.targetId} to appear exactly once in the capability matrix`);
    const [row] = rows;
    assert.equal(typeof row.enabled, "boolean", `expected ${target.targetId} matrix row to carry a boolean enabled flag`);
    if (!row.enabled) {
      assert.ok(typeof row.reason === "string" && row.reason.length > 0, `expected disabled command ${target.targetId} to carry a non-empty reason`);
    }
  }
  const restartRow = matrix.find((row) => row.commandId === "workspace.preview.restart");
  assert.equal(restartRow?.enabled, false, "workspace.preview.restart fixture target is disabled and must be reported disabled in the matrix");
});
