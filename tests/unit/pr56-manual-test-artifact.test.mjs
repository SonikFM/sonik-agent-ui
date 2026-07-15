import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const html = await readFile("docs/testing/agent-ui-pr56-manual-test-2026-07-15.html", "utf8");
const testIds = [...html.matchAll(/\bid:\s*"(MT-056-[A-Z]+-\d{3})"/g)].map((match) => match[1]);
const expectedTestIds = [
  "MT-056-PRE-001", "MT-056-PRE-002",
  "MT-056-FILE-001", "MT-056-FILE-002",
  "MT-056-HIST-001", "MT-056-HIST-002",
  "MT-056-WFB-001", "MT-056-WFB-002", "MT-056-WFB-003",
  "MT-056-CHAN-001", "MT-056-CHAN-002",
  "MT-056-RESP-001", "MT-056-RESP-002", "MT-056-RESP-003",
  "MT-056-PRIV-001", "MT-056-PRIV-002",
  "MT-056-SAFE-001", "MT-056-EVID-001",
];

assert.equal(testIds.length, 18, "the console stays compact while covering the PR critical path");
assert.equal(new Set(testIds).size, testIds.length, "manual-test IDs must be unique and stable");
assert.deepEqual(testIds, expectedTestIds, "manual-test IDs and ordering are a stable review allowlist");
assert.doesNotMatch(html, /<(?:script|link|img|iframe)\b[^>]*(?:src|href)\s*=\s*["']https?:/i, "the artifact must not load remote assets");
assert.doesNotMatch(html, /<script\b[^>]+src=|<link\b/i, "the artifact must remain a single self-contained file");
const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join("\n");
assert.doesNotMatch(css, /@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//i, "CSS must not import remote stylesheets");
assert.doesNotMatch(css, /url\(\s*["']?(?:https?:)?\/\//i, "CSS must not load remote assets");

for (const text of [
  "Preflight and version", "File authority and stable history", "Workflow Builder and fixture-only Channels",
  "Responsive and accessibility", "Privacy and telemetry", "Release safety and evidence",
  "ledger_read_failed", "ledger_write_failed", "workflow_action_busy", "integration_not_yet_available",
  "No deployment, production mutation", "MT-056-UX-001",
]) assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));

assert.match(html, /tests\.map\(testRow\)/, "every declared test must render through the row contract");
assert.match(html, /<select class="result-control"[^>]*data-result-for="\$\{test\.id\}"/, "every row renders a result control");
assert.match(html, /<textarea class="notes-field"[^>]*data-notes-for="\$\{test\.id\}"/, "every row renders a notes field");
assert.match(html, /sonik\.manual-test\.pr56\.v1\.state/);

for (const marker of [
  'id="export-results"', 'id="copy-failures"', 'id="print-results"', 'id="reset-results"',
  "new Blob", "navigator.clipboard.writeText", "window.print", "localStorage.removeItem",
]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(html, /copied = document\.execCommand\("copy"\)/, "the clipboard fallback must use execCommand's boolean result");
assert.match(html, /if \(!copied\)[\s\S]*Copy failed\. Select and copy the failure summary manually\.[\s\S]*return;/, "failed clipboard paths must announce failure and skip the success message");

assert.match(html, /Object\.defineProperty\(window, "__sonikManualTest"/);
for (const member of ["schemaVersion", "getSummary", "getResults", "setResult"]) assert.match(html, new RegExp(`\\b${member}\\b`));
for (const tag of ["header", "main", "section", "table", "form"]) assert.match(html, new RegExp(`<${tag}\\b`, "i"));

assert.doesNotMatch(html, /(?:linear|radial|conic|repeating-linear)-gradient/i);
assert.doesNotMatch(html, /border-(?:left|right)\s*:/i);
assert.doesNotMatch(html, /\stitle\s*=/i, "native title tooltips are not interaction design");
assert.doesNotMatch(html, /box-shadow|backdrop-filter/i);
assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "the product console must not use decorative emoji");

const summarySource = html.match(/\/\/ summary-contract:start\s*([\s\S]*?)\s*\/\/ summary-contract:end/)?.[1];
assert.ok(summarySource, "the pure summary contract must remain extractable from the artifact");
const summarizeResults = runInNewContext(`(() => { ${summarySource}; return summarizeResults; })()`, {
  RESULTS: ["Not run", "Pass", "Fail", "Blocked", "N/A"],
  SCHEMA_VERSION: "sonik.manual-test.pr56.v1",
});
const resultSet = (result) => testIds.map((id, index) => ({ id, severity: index < 10 ? "Critical" : "High", result, notes: "" }));
assert.equal(summarizeResults(resultSet("N/A")).verdict, "Needs review", "all-N/A coverage cannot be ready for sign-off");
assert.deepEqual(JSON.parse(JSON.stringify(summarizeResults(resultSet("Pass")))), {
  schemaVersion: "sonik.manual-test.pr56.v1",
  total: expectedTestIds.length,
  counts: { "Not run": 0, Pass: expectedTestIds.length, Fail: 0, Blocked: 0, "N/A": 0 },
  verdict: "Ready for sign-off",
}, "summary exports the full stable contract, not only a verdict");
assert.equal(summarizeResults(resultSet("Pass").map((entry, index) => index === 0 ? { ...entry, result: "Fail" } : entry)).verdict, "No-go");
assert.equal(summarizeResults(resultSet("Pass").map((entry, index) => index === 0 ? { ...entry, result: "Not run" } : entry)).verdict, "In progress");

console.log(JSON.stringify({ ok: true, checked: "pr56-manual-test-artifact", tests: testIds.length }));
