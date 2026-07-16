<script lang="ts">
  import "@xterm/xterm/css/xterm.css";
  import { onMount } from "svelte";
  import type { TerminalConnectionDescriptor } from "../contracts/workbench";
  import {
    createInteractiveResizeMessage,
    createInteractiveStartMessage,
    createInteractiveWebSocketUrl,
    parseInteractiveControlFrame,
  } from "./vercel-interactive";

  type TerminalState = "connecting" | "ready" | "error" | "closed";

  let {
    connection,
    cwd,
    onStateChange,
  }: {
    connection: TerminalConnectionDescriptor;
    cwd: string;
    onStateChange?: (state: TerminalState, message: string) => void;
  } = $props();

  let mount: HTMLDivElement;
  let status = $state<TerminalState>("connecting");
  let statusMessage = $state("Connecting to the isolated terminal.");

  function updateStatus(next: TerminalState, message: string): void {
    status = next;
    statusMessage = message;
    onStateChange?.(next, message);
  }

  onMount(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let terminal: import("@xterm/xterm").Terminal | null = null;
    let fitAddon: import("@xterm/addon-fit").FitAddon | null = null;
    let inputDisposable: { dispose(): void } | null = null;

    void (async () => {
      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
        ]);
        if (disposed) return;

        terminal = new Terminal({
          cursorBlink: true,
          fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
          fontSize: 13,
          scrollback: 10_000,
          theme: {
            background: "#111315",
            foreground: "#e8e6df",
            cursor: "#d6ff72",
            selectionBackground: "#435328",
          },
        });
        fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(mount);
        fitAddon.fit();

        socket = new WebSocket(createInteractiveWebSocketUrl(connection.url, connection.accessToken));
        socket.binaryType = "arraybuffer";
        socket.addEventListener("open", () => {
          if (!terminal || !socket || !fitAddon) return;
          fitAddon.fit();
          socket.send(JSON.stringify(createInteractiveStartMessage({
            command: connection.attachCommand[0],
            args: connection.attachCommand.slice(1),
            cwd,
            cols: Math.max(terminal.cols, 1),
            rows: Math.max(terminal.rows, 1),
          })));
          updateStatus("ready", "Connected to the sandbox tmux session.");
        });
        socket.addEventListener("message", (event) => {
          if (!terminal) return;
          if (typeof event.data === "string") {
            const control = parseInteractiveControlFrame(event.data);
            if (control) {
              updateStatus("closed", control.code === null
                ? "The terminal session ended."
                : `The terminal session ended with code ${control.code}.`);
            }
            return;
          }
          if (event.data instanceof ArrayBuffer) terminal.write(new Uint8Array(event.data));
          else if (event.data instanceof Blob) void event.data.arrayBuffer().then((buffer) => terminal?.write(new Uint8Array(buffer)));
        });
        socket.addEventListener("error", () => updateStatus("error", "The terminal connection failed."));
        socket.addEventListener("close", () => {
          if (status !== "error" && status !== "closed") updateStatus("closed", "The terminal connection closed.");
        });

        inputDisposable = terminal.onData((value) => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(value));
        });
        resizeObserver = new ResizeObserver(() => {
          if (!terminal || !fitAddon) return;
          fitAddon.fit();
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(createInteractiveResizeMessage(
              Math.max(terminal.cols, 1),
              Math.max(terminal.rows, 1),
            )));
          }
        });
        resizeObserver.observe(mount);

        if (disposed) inputDisposable.dispose();
      } catch {
        updateStatus("error", "The terminal renderer could not start.");
      }
    })();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      inputDisposable?.dispose();
      socket?.close();
      terminal?.dispose();
    };
  });
</script>

<div class="terminal-host" data-state={status}>
  <div class="terminal-host__mount" bind:this={mount} role="region" aria-label="Interactive Codex terminal"></div>
  <p class="sr-only" aria-live="polite">{statusMessage}</p>
</div>

<style>
  .terminal-host,
  .terminal-host__mount {
    width: 100%;
    height: 100%;
    min-height: 24rem;
  }

  .terminal-host {
    padding: 0.75rem;
    overflow: hidden;
    background: #111315;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
