#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile, watch } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logPath = process.env.SONIK_AGENT_UI_TELEMETRY_LOG ?? path.join(repoRoot, ".omx", "logs", "agent-ui-telemetry.jsonl");
const port = Number(process.env.AGENT_UI_EVIDENCE_PORT ?? 5175);
const host = process.env.AGENT_UI_EVIDENCE_HOST ?? "127.0.0.1";
const allowLan = process.env.AGENT_UI_EVIDENCE_ALLOW_LAN === "true";

function responseHeaders(req, contentType) {
  const headers = {
    "content-type": contentType,
    "cache-control": "no-store",
  };
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) headers["access-control-allow-origin"] = origin;
  return headers;
}

function isAllowedOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  } catch {
    return false;
  }
}

function jsonResponse(req, res, status, body) {
  res.writeHead(status, responseHeaders(req, "application/json; charset=utf-8"));
  res.end(JSON.stringify(body, null, 2));
}

async function readEvents() {
  if (!existsSync(logPath)) return [];
  const text = await readFile(logPath, "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      return { source: "dev-server", event: "telemetry.parse_error", ok: false, error: error instanceof Error ? error.message : String(error), line: index + 1 };
    }
  });
}

function filterEvents(events, url) {
  const keys = ["requestId", "traceId", "sessionId", "event", "runId", "source"];
  return events.filter((event) => keys.every((key) => !url.searchParams.get(key) || String(event[key] ?? "") === url.searchParams.get(key)));
}

function writeDashboard(req, res, events) {
  const rows = events.slice(-200).reverse().map((event) => `<tr><td>${escapeHtml(event.at ?? "")}</td><td>${escapeHtml(event.source ?? "")}</td><td>${escapeHtml(event.event ?? "")}</td><td>${escapeHtml(event.requestId ?? "")}</td><td>${escapeHtml(event.sessionId ?? "")}</td><td><pre>${escapeHtml(JSON.stringify(event, null, 2))}</pre></td></tr>`).join("\n");
  res.writeHead(200, responseHeaders(req, "text/html; charset=utf-8"));
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent UI Evidence</title><style>body{font-family:ui-sans-serif,system-ui;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px;vertical-align:top}pre{white-space:pre-wrap;max-height:16rem;overflow:auto}</style><h1>Agent UI Evidence</h1><p>${escapeHtml(logPath)}</p><table><thead><tr><th>at</th><th>source</th><th>event</th><th>request</th><th>session</th><th>json</th></tr></thead><tbody>${rows}</tbody></table>`);
}

async function writeSse(req, res) {
  res.writeHead(200, {
    ...responseHeaders(req, "text/event-stream; charset=utf-8"),
    connection: "keep-alive",
  });
  let offset = existsSync(logPath) ? statSync(logPath).size : 0;
  const sendNewLines = async () => {
    if (!existsSync(logPath)) return;
    const size = statSync(logPath).size;
    if (size <= offset) return;
    const stream = createReadStream(logPath, { start: offset, end: size - 1, encoding: "utf8" });
    offset = size;
    let chunk = "";
    for await (const piece of stream) chunk += piece;
    for (const line of chunk.split("\n").filter(Boolean)) res.write(`data: ${line}\n\n`);
  };
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
  req.on("close", () => clearInterval(heartbeat));
  await sendNewLines();
  try {
    for await (const _ of watch(path.dirname(logPath), { persistent: true })) {
      if (req.destroyed) break;
      await sendNewLines();
    }
  } catch {
    clearInterval(heartbeat);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (!allowLan && req.socket.remoteAddress && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) {
    return jsonResponse(req, res, 403, { ok: false, error: "loopback_only" });
  }
  if (req.method === "OPTIONS") return jsonResponse(req, res, 200, { ok: true });
  if (url.pathname === "/health") return jsonResponse(req, res, 200, { ok: true, host, port, logPath, exists: existsSync(logPath) });
  if (url.pathname === "/stream") return writeSse(req, res);
  if (url.pathname === "/events") return jsonResponse(req, res, 200, { ok: true, logPath, events: filterEvents(await readEvents(), url) });
  if (url.pathname === "/dashboard" || url.pathname === "/") return writeDashboard(req, res, await readEvents());
  return jsonResponse(req, res, 404, { ok: false, error: "not_found", routes: ["/health", "/events", "/stream", "/dashboard"] });
});

server.listen(port, host, () => {
  console.log(`[agent-ui-evidence] http://${host}:${port} reading ${logPath}`);
});
