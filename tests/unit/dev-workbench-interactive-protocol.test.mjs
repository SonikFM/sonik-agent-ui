import assert from "node:assert/strict";
import test from "node:test";

import {
  createInteractiveResizeMessage,
  createInteractiveStartMessage,
  createInteractiveWebSocketUrl,
  parseInteractiveControlFrame,
} from "../../apps/dev-workbench/src/lib/client/vercel-interactive.ts";

test("builds the official Vercel interactive PTY start frame", () => {
  assert.deepEqual(
    createInteractiveStartMessage({
      command: "tmux",
      args: ["attach-session", "-t", "sonik-demo"],
      cwd: "/vercel/sandbox/workspace/repo",
      cols: 120,
      rows: 36,
    }),
    {
      type: "start",
      command: "tmux",
      args: ["attach-session", "-t", "sonik-demo"],
      env: ["TERM=xterm-256color"],
      cwd: "/vercel/sandbox/workspace/repo",
      cols: 120,
      rows: 36,
    },
  );
});

test("adds the short-lived PTY token without discarding existing parameters", () => {
  assert.equal(
    createInteractiveWebSocketUrl("wss://controller.vercel.run/pty?session=one", "a token"),
    "wss://controller.vercel.run/pty?session=one&token=a+token",
  );
  assert.throws(
    () => createInteractiveWebSocketUrl("ws://controller.vercel.run/pty", "token"),
    /require WSS/,
  );
});

test("validates terminal dimensions and parses exit frames", () => {
  assert.deepEqual(createInteractiveResizeMessage(80, 24), { type: "resize", cols: 80, rows: 24 });
  assert.throws(() => createInteractiveResizeMessage(0, 24), /cols must be a positive integer/);
  assert.deepEqual(parseInteractiveControlFrame('{"type":"exit","code":0}'), { type: "exit", code: 0 });
  assert.equal(parseInteractiveControlFrame("terminal output"), null);
});
