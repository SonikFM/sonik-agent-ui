#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { countRelevantPipeBLines, extractPipeBToolEvents, hasEventName, hasTelemetryEvent } from './lib/booking-pipeb-evidence.mjs';
import { inspectReservationCommitBody } from './lib/agent-ui-smoke-receipts.mjs';

const defaultAgentOrigin = process.env.AGENT_UI_BASE_URL ?? 'https://sonik-agent-ui.liam-trampota.workers.dev';
const useFakeHost = process.env.AGENT_UI_BOOKING_RESERVATION_USE_FAKE_HOST === '1';
const bookingUrl = process.env.BOOKING_URL ?? (useFakeHost ? defaultAgentOrigin : 'https://sonik-booking-app-pipe-b.liam-trampota.workers.dev');
const agentOrigin = defaultAgentOrigin;
const email = process.env.TEST_EMAIL ?? process.env.AMPLIFY_TEST_EMAIL;
const password = process.env.TEST_PASSWORD ?? process.env.AMPLIFY_TEST_PASSWORD;
const pipeBWorker = process.env.AGENT_UI_PIPE_B_WORKER ?? 'sonik-dev-observability-pipe-b';
const runId = process.env.RUN_ID ?? `booking-reservation-pipeb-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const clientRequestId = process.env.AGENT_UI_BOOKING_RESERVATION_CLIENT_REQUEST_ID ?? `agent-ui-smoke-reservation-${runId.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
const outPath = path.resolve('.omx/logs', `${runId}.json`);
const screenshotPath = path.resolve('.omx/logs', `${runId}.png`);
const pipeBPath = path.resolve('.omx/logs', `${runId}.pipe-b.jsonl`);
const pipeBErrPath = path.resolve('.omx/logs', `${runId}.pipe-b.stderr.log`);
const pipeBRawDir = path.resolve('.omx/logs', `${runId}.r2`);
const timeoutMs = Number(process.env.AGENT_UI_BOOKING_RESERVATION_TIMEOUT_MS ?? 300_000);
const reservationStartIso =
  process.env.AGENT_UI_BOOKING_RESERVATION_START ?? nextBookableWindowStartIso();
const reservationEndIso =
  process.env.AGENT_UI_BOOKING_RESERVATION_END ?? addMinutesIso(reservationStartIso, 60);
const prompt = process.env.AGENT_UI_BOOKING_RESERVATION_PROMPT ?? `Use the booking command catalog to prove the reservation flow against the CURRENT HOST/PAGE CONTEXT. First call searchSkillCatalog for the reservation workflow, then call learnSkill for booking.reservation.create. Follow that learned skill exactly. Then learn the command schemas you need. Use inputJson for every executeCommand call. Check availability for the current booking page context from ${reservationStartIso} to ${reservationEndIso} for party size 2. Then call previewBookingReservationCommand for Agent UI Smoke Guest with email agent-ui-smoke@example.test in the same context and time window with source admin, partySize 2, and clientRequestId ${clientRequestId}. Do not call booking.create.guest or booking.create.booking yourself; a human Approve click will run /api/reservation/commit. Do not call booking.create.hold; this is a reservation workflow, not a hold workflow. Do not invent, edit, or provision the trusted actor userId; trusted host context supplies it. Reply with the skill id and the previewed command ids, then stop for approval.`;

if (!useFakeHost && (!email || !password)) throw new Error('Missing TEST_EMAIL/TEST_PASSWORD for booking reservation smoke.');

const startedAtMs = Date.now();
const evidence = {
  schemaVersion: 'sonik.booking_pipeb.agent_ui_reservation_smoke.v1',
  runId,
  bookingUrl,
  agentOrigin,
  reservationWindow: { start: reservationStartIso, end: reservationEndIso },
  clientRequestId,
  pipeB: { worker: pipeBWorker, path: pipeBPath, stderrPath: pipeBErrPath, rawDir: pipeBRawDir, status: 'not_started', lineCount: 0, relevantLineCount: 0, rawObjectCount: 0 },
  prompt,
  startedAt: new Date(startedAtMs).toISOString(),
  responses: [],
  console: [],
  errors: [],
  requestFailures: [],
  checks: {},
};
const children = [];
let pipeBTailStopping = false;
let pipeBTailStdout = null;
let pipeBTailStderr = null;
const watchdog = setTimeout(() => void save('FAIL', 'Booking reservation smoke timed out.'), timeoutMs);

function redact(value) {
  return String(value ?? '')
    .replaceAll(email, '[email]')
    .replaceAll(password, '[password]')
    .replace(/(vck_[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|signature[=:]?[A-Za-z0-9._-]{8,})/gi, '[secret]');
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function nextBookableWindowStartIso() {
  const date = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  date.setUTCHours(18, 0, 0, 0);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString();
}
function addMinutesIso(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 60 * 1000).toISOString();
}
function hasBookingServiceEndpointEvidence(text, endpoint) {
  if (endpoint === 'availability') return /sonik-booking-service-pipe-b[\s\S]*\/api\/v1\/booking\/contexts\/REDACTED\/availability/.test(text);
  if (endpoint === 'guests') return /sonik-booking-service-pipe-b[\s\S]*\/api\/v1\/booking\/guests/.test(text);
  if (endpoint === 'bookings') return /sonik-booking-service-pipe-b[\s\S]*\/api\/v1\/booking\/bookings/.test(text);
  return false;
}
function extractBookingReceiptId(text) {
  const match = text.match(/(?:Booking|Reservation)(?:\s*\/\s*Booking)?\s*ID:\s*`?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})`?/i)
    ?? text.match(/booking (?:created|confirmed):\s*`?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})`?/i);
  return match?.[1] ?? null;
}
function pushBounded(array, value, max = 500) {
  if (array.length < max) array.push(value);
}
async function stopChildren() {
  pipeBTailStopping = true;
  for (const child of children.reverse()) {
    if (child.exitCode !== null || child.signalCode) continue;
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
  }
}
async function refreshPipeBStats() {
  const text = await readFile(pipeBPath, 'utf8').catch(() => '');
  const lines = text.split('\n').filter(Boolean);
  evidence.pipeB.lineCount = lines.length;
  evidence.pipeB.relevantLineCount = lines.filter((line) => line.includes(runId) || line.includes('booking.') || line.includes('tool.') || line.includes('api.generate.skill_index_context')).length;
  evidence.pipeB.status = lines.length > 0 ? 'captured' : evidence.pipeB.status === 'started' ? 'started_no_events' : evidence.pipeB.status;
  const err = await stat(pipeBErrPath).catch(() => null);
  evidence.pipeB.stderrBytes = err?.size ?? 0;
}
function spawnPipeBTailChild(reason = 'start') {
  const child = spawn('pnpm', ['-C', 'apps/standalone-sveltekit', 'exec', 'wrangler', 'tail', pipeBWorker, '--format', 'json'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  evidence.pipeB.status = evidence.pipeB.status === 'started_no_events' ? 'restarted' : 'started';
  evidence.pipeB.tailStarts = (evidence.pipeB.tailStarts ?? 0) + 1;
  evidence.pipeB.tailStartReasons ??= [];
  evidence.pipeB.tailStartReasons.push({ at: new Date().toISOString(), reason });
  child.stdout.on('data', (chunk) => pipeBTailStdout?.write(chunk));
  child.stderr.on('data', (chunk) => pipeBTailStderr?.write(chunk));
  child.on('exit', (code, signal) => {
    evidence.pipeB.exit = { code, signal };
    if (pipeBTailStopping) return;
    evidence.pipeB.tailDisconnects = (evidence.pipeB.tailDisconnects ?? 0) + 1;
    setTimeout(() => {
      if (!pipeBTailStopping && Date.now() - startedAtMs < timeoutMs - 10_000) spawnPipeBTailChild('restart_after_disconnect');
    }, 1_000).unref?.();
  });
}

async function startPipeBTail() {
  await mkdir(path.dirname(pipeBPath), { recursive: true });
  pipeBTailStopping = false;
  pipeBTailStdout = createWriteStream(pipeBPath, { flags: 'a' });
  pipeBTailStderr = createWriteStream(pipeBErrPath, { flags: 'a' });
  spawnPipeBTailChild();
  await sleep(Number(process.env.AGENT_UI_PIPE_B_WARMUP_MS ?? 2500));
  await refreshPipeBStats();
}
async function save(status, reason, browser) {
  clearTimeout(watchdog);
  evidence.status = status;
  evidence.reason = redact(reason);
  evidence.finishedAt = new Date().toISOString();
  await refreshPipeBStats();
  await stopChildren();
  await browser?.close?.().catch(() => undefined);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ status, reason: evidence.reason, outPath, screenshotPath, pipeB: evidence.pipeB, checks: evidence.checks }, null, 2));
  process.exit(status === 'PASS' ? 0 : 1);
}
function observe(page) {
  page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) pushBounded(evidence.console, { at: new Date().toISOString(), type: message.type(), text: redact(message.text()).slice(0, 2000) }); });
  page.on('pageerror', (error) => pushBounded(evidence.errors, redact(error.stack || error.message).slice(0, 4000)));
  page.on('requestfailed', (request) => pushBounded(evidence.requestFailures, { at: new Date().toISOString(), method: request.method(), url: redact(request.url()).slice(0, 800), error: request.failure()?.errorText ?? null }));
  page.on('response', async (response) => {
    try {
      const url = new URL(response.url());
      if (!url.hostname.includes('sonik') && !url.hostname.includes('workers.dev')) return;
      const headers = response.headers();
      pushBounded(evidence.responses, {
        at: new Date().toISOString(),
        method: response.request().method(),
        origin: url.origin,
        path: url.pathname,
        search: url.search.slice(0, 400),
        status: response.status(),
        requestId: headers['x-sonik-request-id'] ?? null,
        traceId: headers['x-sonik-trace-id'] ?? null,
        hostAuthenticated: headers['x-sonik-agent-ui-host-authenticated'] ?? null,
        hostOrg: headers['x-sonik-agent-ui-host-org'] ?? null,
        hostUser: headers['x-sonik-agent-ui-host-user'] ?? null,
        cloudError: headers['x-sonik-agent-ui-cloud-error'] ?? null,
      });
    } catch {}
  });
}
async function findAgentFrame(page) {
  evidence.openAttempts ??= [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const openResult = await page.evaluate(() => {
      const host = window.__sonikAgentHost;
      if (host?.schemaVersion === 'sonik.agent_ui.host_controller.v1' && typeof host.openChat === 'function') {
        host.openChat();
        return { target: 'host-controller-openChat', state: host.getState?.() ?? null };
      }
      const launcher = document.querySelector('#agent-fab-main, [data-sonik-agent-ui-control="launcher"], [data-testid="sonik-agent-ui-launcher"], [aria-label="Open Sonik agent launcher"], [aria-label="Open Sonik agent"]');
      launcher?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      const chat = document.querySelector('#booking-agent-ui-open-chat, #open-chat, [data-sonik-agent-ui-control="open-chat"], [data-testid="sonik-agent-ui-open-chat"], [aria-label="Open Sonik chat sidecar"], [aria-label="Open Sonik chat"]');
      chat?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return { target: 'fallback-dom-controls', hasHost: Boolean(host), schemaVersion: host?.schemaVersion ?? null, launcherFound: Boolean(launcher), chatFound: Boolean(chat) };
    });
    evidence.openAttempts.push({ at: new Date().toISOString(), attempt, openResult });
    evidence.checks.usedDeterministicHostController = evidence.checks.usedDeterministicHostController === true || openResult?.target === 'host-controller-openChat';
    await sleep(1500);
    const frame = page.frames().find((candidate) => {
      const url = candidate.url();
      if (!url.startsWith(agentOrigin)) return false;
      return url.includes('embedMode=') || url.includes('agentUiHostOrigin=');
    });
    if (frame) {
      evidence.checks.embedOpenedWithHostControllerOrFallback = true;
      return frame;
    }
  }
  throw new Error('Booking reservation embed did not open through window.__sonikAgentHost or fallback controls');
}

function parseTailSummaries(text) {
  const summaries = [];
  const visit = (record) => {
    for (const log of record?.logs ?? []) {
      for (const message of log.message ?? []) {
        if (typeof message !== 'string') continue;
        try {
          const parsed = JSON.parse(message);
          if (parsed?.event === 'sonik_dev_tail_batch') summaries.push(parsed);
        } catch {}
      }
    }
  };
  for (const chunk of text.split(/\n(?=\{)/).filter(Boolean)) {
    try { visit(JSON.parse(chunk)); } catch {}
  }
  for (const match of text.matchAll(/"(\{\\"event\\":\\"sonik_dev_tail_batch\\".*?\})"/gs)) {
    try {
      const decoded = JSON.parse(`"${match[1]}"`);
      const parsed = JSON.parse(decoded);
      if (parsed?.event === 'sonik_dev_tail_batch') summaries.push(parsed);
    } catch {}
  }
  return [...new Map(summaries.map((summary) => [summary.objectKey ?? JSON.stringify(summary), summary])).values()];
}

async function collectRawPipeBText() {
  await refreshPipeBStats();
  const tailText = await readFile(pipeBPath, 'utf8').catch(() => '');
  const summaries = parseTailSummaries(tailText);
  const relevant = summaries.filter((summary) => {
    const services = summary.services ?? [];
    const paths = summary.paths ?? [];
    const isAgentGenerate = services.includes('sonik-agent-ui') && paths.some((entry) => entry === '/api/generate' || entry === '/api/[redacted]');
    const isBookingRuntime = services.some((service) => /sonik-booking-(app|service)-pipe-b/.test(service))
      && paths.some((entry) => entry.startsWith('/api/v1/booking/'));
    return Boolean(summary.objectKey) && (isAgentGenerate || isBookingRuntime);
  });
  const maxRawObjects = Math.max(1, Number(process.env.AGENT_UI_PIPE_B_MAX_RAW_OBJECTS ?? 48));
  const cappedRelevant = relevant.slice(-maxRawObjects);
  if (relevant.length > cappedRelevant.length) {
    evidence.pipeB.rawObjectScanTruncated = { totalRelevantSummaries: relevant.length, fetchedLatest: cappedRelevant.length };
  }
  await mkdir(pipeBRawDir, { recursive: true });
  const rawTexts = [];
  const seen = new Set();
  for (const summary of cappedRelevant) {
    if (seen.has(summary.objectKey)) continue;
    seen.add(summary.objectKey);
    const fileName = summary.objectKey.replace(/[^a-zA-Z0-9_.-]+/g, '_');
    const filePath = path.join(pipeBRawDir, fileName);
    const existing = await readFile(filePath, 'utf8').catch(() => null);
    if (existing !== null) {
      rawTexts.push(existing);
      continue;
    }
    const result = spawnSync('pnpm', ['-C', 'apps/standalone-sveltekit', 'exec', 'wrangler', 'r2', 'object', 'get', `sonik-dev-observability-events/${summary.objectKey}`, '--file', filePath, '--remote', '--config', 'wrangler.jsonc'], {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 2_000_000,
      timeout: Number(process.env.AGENT_UI_PIPE_B_R2_FETCH_TIMEOUT_MS ?? 15_000),
    });
    if (result.status === 0) {
      rawTexts.push(await readFile(filePath, 'utf8').catch(() => ''));
    } else {
      evidence.pipeB.r2FetchErrors ??= [];
      evidence.pipeB.r2FetchErrors.push({ objectKey: summary.objectKey, status: result.status, stderr: redact(result.stderr).slice(0, 1000) });
    }
  }
  evidence.pipeB.rawObjectCount = seen.size;
  return `${tailText}\n${rawTexts.join('\n')}`;
}

let browser;
try {
  await startPipeBTail();
  browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false', args: ['--disable-gpu', '--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  if (!useFakeHost) {
    const login = await context.request.post(`${bookingUrl}/api/auth/sign-in/email`, { data: { email, password, callbackURL: '/dashboard' }, headers: { accept: 'application/json' } });
    evidence.loginStatus = login.status();
    if (login.status() >= 400) throw new Error(`booking login failed: ${login.status()}`);
  } else {
    evidence.loginStatus = 'fake-host-fixture';
  }
  const page = await context.newPage();
  observe(page);
  const hostUrl = useFakeHost
    ? `${bookingUrl}/fake-booking-host.html?smokeMockStream=0&hostSession=fixture&smokeRunId=${encodeURIComponent(runId)}`
    : `${bookingUrl}/dashboard?smokeMockStream=0&smokeRunId=${encodeURIComponent(runId)}`;
  await page.goto(hostUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => undefined);
  const frame = await findAgentFrame(page);
  await frame.waitForFunction(() => Boolean(window.__sonikAgentUI?.actions?.createSession && window.__sonikAgentUI?.actions?.submitPrompt && window.__sonikAgentUI?.getPageContext), undefined, { timeout: 60000 });
  await frame.waitForFunction(() => window.__sonikAgentUI.getPageContext()?.hostSession?.authenticated === true, undefined, { timeout: 60000 });
  const before = await frame.evaluate(() => ({ context: window.__sonikAgentUI.getPageContext(), assertions: window.__sonikAgentUI.getAssertions(), text: document.body.innerText.slice(0, 2000) }));
  evidence.before = before;
  const createSession = await frame.evaluate(async () => window.__sonikAgentUI.actions.createSession());
  evidence.createSession = createSession;
  if (!createSession?.ok) throw new Error(`createSession failed: ${JSON.stringify(createSession)}`);
  await frame.waitForFunction(() => window.__sonikAgentUI.getAssertions().hasActiveSession === true && Boolean(window.__sonikAgentUI.getPageContext().activeSessionId), undefined, { timeout: 60000 });
  evidence.sessionId = createSession.expectedSessionId ?? createSession.activeSessionId ?? await frame.evaluate(() => window.__sonikAgentUI.getPageContext().activeSessionId);
  const submit = await frame.evaluate(async ({ prompt, sessionId }) => window.__sonikAgentUI.actions.submitPrompt({ prompt, sessionId }), { prompt, sessionId: evidence.sessionId });
  evidence.submit = submit;
  if (!submit?.ok) throw new Error(`submitPrompt failed: ${JSON.stringify(submit)}`);
  await frame.waitForFunction(() => window.__sonikAgentUI.getAssertions().isStreaming === true, undefined, { timeout: 45000 }).catch(() => undefined);
  await frame.waitForFunction(() => window.__sonikAgentUI.getAssertions().isStreaming === false && window.__sonikAgentUI.getAssertions().messageCount >= 2, undefined, { timeout: 240000 });
  const approvalButton = frame.locator('[data-chat-approval-card] [data-approval-action="approve"]').first();
  await approvalButton.waitFor({ state: 'visible', timeout: 60000 });
  evidence.approvalCardVisible = true;
  const commitResponsePromise = page.waitForResponse((response) => {
    try {
      const url = new URL(response.url());
      return url.origin === agentOrigin && url.pathname === '/api/reservation/commit';
    } catch {
      return false;
    }
  }, { timeout: 120000 });
  await approvalButton.click();
  const commitResponse = await commitResponsePromise;
  const commitBody = await commitResponse.json().catch(() => null);
  const commitInspection = inspectReservationCommitBody(commitBody);
  evidence.reservationCommitResponse = {
    status: commitResponse.status(),
    transportOk: commitResponse.status() < 400,
    logicalOk: commitInspection.logicalOk,
    body: commitInspection,
  };
  await frame.waitForFunction(() => document.body.innerText.includes('Reservation created') || document.body.innerText.includes('Reservation booking failed'), undefined, { timeout: 60000 }).catch(() => undefined);
  await sleep(8000);
  const after = await frame.evaluate(() => ({ context: window.__sonikAgentUI.getPageContext(), assertions: window.__sonikAgentUI.getAssertions(), text: document.body.innerText.slice(0, 16000) }));
  evidence.after = after;
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  await refreshPipeBStats();
  const pipeText = await collectRawPipeBText();
  const pipeBMarkers = [runId, evidence.sessionId, clientRequestId, reservationStartIso, reservationEndIso];
  const toolEvents = extractPipeBToolEvents(pipeText, { markers: pipeBMarkers });
  evidence.pipeB.correlationMarkers = pipeBMarkers;
  evidence.pipeB.correlatedRelevantLineCount = countRelevantPipeBLines(pipeText, pipeBMarkers);
  evidence.pipeB.toolEventSample = toolEvents.slice(-60).map((line) => redact(line).slice(0, 2000));
  const responseText = `${after.text}
${pipeText}`;
  const successfulGenerate = evidence.responses.filter((entry) => entry.origin === agentOrigin && entry.path === '/api/generate' && entry.status === 200).length;
  const agentFailures = evidence.responses.filter((entry) => entry.origin === agentOrigin && entry.status >= 400).map((entry) => `${entry.status} ${entry.path}`);
  const trustedHostResponses = evidence.responses.filter((entry) => entry.origin === agentOrigin && ['/api/session', '/api/sessions'].includes(entry.path));
  const serverTrustedHostBoundary = trustedHostResponses.some((entry) => entry.status < 400 && entry.hostAuthenticated === 'true' && entry.hostOrg === 'present' && entry.hostUser === 'present' && entry.cloudError == null);
  const failedRuntimeFetch = (commandId) => hasTelemetryEvent(toolEvents, commandId, 'booking.runtime.fetch.end', false);
  const failedCommit = (commandId) => hasTelemetryEvent(toolEvents, commandId, 'tool.commitCommand', false) || hasTelemetryEvent(toolEvents, commandId, 'commit.human_approved', false);
  const successfulRuntimeFetch = (commandId) => hasTelemetryEvent(toolEvents, commandId, 'booking.runtime.fetch.end', true);
  const successfulCommit = (commandId) => hasTelemetryEvent(toolEvents, commandId, 'tool.commitCommand', true) || hasTelemetryEvent(toolEvents, commandId, 'commit.human_approved', true);
  const successfulExecute = (commandId) => hasTelemetryEvent(toolEvents, commandId, 'tool.executeCommand', true);
  const reservationSkillSearchOk = hasTelemetryEvent(toolEvents, 'booking.reservation.create', 'tool.searchSkillCatalog', true)
    || toolEvents.some((line) => line.includes('"event":"tool.searchSkillCatalog"')
      && line.includes('"ok":true')
      && /reservation/i.test(line)
      && /(workflow|create booking|booking)/i.test(line));
  const preflightFailureEvents = toolEvents.filter((line) => line.includes('command_input_preflight_failed') && (line.includes('tool.executeCommand') || line.includes('tool.commitCommand') || line.includes('commit.human_approved')));
  const holdCommandEvents = toolEvents.filter((line) => line.includes('booking.create.hold') && (line.includes('tool.executeCommand') || line.includes('tool.commitCommand') || line.includes('commit.human_approved') || line.includes('booking.runtime.fetch')));
  const transcriptSkillWorkflowEvidence = /booking\.reservation\.create/i.test(after.text)
    && /booking\.get\.availability/i.test(after.text)
    && /previewBookingReservationCommand|reservation preview/i.test(after.text);
  const transcriptReceiptEvidence = /Status:\s*booked|Booking confirmed|Reservation Flow Proven|Reservation Flow — Complete|Reservation created/i.test(after.text)
    && Boolean(extractBookingReceiptId(after.text))
    && after.text.includes(clientRequestId);
  const backendEndpointEvidence = hasBookingServiceEndpointEvidence(pipeText, 'availability')
    && hasBookingServiceEndpointEvidence(pipeText, 'guests')
    && hasBookingServiceEndpointEvidence(pipeText, 'bookings');
  const toolTelemetryComplete = successfulRuntimeFetch('booking.get.availability') === true
    && successfulExecute('booking.get.availability') === true
    && hasTelemetryEvent(toolEvents, 'booking.create.booking', 'tool.previewBookingReservationCommand', true) === true
    && successfulRuntimeFetch('booking.create.guest') === true
    && successfulCommit('booking.create.guest') === true
    && successfulRuntimeFetch('booking.create.booking') === true
    && successfulCommit('booking.create.booking') === true;
  evidence.pipeB.requiredEvidence = {
    skillIndexContextOk: hasEventName(toolEvents, 'api.generate.skill_index_context', true) && toolEvents.some((line) => line.includes('booking.reservation.create')),
    skillSearchOk: reservationSkillSearchOk,
    skillLearnOk: hasTelemetryEvent(toolEvents, 'booking.reservation.create', 'tool.learnSkill', true),
    availabilityRuntimeFetchOk: successfulRuntimeFetch('booking.get.availability'),
    availabilityExecuteOk: successfulExecute('booking.get.availability'),
    previewReservationOk: hasTelemetryEvent(toolEvents, 'booking.create.booking', 'tool.previewBookingReservationCommand', true),
    guestRuntimeFetchOk: successfulRuntimeFetch('booking.create.guest'),
    guestCommitOk: successfulCommit('booking.create.guest'),
    bookingRuntimeFetchOk: successfulRuntimeFetch('booking.create.booking'),
    bookingCommitOk: successfulCommit('booking.create.booking'),
    bookingRuntimeFetchFailed: failedRuntimeFetch('booking.create.booking'),
    bookingCommitFailed: failedCommit('booking.create.booking'),
    preflightFailureEventCount: preflightFailureEvents.length,
    holdCommandEventCount: holdCommandEvents.length,
    toolTelemetryComplete,
    backendEndpointEvidence,
    transcriptSkillWorkflowEvidence,
    transcriptReceiptEvidence,
    bookingReceiptId: commitInspection.bookingReceiptId ?? extractBookingReceiptId(after.text),
    reservationCommitBodyOk: commitInspection.ok,
    reservationCommitGuestId: commitInspection.guestId,
    reservationCommitGuestReceiptOk: commitInspection.guestReceiptOk,
    reservationCommitBookingReceiptOk: commitInspection.bookingReceiptOk,
    reservationCommitLogicalOk: commitInspection.logicalOk,
  };
  evidence.checks = {
    loginOk: useFakeHost || evidence.loginStatus < 400,
    embedOpenedWithHostControllerOrFallback: evidence.checks.embedOpenedWithHostControllerOrFallback === true,
    usedDeterministicHostController: evidence.checks.usedDeterministicHostController === true,
    hostAuthenticated: before.context?.hostSession?.authenticated === true,
    createSessionOk: createSession?.ok === true,
    submitOk: submit?.ok === true,
    activeSessionStable: before.context?.activeSessionId !== evidence.sessionId && after.context?.activeSessionId === evidence.sessionId,
    successfulGenerate: successfulGenerate >= 1,
    noAgentApiFailures: agentFailures.length === 0,
    serverTrustedHostBoundary,
    mentionsAvailability: /booking\.get\.availability|get availability|availability/i.test(responseText),
    mentionsGuestCreate: /booking\.create\.guest|create guest|created guest/i.test(responseText),
    mentionsBookingCreate: /booking\.create\.booking|create booking|created booking|reservation/i.test(responseText),
    reservationCommitLogicalOk: commitInspection.logicalOk === true,
    skillWorkflowEvidence: (evidence.pipeB.requiredEvidence.skillIndexContextOk === true
      && evidence.pipeB.requiredEvidence.skillSearchOk === true
      && evidence.pipeB.requiredEvidence.skillLearnOk === true)
      || evidence.pipeB.requiredEvidence.transcriptSkillWorkflowEvidence === true,
    pipeBToolEvidence: (evidence.pipeB.requiredEvidence.toolTelemetryComplete === true
      || (evidence.pipeB.requiredEvidence.backendEndpointEvidence === true
        && evidence.pipeB.requiredEvidence.transcriptReceiptEvidence === true))
      && evidence.pipeB.requiredEvidence.bookingRuntimeFetchFailed === false
      && evidence.pipeB.requiredEvidence.bookingCommitFailed === false,
    preflightDidNotLoopBadInputs: evidence.pipeB.requiredEvidence.preflightFailureEventCount <= 2 && !/Missing path parameter: contextId|Unsupported generated booking parameter: date|tool is sending an empty object|retry with the same bad call/i.test(after.text),
    noHoldCommandUsed: evidence.pipeB.requiredEvidence.holdCommandEventCount === 0,
    agentFailures,
  };
  const pass = Object.entries(evidence.checks).every(([key, value]) => {
    if (key === 'agentFailures') return Array.isArray(value) && value.length === 0;
    if (key === 'usedDeterministicHostController') return true;
    return Boolean(value);
  });
  await save(pass ? 'PASS' : 'FAIL', pass ? 'Embedded booking reservation flow passed with Pipe B command evidence.' : 'Embedded booking reservation flow failed checks.', browser);
} catch (error) {
  evidence.harnessError = redact(error?.stack || error?.message || error).slice(0, 5000);
  await save('FAIL', error?.message || String(error), browser);
}
