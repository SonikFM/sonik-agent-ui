#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { countRelevantPipeBLines, extractPipeBToolEvents, hasEventName, hasTelemetryEvent } from './lib/booking-pipeb-evidence.mjs';

const agentOrigin = process.env.AGENT_UI_BASE_URL ?? 'https://sonik-agent-ui.liam-trampota.workers.dev';
const bookingUrl = process.env.BOOKING_URL ?? 'https://sonik-booking-app-pipe-b.liam-trampota.workers.dev';
const email = process.env.TEST_EMAIL ?? process.env.AMPLIFY_TEST_EMAIL;
const password = process.env.TEST_PASSWORD ?? process.env.AMPLIFY_TEST_PASSWORD;
const pipeBWorker = process.env.AGENT_UI_PIPE_B_WORKER ?? 'sonik-dev-observability-pipe-b';
const runId = process.env.RUN_ID ?? `booking-context-pipeb-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outPath = path.resolve('.omx/logs', `${runId}.json`);
const screenshotPath = path.resolve('.omx/logs', `${runId}.png`);
const pipeBPath = path.resolve('.omx/logs', `${runId}.pipe-b.jsonl`);
const pipeBErrPath = path.resolve('.omx/logs', `${runId}.pipe-b.stderr.log`);
const pipeBRawDir = path.resolve('.omx/logs', `${runId}.r2`);
const timeoutMs = Number(process.env.AGENT_UI_BOOKING_CONTEXT_TIMEOUT_MS ?? 300_000);
const artifactId = `booking-context-intake-smoke-${runId.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
const contextName = `Agent UI Smoke Cafe ${Date.now()}`;
// Draft-only invariant (Slice A, 2026-07-08): the model can only ever produce a
// preview. commitActiveIntakeCommand/commitCommand are no longer mounted tools,
// so this prompt stops at previewActiveIntakeCommand; the actual publish is
// exercised below via the real approveAndRun page-control action (the same
// deterministic /api/intake/commit endpoint the Approve button calls), not a
// model tool call.
const prompt = process.env.AGENT_UI_BOOKING_CONTEXT_PROMPT ?? `Show the approval preview for this active booking intake manifest; do not create/commit the context yourself. You MUST call searchSkillCatalog as a separate visible tool call for booking.context.create before learnSkill. Then call learnSkill for workflow, policy, context, and commands. Follow the skill exactly: call readActiveArtifactState, then previewActiveIntakeCommand. Report the previewed command input and tell the user a human must click Approve to publish it. Do not search repeatedly.`;

if (!email || !password) throw new Error('Missing TEST_EMAIL/TEST_PASSWORD for booking context smoke.');

const startedAtMs = Date.now();
const evidence = {
  schemaVersion: 'sonik.booking_pipeb.agent_ui_context_smoke.v1',
  runId,
  bookingUrl,
  agentOrigin,
  artifactId,
  contextName,
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
const watchdog = setTimeout(() => void save('FAIL', 'Booking context smoke timed out.'), timeoutMs);

function redact(value) {
  return String(value ?? '')
    .replaceAll(email, '[email]')
    .replaceAll(password, '[password]')
    .replace(/(vck_[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|signature[=:]?[A-Za-z0-9._-]{8,})/gi, '[secret]');
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function pushBounded(array, value, max = 500) { if (array.length < max) array.push(value); }
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
  const child = spawn('pnpm', ['-C', 'apps/standalone-sveltekit', 'exec', 'wrangler', 'tail', pipeBWorker, '--format', 'json'], { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
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
      pushBounded(evidence.responses, { at: new Date().toISOString(), method: response.request().method(), origin: url.origin, path: url.pathname, search: url.search.slice(0, 400), status: response.status(), requestId: headers['x-sonik-request-id'] ?? null, traceId: headers['x-sonik-trace-id'] ?? null, hostAuthenticated: headers['x-sonik-agent-ui-host-authenticated'] ?? null, hostOrg: headers['x-sonik-agent-ui-host-org'] ?? null, hostUser: headers['x-sonik-agent-ui-host-user'] ?? null, cloudError: headers['x-sonik-agent-ui-cloud-error'] ?? null });
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
      return url.startsWith(agentOrigin) && (url.includes('embedMode=') || url.includes('agentUiHostOrigin='));
    });
    if (frame && evidence.checks.usedDeterministicHostController === true) return frame;
  }
  throw new Error('Booking embed did not open through window.__sonikAgentHost');
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
    const isAgentGenerate = services.includes('sonik-agent-ui') && paths.some((entry) => entry === '/api/generate' || entry === '/api/artifact' || entry === '/api/[redacted]');
    const isBookingRuntime = services.some((service) => /sonik-booking-(app|service)-pipe-b/.test(service)) && paths.some((entry) => entry.startsWith('/api/v1/booking/'));
    return Boolean(summary.objectKey) && (isAgentGenerate || isBookingRuntime);
  });
  const cappedRelevant = relevant.slice(-Math.max(1, Number(process.env.AGENT_UI_PIPE_B_MAX_RAW_OBJECTS ?? 48)));
  await mkdir(pipeBRawDir, { recursive: true });
  const rawTexts = [];
  const seen = new Set();
  for (const summary of cappedRelevant) {
    if (seen.has(summary.objectKey)) continue;
    seen.add(summary.objectKey);
    const fileName = summary.objectKey.replace(/[^a-zA-Z0-9_.-]+/g, '_');
    const filePath = path.join(pipeBRawDir, fileName);
    const existing = await readFile(filePath, 'utf8').catch(() => null);
    if (existing !== null) { rawTexts.push(existing); continue; }
    const result = spawnSync('pnpm', ['-C', 'apps/standalone-sveltekit', 'exec', 'wrangler', 'r2', 'object', 'get', `sonik-dev-observability-events/${summary.objectKey}`, '--file', filePath, '--remote', '--config', 'wrangler.jsonc'], { cwd: process.cwd(), env: process.env, encoding: 'utf8', maxBuffer: 2_000_000, timeout: Number(process.env.AGENT_UI_PIPE_B_R2_FETCH_TIMEOUT_MS ?? 15_000) });
    if (result.status === 0) rawTexts.push(await readFile(filePath, 'utf8').catch(() => ''));
    else {
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
  const login = await context.request.post(`${bookingUrl}/api/auth/sign-in/email`, { data: { email, password, callbackURL: '/dashboard' }, headers: { accept: 'application/json' } });
  evidence.loginStatus = login.status();
  if (login.status() >= 400) throw new Error(`booking login failed: ${login.status()}`);
  const page = await context.newPage();
  observe(page);
  await page.goto(`${bookingUrl}/dashboard?smokeMockStream=0&smokeRunId=${encodeURIComponent(runId)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => undefined);
  const frame = await findAgentFrame(page);
  await frame.waitForFunction(() => Boolean(window.__sonikAgentUI?.actions?.createSession && window.__sonikAgentUI?.actions?.submitPrompt && window.__sonikAgentUI?.actions?.reloadSession && window.__sonikAgentUI?.getPageContext), undefined, { timeout: 60000 });
  await frame.waitForFunction(() => window.__sonikAgentUI.getPageContext()?.hostSession?.authenticated === true, undefined, { timeout: 60000 });
  const before = await frame.evaluate(() => ({ context: window.__sonikAgentUI.getPageContext(), assertions: window.__sonikAgentUI.getAssertions(), text: document.body.innerText.slice(0, 2000), actions: Object.keys(window.__sonikAgentUI.actions ?? {}).sort() }));
  evidence.before = before;
  const contractVersions = await frame.evaluate(() => ({ pageControl: window.__sonikAgentUI?.schemaVersion ?? null, assertions: window.__sonikAgentUI?.getAssertions?.()?.schemaVersion ?? null }));
  evidence.contractVersions = contractVersions;
  evidence.checks.pageControlSchemaVersion = contractVersions.pageControl === 'sonik.agent_ui.page_control.v1';
  evidence.checks.assertionsSchemaVersion = contractVersions.assertions === 'sonik.agent_ui.assertions.v1';
  const createSession = await frame.evaluate(async () => window.__sonikAgentUI.actions.createSession());
  evidence.createSession = createSession;
  if (!createSession?.ok) throw new Error(`createSession failed: ${JSON.stringify(createSession)}`);
  await frame.waitForFunction(() => window.__sonikAgentUI.getAssertions().hasActiveSession === true && Boolean(window.__sonikAgentUI.getPageContext().activeSessionId), undefined, { timeout: 60000 });
  evidence.sessionId = createSession.expectedSessionId ?? createSession.activeSessionId ?? await frame.evaluate(() => window.__sonikAgentUI.getPageContext().activeSessionId);

  const artifactUpsert = await frame.evaluate(async ({ artifactId, sessionId, contextName }) => {
    const encode = (value) => btoa(unescape(encodeURIComponent(JSON.stringify(value)))).replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const pageContext = window.__sonikAgentUI.getPageContext();
    const hostSession = pageContext.hostSession;
    if (!hostSession?.authenticated) throw new Error('missing authenticated hostSession');
    const organizationId = hostSession.organizationId ?? pageContext.organizationId;
    const userId = hostSession.userId ?? hostSession.principalId;
    const signedHeader = encode({
      authenticated: true,
      organizationId,
      scopes: pageContext.scopes ?? hostSession.scopes ?? [],
      signatureVersion: pageContext.signatureVersion ?? null,
      issuedAt: pageContext.issuedAt ?? null,
      expiresAt: pageContext.expiresAt ?? null,
      signature: pageContext.signature ?? null,
      hostSession: {
        source: hostSession.source,
        sessionId: hostSession.sessionId ?? null,
        userId,
        principalId: hostSession.principalId ?? userId,
        organizationId,
        authenticated: true,
        scopes: hostSession.scopes ?? [],
        expiresAt: hostSession.expiresAt ?? null,
        ...(hostSession.metadata ? { metadata: hostSession.metadata } : {}),
      },
    });
    const spec = {
      root: 'main',
      elements: {
        main: { type: 'Card', props: { title: `${contextName} intake`, description: 'Persisted approved smoke-test intake manifest.' }, children: [] },
      },
      state: {
        manifest: {
          manifestType: 'venue_schedule',
          status: 'draft',
          source: { createdBy: 'agent-ui-smoke', skill: 'booking.context.intake' },
          intakeMode: 'venue_schedule',
          business: { name: contextName },
          inventory: {
            coreDescription: 'Restaurant reservations with 8 two-top tables, instant confirmation, Monday through Friday 9 AM to 5 PM.',
            confirmationMode: 'instant_confirm',
            tableCount: 8,
            tableSize: 2,
          },
          schedule: {
            timezone: 'America/New_York',
            days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
            opensAt: '09:00',
            closesAt: '17:00',
            servicePeriods: [
              { name: 'Breakfast', startsAt: '09:00', endsAt: '11:00' },
              { name: 'Lunch', startsAt: '11:00', endsAt: '14:00' },
              { name: 'Dinner', startsAt: '14:00', endsAt: '17:00' },
            ],
          },
        },
      },
    };
    const response = await fetch('/api/artifact', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sonik-agent-ui-host-context': signedHeader },
      body: JSON.stringify({ id: artifactId, session_id: sessionId, kind: 'json-render', title: `${contextName} intake`, content: spec, source: 'user', summary: 'Pipe-B context-create smoke intake fixture' }),
    });
    const body = await response.text();
    return { ok: response.ok, status: response.status, headers: { policy: response.headers.get('x-sonik-agent-ui-persistence-policy'), mode: response.headers.get('x-sonik-agent-ui-persistence-mode'), hostAuthenticated: response.headers.get('x-sonik-agent-ui-host-authenticated'), hostOrg: response.headers.get('x-sonik-agent-ui-host-org'), hostUser: response.headers.get('x-sonik-agent-ui-host-user'), cloudError: response.headers.get('x-sonik-agent-ui-cloud-error') }, body: body.slice(0, 2000) };
  }, { artifactId, sessionId: evidence.sessionId, contextName });
  evidence.artifactUpsert = artifactUpsert;
  if (!artifactUpsert.ok) throw new Error(`artifact upsert failed: ${JSON.stringify(artifactUpsert)}`);
  const reload = await frame.evaluate(async () => window.__sonikAgentUI.actions.reloadSession());
  evidence.reloadSession = reload;
  if (!reload?.ok) throw new Error(`reloadSession failed: ${JSON.stringify(reload)}`);
  await frame.waitForFunction((artifactId) => window.__sonikAgentUI.getPageContext().activeArtifactId === artifactId, artifactId, { timeout: 60000 });
  const afterReload = await frame.evaluate(() => ({ context: window.__sonikAgentUI.getPageContext(), assertions: window.__sonikAgentUI.getAssertions(), text: document.body.innerText.slice(0, 4000) }));
  evidence.afterReload = afterReload;
  // With a workflow artifact active, the page context must report a machine-readable workflow snapshot (58db4f9).
  evidence.workflowSnapshot = afterReload.context?.workflow ?? null;
  evidence.checks.workflowPhaseReported = typeof evidence.workflowSnapshot?.phase === 'string';
  const submit = await frame.evaluate(async ({ prompt, sessionId }) => window.__sonikAgentUI.actions.submitPrompt({ prompt, sessionId }), { prompt, sessionId: evidence.sessionId });
  evidence.submit = submit;
  if (!submit?.ok) throw new Error(`submitPrompt failed: ${JSON.stringify(submit)}`);
  await frame.waitForFunction(() => window.__sonikAgentUI.getAssertions().isStreaming === true, undefined, { timeout: 45000 }).catch(() => undefined);
  await frame.waitForFunction(() => window.__sonikAgentUI.getAssertions().isStreaming === false && window.__sonikAgentUI.getAssertions().messageCount >= 2, undefined, { timeout: 240000 });
  await sleep(8000);
  const after = await frame.evaluate(() => ({ context: window.__sonikAgentUI.getPageContext(), assertions: window.__sonikAgentUI.getAssertions(), text: document.body.innerText.slice(0, 16000) }));
  evidence.after = after;
  // Draft-only invariant: the model turn above only ever produces a preview.
  // Publishing is exercised here through the real approveAndRun page-control
  // action -- the same call the Approve button makes -- which now calls the
  // deterministic /api/intake/commit endpoint directly, no model turn involved.
  const approveAndRun = await frame.evaluate(async () => window.__sonikAgentUI.actions.approveAndRun());
  evidence.approveAndRun = approveAndRun;
  if (!approveAndRun?.ok) throw new Error(`approveAndRun failed: ${JSON.stringify(approveAndRun)}`);
  await sleep(2000);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  const pipeText = await collectRawPipeBText();
  const pipeBMarkers = [runId, evidence.sessionId, artifactId, contextName];
  const toolEvents = extractPipeBToolEvents(pipeText, { markers: pipeBMarkers });
  evidence.pipeB.correlationMarkers = pipeBMarkers;
  evidence.pipeB.correlatedRelevantLineCount = countRelevantPipeBLines(pipeText, pipeBMarkers);
  evidence.pipeB.toolEventSample = toolEvents.slice(-80).map((line) => redact(line).slice(0, 2000));
  const agentFailures = evidence.responses.filter((entry) => entry.origin === agentOrigin && entry.status >= 400).map((entry) => `${entry.status} ${entry.path}`);
  const trustedHostResponses = evidence.responses.filter((entry) => entry.origin === agentOrigin && ['/api/session', '/api/sessions'].includes(entry.path));
  const serverTrustedHostBoundary = trustedHostResponses.some((entry) => entry.status < 400 && entry.hostAuthenticated === 'true' && entry.hostOrg === 'present' && entry.hostUser === 'present' && entry.cloudError == null);
  const text = `${after.text}\n${pipeText}`;
  evidence.pipeB.requiredEvidence = {
    skillIndexContextOk: hasEventName(toolEvents, 'api.generate.skill_index_context', true) && toolEvents.some((line) => line.includes('booking.context.create')),
    skillSearchOk: hasTelemetryEvent(toolEvents, 'booking.context.create', 'tool.searchSkillCatalog', true),
    skillLearnOk: hasTelemetryEvent(toolEvents, 'booking.context.create', 'tool.learnSkill', true),
    readActiveArtifactOk: hasEventName(toolEvents, 'tool.readActiveArtifactState', true),
    previewActiveIntakeOk: hasEventName(toolEvents, 'tool.previewActiveIntakeCommand', true),
    // Draft-only invariant: the commit is a human-clicked, deterministic endpoint
    // call (approveAndRun above), never a model tool call.
    commitHumanApprovedOk: hasEventName(toolEvents, 'commit.human_approved', true),
    contextRuntimeFetchOk: hasTelemetryEvent(toolEvents, 'booking.create.context', 'booking.runtime.fetch.end', true),
    contextRuntimeFetchFailed: hasTelemetryEvent(toolEvents, 'booking.create.context', 'booking.runtime.fetch.end', false),
  };
  evidence.checks = {
    loginOk: evidence.loginStatus < 400,
    usedDeterministicHostController: evidence.checks.usedDeterministicHostController === true,
    hostAuthenticated: before.context?.hostSession?.authenticated === true,
    createSessionOk: createSession?.ok === true,
    artifactPersisted: artifactUpsert.ok === true && artifactUpsert.body.includes('workspace-session-'),
    reloadSessionOk: reload?.ok === true,
    activeArtifactHydrated: afterReload.context?.activeArtifactId === artifactId,
    activeSessionStable: before.context?.activeSessionId !== evidence.sessionId && after.context?.activeSessionId === evidence.sessionId,
    submitOk: submit?.ok === true,
    approveAndRunOk: approveAndRun?.ok === true,
    noAgentApiFailures: agentFailures.length === 0,
    serverTrustedHostBoundary,
    mentionsContextCreate: /booking\.create\.context|created booking context|context id|created context/i.test(text),
    pipeBToolEvidence: evidence.pipeB.requiredEvidence.skillIndexContextOk === true
      && evidence.pipeB.requiredEvidence.skillSearchOk === true
      && evidence.pipeB.requiredEvidence.skillLearnOk === true
      && evidence.pipeB.requiredEvidence.readActiveArtifactOk === true
      && evidence.pipeB.requiredEvidence.previewActiveIntakeOk === true
      && evidence.pipeB.requiredEvidence.commitHumanApprovedOk === true
      && evidence.pipeB.requiredEvidence.contextRuntimeFetchOk === true
      && evidence.pipeB.requiredEvidence.contextRuntimeFetchFailed === false,
    agentFailures,
  };
  const pass = Object.entries(evidence.checks).every(([key, value]) => key === 'agentFailures' ? Array.isArray(value) && value.length === 0 : Boolean(value));
  await save(pass ? 'PASS' : 'FAIL', pass ? 'Embedded booking context create flow passed with Pipe B command evidence.' : 'Embedded booking context create flow failed checks.', browser);
} catch (error) {
  evidence.harnessError = redact(error?.stack || error?.message || error).slice(0, 5000);
  await save('FAIL', error?.message || String(error), browser);
}
