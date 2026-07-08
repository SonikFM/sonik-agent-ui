#!/usr/bin/env node
// Curated demo-seed batch tool: populates the DEPLOYED agent-ui workspace
// with realistic booking.context.intake artifacts (session + intake artifact
// + a fully ANSWERED question list) so the demo workspace looks alive.
//
// Curated direct authoring, NOT model-driven: every record comes from
// scripts/harness/seed-corpus.mjs (hand-authored venues/answers), rendered
// through scripts/harness/lib/intake-spec-builder.mjs (a plain-JS port of
// the real booking.context.intake surface/state shapes). This tool never
// calls booking.create.context and never writes to booking-service — it
// stops at a saved, fully-answered draft artifact, same trust boundary the
// app itself enforces before a trusted host-approved command commit.
//
// Auth path (verified live against the deployed booking app + agent-ui
// worker): sign in to the booking app -> GET its signed agent-ui
// host-context envelope -> base64url-encode it as the
// x-sonik-agent-ui-host-context header on every agent-ui request. Reuses
// scripts/harness/lib/host-context.mjs + lib/endpoint-client.mjs verbatim
// (the same lib P1's headless workflow driver uses) rather than
// re-deriving the encoding.
//
// Usage:
//   node scripts/harness/seed-batch.mjs --count 5
//   node scripts/harness/seed-batch.mjs --count 100 --concurrency 6
//   node scripts/harness/seed-batch.mjs --count 5 --dry-run
//
// Env:
//   BOOKING_URL              default https://sonik-booking-app-pipe-b.liam-trampota.workers.dev
//   AGENT_UI_DEPLOYED_URL    default https://sonik-agent-ui.liam-trampota.workers.dev
//   TEST_EMAIL / TEST_PASSWORD (or AMPLIFY_TEST_EMAIL/AMPLIFY_TEST_PASSWORD)
//                             default test69@gmail.com / test6969 (the
//                             verified demo-seed account for this workspace)

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EndpointClient } from "./lib/endpoint-client.mjs";
import { loginDeployedHostContext, deployedHeaders } from "./lib/host-context.mjs";
import { buildDraftIntakeSpec, buildAnswerStateChanges, INTAKE_QUESTIONS, requiredAnswerIds } from "./lib/intake-spec-builder.mjs";
import { SEED_CORPUS } from "./seed-corpus.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const DEFAULT_BOOKING_URL = "https://sonik-booking-app-pipe-b.liam-trampota.workers.dev";
const DEFAULT_AGENT_UI_URL = "https://sonik-agent-ui.liam-trampota.workers.dev";
const DEFAULT_TEST_EMAIL = "test69@gmail.com";
const DEFAULT_TEST_PASSWORD = "test6969";
const ENVELOPE_REFRESH_MARGIN_MS = 90_000; // refresh proactively when < 90s of a ~10min envelope remain

function parseArgs(argv) {
  const args = { count: 25, concurrency: 6, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--count") args.count = Number(argv[++i]);
    else if (arg === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--run-id") args.runId = argv[++i];
    else if (arg === "--booking-url") args.bookingUrl = argv[++i];
    else if (arg === "--agent-ui-url") args.agentUiUrl = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  if (!Number.isInteger(args.count) || args.count < 1) throw new Error(`--count must be a positive integer (got ${argv})`);
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) throw new Error("--concurrency must be a positive integer");
  return args;
}

function printHelp() {
  console.log(`node scripts/harness/seed-batch.mjs --count <n> [options]

Options:
  --count <n>          How many demo artifacts to create (cycles the curated corpus)
  --concurrency <n>     Bounded concurrent create pipelines (default 6)
  --dry-run             Compute the planned records and write the manifest, no HTTP calls
  --run-id <id>         Override the generated seed batch id
  --booking-url <url>   Override BOOKING_URL
  --agent-ui-url <url>  Override AGENT_UI_DEPLOYED_URL

See this file's header comment for the auth path and reversibility markers.`);
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Cycle the curated corpus to reach `count`, applying light name variation on repeats. */
export function planSeedRecords(count, corpus = SEED_CORPUS) {
  if (!Array.isArray(corpus) || corpus.length === 0) throw new Error("Seed corpus is empty.");
  const plan = [];
  for (let i = 0; i < count; i += 1) {
    const base = corpus[i % corpus.length];
    const cycle = Math.floor(i / corpus.length);
    const venueName = cycle === 0 ? base.venueName : `${base.venueName} — Location ${cycle + 1}`;
    plan.push({ seedIndex: i, cycle, category: base.category, intakeMode: base.intakeMode, venueName, answers: base.answers });
  }
  return plan;
}

/** Build the {spec, answerChanges} pair for one planned record. Pure, no I/O — unit-testable. */
export function buildRecordArtifact(planned, { artifactId, skillId } = {}) {
  const missing = requiredAnswerIds().filter((id) => !(id in planned.answers));
  if (missing.length > 0) throw new Error(`Seed record "${planned.venueName}" is missing answers for: ${missing.join(", ")}`);
  const spec = buildDraftIntakeSpec({ contextName: planned.venueName, intakeMode: planned.intakeMode, artifactId, skillId });
  spec.state.seedBatch = { seedIndex: planned.seedIndex, category: planned.category, cycle: planned.cycle };
  const answerSteps = INTAKE_QUESTIONS.map((question) => ({
    question,
    value: planned.answers[question.id],
  }));
  return { spec, answerSteps };
}

function redact(value, secrets) {
  let text = String(value ?? "");
  for (const secret of secrets) {
    if (secret) text = text.replaceAll(secret, "[redacted]");
  }
  return text;
}

class EnvelopeManager {
  constructor({ bookingUrl, email, password }) {
    this.bookingUrl = bookingUrl;
    this.email = email;
    this.password = password;
    this.envelope = null;
    this.refreshPromise = null;
  }

  async #login() {
    ({ envelope: this.envelope } = await loginDeployedHostContext({ bookingUrl: this.bookingUrl, email: this.email, password: this.password }));
    return this.envelope;
  }

  async ensureFresh() {
    if (this.envelope) {
      const expiresAt = this.envelope.expiresAt ? Date.parse(this.envelope.expiresAt) : NaN;
      const remaining = Number.isFinite(expiresAt) ? expiresAt - Date.now() : Infinity;
      if (remaining > ENVELOPE_REFRESH_MARGIN_MS) return this.envelope;
    }
    if (!this.refreshPromise) {
      this.refreshPromise = this.#login().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runNext() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const bookingUrl = args.bookingUrl ?? process.env.BOOKING_URL ?? DEFAULT_BOOKING_URL;
  const agentUiUrl = args.agentUiUrl ?? process.env.AGENT_UI_DEPLOYED_URL ?? DEFAULT_AGENT_UI_URL;
  const email = process.env.TEST_EMAIL ?? process.env.AMPLIFY_TEST_EMAIL ?? DEFAULT_TEST_EMAIL;
  const password = process.env.TEST_PASSWORD ?? process.env.AMPLIFY_TEST_PASSWORD ?? DEFAULT_TEST_PASSWORD;
  const secrets = [email, password];

  const batchId = args.runId ?? `demo-seed-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const plan = planSeedRecords(args.count);

  const result = {
    schemaVersion: "sonik.agent_ui.demo_seed_batch.v1",
    batchId,
    dryRun: args.dryRun,
    bookingUrl,
    agentUiUrl,
    requested: args.count,
    concurrency: args.concurrency,
    startedAt: new Date().toISOString(),
    records: [],
    failures: [],
  };

  if (args.dryRun) {
    result.records = plan.map((planned) => {
      const artifactId = `${batchId}-${String(planned.seedIndex).padStart(4, "0")}-${slugify(planned.venueName)}`;
      const { spec } = buildRecordArtifact(planned, { artifactId });
      return { seedIndex: planned.seedIndex, name: planned.venueName, category: planned.category, artifactId, sessionId: null, questionCount: INTAKE_QUESTIONS.length, spec: undefined };
    });
    result.finishedAt = new Date().toISOString();
    result.succeeded = result.records.length;
    result.failed = 0;
    await writeManifest(result);
    console.log(JSON.stringify({ status: "DRY_RUN", batchId, requested: args.count, planned: result.records.length, manifestPath: result.manifestPath }, null, 2));
    return;
  }

  const envelopeManager = new EnvelopeManager({ bookingUrl, email, password });
  let envelope;
  try {
    envelope = await envelopeManager.ensureFresh();
  } catch (loginError) {
    const message = redact(loginError?.message ?? String(loginError), secrets);
    console.error(JSON.stringify({ status: "FAIL", stage: "login_or_envelope", error: message }, null, 2));
    process.exitCode = 1;
    return;
  }

  const client = new EndpointClient({
    baseUrl: agentUiUrl,
    headers: deployedHeaders(envelope),
    onResponse: () => {},
  });

  await runPool(plan, args.concurrency, async (planned) => {
    const artifactId = `${batchId}-${String(planned.seedIndex).padStart(4, "0")}-${slugify(planned.venueName)}`;
    const sessionName = `${planned.venueName} [demo-seed:${batchId}]`;
    try {
      const currentEnvelope = await envelopeManager.ensureFresh();
      if (currentEnvelope !== envelope) {
        envelope = currentEnvelope;
        client.headers = deployedHeaders(envelope);
      }

      const session = await client.createSession({ name: sessionName, mode: "artifact" });
      const { spec, answerSteps } = buildRecordArtifact(planned, { artifactId });

      const upserted = await client.upsertArtifact({
        id: artifactId,
        session_id: session.id,
        kind: "json-render",
        title: `${planned.venueName} intake`,
        content: spec,
        source: "user",
        summary: "Curated demo-seed intake (booking.context.intake)",
      });
      let currentVersion = upserted.artifact.version;

      for (const [stepIndex, step] of answerSteps.entries()) {
        const { changes } = buildAnswerStateChanges({ question: step.question, value: step.value, artifactId, sessionId: session.id });
        const patched = await client.patchArtifactState(artifactId, {
          artifactId,
          baseVersion: currentVersion,
          changes,
          requestId: `${batchId}:${artifactId}:${stepIndex}`,
          summary: `Curated answer for ${step.question.id}`,
        });
        currentVersion = patched.artifact.version;
      }

      result.records.push({
        seedIndex: planned.seedIndex,
        name: planned.venueName,
        category: planned.category,
        sessionId: session.id,
        artifactId,
        artifactVersion: currentVersion,
        questionsAnswered: answerSteps.length,
      });
    } catch (caught) {
      const status = caught?.status ?? null;
      const body = caught?.body ? redact(JSON.stringify(caught.body), secrets) : undefined;
      result.failures.push({
        seedIndex: planned.seedIndex,
        name: planned.venueName,
        artifactId,
        status,
        path: caught?.path ?? null,
        error: redact(caught?.message ?? String(caught), secrets),
        body,
      });
    }
  });

  result.finishedAt = new Date().toISOString();
  result.succeeded = result.records.length;
  result.failed = result.failures.length;
  await writeManifest(result);

  console.log(JSON.stringify({
    status: result.failed === 0 ? "PASS" : "PARTIAL",
    batchId,
    requested: args.count,
    succeeded: result.succeeded,
    failed: result.failed,
    manifestPath: result.manifestPath,
    sample: result.records[0] ?? null,
    failuresSample: result.failures.slice(0, 5),
  }, null, 2));

  process.exitCode = result.failed > 0 ? 1 : 0;
}

async function writeManifest(result) {
  const logDir = path.join(repoRoot, ".omx", "logs");
  await mkdir(logDir, { recursive: true });
  const manifestPath = path.join(logDir, `seed-manifest-${result.batchId}.json`);
  result.manifestPath = manifestPath;
  await writeFile(manifestPath, JSON.stringify(result, null, 2));
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
