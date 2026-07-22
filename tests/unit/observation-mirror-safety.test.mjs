import assert from "node:assert/strict";
import test from "node:test";
import { access, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// CodeRabbit R2 finding #1 (CRITICAL): recordSessionObservationBatch builds a
// filesystem path directly from the request-cookie sessionId
// (os.tmpdir()/sonik-dev-workbench-observations/<sessionId>/). A tampered
// cookie value containing ".." can escape the scratch directory. This suite
// proves a strict allow-list rejects any sessionId shaped like a traversal
// attempt (or containing path separators at all) before any path is built,
// and that legitimate sessionIds (as minted by workspace-service's
// randomUUID(), or the hyphenated fixture ids used elsewhere in this test
// suite) are unaffected.

const { recordSessionObservationBatch } = await import(
  "../../apps/dev-workbench/src/lib/server/observation-mirror.ts"
);

function consoleEvent(seq) {
  return { kind: "console", seq, level: "log", message: "hi", timestamp: new Date().toISOString() };
}

test("R2C.1: a sessionId containing path traversal segments is rejected and nothing is written", async () => {
  const maliciousSessionId = "../../evil";
  await assert.rejects(
    () => recordSessionObservationBatch(maliciousSessionId, [consoleEvent(1)]),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /session/i, "the rejection must identify the sessionId as the problem");
      return true;
    },
  );

  // tmpdir()/sonik-dev-workbench-observations/../../evil resolves to a sibling
  // two levels above the scratch root -- confirm nothing landed there.
  const escapedRoot = path.join(tmpdir(), "sonik-dev-workbench-observations", "..", "..", "evil");
  await assert.rejects(() => access(escapedRoot), "no directory must be created at the path-traversal target");
});

test("R2C.2: a sessionId containing a path separator (no dot-segments) is also rejected", async () => {
  await assert.rejects(() => recordSessionObservationBatch("foo/bar", [consoleEvent(1)]));
  await assert.rejects(() => recordSessionObservationBatch("foo\\bar", [consoleEvent(1)]));
});

test("R2C.3: an empty sessionId is rejected", async () => {
  await assert.rejects(() => recordSessionObservationBatch("", [consoleEvent(1)]));
});

test("R2C.4: a well-formed sessionId (matching how real sessions are minted) is still accepted and writes JSONL", async () => {
  const sessionId = "observation-mirror-safety-red-suite";
  const scratchDir = path.join(tmpdir(), "sonik-dev-workbench-observations", sessionId);
  try {
    const result = await recordSessionObservationBatch(sessionId, [consoleEvent(1)]);
    assert.deepEqual(result, { accepted: 1 });
    const written = await readFile(path.join(scratchDir, "console.jsonl"), "utf8");
    assert.ok(written.includes("\"seq\":1"), "the legitimate sessionId path must still be written to");
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
});

console.log("observation-mirror-safety tests: ok");
