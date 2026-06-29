import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const bookingUrl = process.env.BOOKING_URL ?? 'https://sonik-booking-app-pipe-b.liam-trampota.workers.dev';
const agentOrigin = process.env.AGENT_UI_BASE_URL ?? 'https://sonik-agent-ui.liam-trampota.workers.dev';
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;
const runId = process.env.RUN_ID ?? `booking-pipeb-document-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outPath = path.resolve('.omx/logs', `${runId}.json`);
const screenshotPath = path.resolve('.omx/logs', `${runId}.png`);
if (!email || !password) throw new Error('Missing TEST_EMAIL/TEST_PASSWORD');
const evidence = { schemaVersion: 'sonik.booking_pipeb.agent_ui_document_smoke.v1', runId, bookingUrl, agentOrigin, startedAt: new Date().toISOString(), responses: [], console: [], errors: [], checks: {} };
function redact(value){ return String(value ?? '').replaceAll(email, '[email]').replaceAll(password, '[password]').replace(/(signature[=:]?[A-Za-z0-9._-]{8,}|vck_[A-Za-z0-9_-]+)/gi, '[secret]'); }
async function save(status, reason, browser){ evidence.status = status; evidence.reason = redact(reason); evidence.finishedAt = new Date().toISOString(); await mkdir(path.dirname(outPath), { recursive: true }); await writeFile(outPath, JSON.stringify(evidence, null, 2)); await browser?.close().catch(()=>undefined); console.log(JSON.stringify({ status, reason: evidence.reason, outPath, screenshotPath, checks: evidence.checks }, null, 2)); process.exit(status === 'PASS' ? 0 : 1); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser, page;
try {
  browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false', args: ['--disable-gpu','--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  page = await context.newPage();
  page.on('console', (message) => { if (['error','warning'].includes(message.type())) evidence.console.push({ type: message.type(), text: redact(message.text()).slice(0, 2000) }); });
  page.on('pageerror', (error) => evidence.errors.push(redact(error.stack || error.message).slice(0, 3000)));
  page.on('response', async (response) => {
    try {
      const url = new URL(response.url());
      if (url.origin !== agentOrigin) return;
      evidence.responses.push({ method: response.request().method(), path: url.pathname, status: response.status(), headers: Object.fromEntries(Object.entries(response.headers()).filter(([key]) => key.startsWith('x-sonik-agent-ui'))) });
    } catch {}
  });
  const login = await context.request.post(`${bookingUrl}/api/auth/sign-in/email`, { data: { email, password, callbackURL: '/dashboard' }, headers: { accept: 'application/json' } });
  evidence.loginStatus = login.status();
  if (login.status() >= 400) throw new Error(`login failed ${login.status()}`);
  await page.goto(`${bookingUrl}/dashboard?smokeMockStream=0&smokeRunId=${encodeURIComponent(runId)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
  const openResult = await page.evaluate(async () => {
    if (window.__sonikAgentHost?.openChat) {
      window.__sonikAgentHost.openChat();
      return { target: 'host-controller' };
    }
    const control = document.querySelector('#booking-agent-ui-open-chat, [data-sonik-agent-ui-control="open-chat"], [aria-label="Open Sonik chat sidecar"]');
    control?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return { target: control ? 'dom-control' : 'none' };
  });
  evidence.openResult = openResult;
  await page.waitForFunction((origin) => [...document.querySelectorAll('iframe')].some((frame) => frame.src.startsWith(origin)), agentOrigin, { timeout: 45000 });
  let frame;
  for (let i = 0; i < 80; i += 1) { frame = page.frames().find((candidate) => candidate.url().startsWith(agentOrigin)); if (frame) break; await sleep(250); }
  if (!frame) throw new Error('agent frame missing');
  await frame.waitForFunction(() => Boolean(window.__sonikAgentUI?.actions?.createSession && window.__sonikAgentUI?.actions?.openWorkspaceDocument), undefined, { timeout: 60000 });
  await frame.waitForFunction(() => window.__sonikAgentUI.getPageContext()?.hostSession?.authenticated === true, undefined, { timeout: 45000 });
  const createSession = await frame.evaluate(async () => window.__sonikAgentUI.actions.createSession());
  evidence.createSession = createSession;
  if (!createSession?.ok) throw new Error(`createSession failed: ${JSON.stringify(createSession)}`);
  await frame.waitForFunction(() => Boolean(window.__sonikAgentUI.getPageContext().activeSessionId), undefined, { timeout: 45000 });
  const openDoc = await frame.evaluate(async () => window.__sonikAgentUI.actions.openWorkspaceDocument());
  evidence.openDoc = openDoc;
  if (!openDoc?.ok) throw new Error(`openWorkspaceDocument failed: ${JSON.stringify(openDoc)}`);
  await frame.waitForFunction(() => window.__sonikAgentUI.getAssertions().hasActiveDocument === true && Boolean(window.__sonikAgentUI.getPageContext().activeDocumentId), undefined, { timeout: 60000 });
  await sleep(2000);
  evidence.final = await frame.evaluate(() => ({ context: window.__sonikAgentUI.getPageContext(), assertions: window.__sonikAgentUI.getAssertions(), text: document.body.innerText.slice(0, 4000) }));
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(()=>undefined);
  const documentResponses = evidence.responses.filter((entry) => entry.path === '/api/document' || entry.path.startsWith('/api/document/'));
  const failedDocumentResponses = documentResponses.filter((entry) => entry.status >= 400);
  const cloudMissing = documentResponses.filter((entry) => entry.headers?.['x-sonik-agent-ui-cloud-error'] === 'missing-host-context');
  evidence.checks = {
    loginOk: evidence.loginStatus < 400,
    createSessionOk: createSession?.ok === true,
    openDocumentOk: openDoc?.ok === true,
    hasActiveDocument: evidence.final?.assertions?.hasActiveDocument === true && Boolean(evidence.final?.context?.activeDocumentId),
    documentRequestsSeen: documentResponses.length > 0,
    noDocumentFailures: failedDocumentResponses.length === 0,
    noMissingHostContext: cloudMissing.length === 0,
  };
  const pass = Object.values(evidence.checks).every(Boolean);
  await save(pass ? 'PASS' : 'FAIL', pass ? 'Booking Pipe B document smoke passed.' : 'Booking Pipe B document smoke failed.', browser);
} catch (error) {
  await page?.screenshot?.({ path: screenshotPath, fullPage: true }).catch(()=>undefined);
  evidence.harnessError = redact(error?.stack || error?.message || error).slice(0, 4000);
  await save('FAIL', error?.message || String(error), browser);
}
