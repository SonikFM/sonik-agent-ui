<script lang="ts">
  import type { AgentUiDeploymentSnapshot, AgentUiTurnCorrelationSnapshot } from "@sonik-agent-ui/agent-observability";

  let {
    correlation,
    deployment,
    activeSessionId,
    exportStatus = null,
    busy = false,
    transcriptDisabledReason = undefined,
    onExportChat,
    onExportDiagnostics,
  }: {
    correlation?: AgentUiTurnCorrelationSnapshot;
    deployment?: AgentUiDeploymentSnapshot;
    activeSessionId?: string | null;
    exportStatus?: string | null;
    busy?: boolean;
    transcriptDisabledReason?: string;
    onExportChat: () => void | Promise<void>;
    onExportDiagnostics: () => void | Promise<void>;
  } = $props();

  const missing = "Not available yet";
  const chatDisabled = $derived(Boolean(transcriptDisabledReason || busy));
  const diagnosticsDisabled = $derived(Boolean(!activeSessionId || busy));
</script>

<details class="support-menu">
  <summary class="support-menu__summary" aria-label="Open support diagnostics menu">
    Support
  </summary>
  <div class="support-menu__panel" role="group" aria-label="Support diagnostics">
    <dl class="support-menu__facts">
      <div><dt>Session</dt><dd>{activeSessionId ?? missing}</dd></div>
      <div><dt>Request</dt><dd>{correlation?.requestId ?? missing}</dd></div>
      <div><dt>Trace</dt><dd>{correlation?.traceId ?? correlation?.traceparent ?? missing}</dd></div>
      <div><dt>Run</dt><dd>{correlation?.agentUiRunId ?? missing}</dd></div>
      <div><dt>Deployment</dt><dd>{deployment?.id ?? deployment?.tag ?? deployment?.timestamp ?? missing}</dd></div>
    </dl>
    <div class="support-menu__actions">
      <button type="button" onclick={() => void onExportChat()} disabled={chatDisabled} aria-describedby="support-export-status">
        Export chat
      </button>
      <button type="button" onclick={() => void onExportDiagnostics()} disabled={diagnosticsDisabled} aria-describedby="support-export-status">
        Export diagnostics
      </button>
    </div>
    <p id="support-export-status" class="support-menu__status" aria-live="polite">
      {exportStatus ?? (transcriptDisabledReason === "empty_transcript" ? "No visible transcript yet." : "Safe support IDs only; no raw headers.")}
    </p>
  </div>
</details>

<style>
  .support-menu {
    position: relative;
    display: inline-block;
  }

  .support-menu__summary {
    list-style: none;
    cursor: pointer;
    border-radius: 999px;
    padding: 0.375rem 0.75rem;
    color: var(--muted-foreground);
    font-size: 0.875rem;
    transition: color 0.15s ease, background-color 0.15s ease;
  }

  .support-menu__summary::-webkit-details-marker {
    display: none;
  }

  .support-menu__summary:hover,
  .support-menu__summary:focus-visible {
    color: var(--foreground);
    background: var(--accent);
    outline: none;
  }

  .support-menu__summary:focus-visible,
  .support-menu__actions button:focus-visible {
    box-shadow: 0 0 0 2px var(--ring);
  }

  .support-menu__panel {
    position: absolute;
    right: 0;
    z-index: 20;
    margin-top: 0.5rem;
    width: min(20rem, calc(100vw - 2rem));
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    background: var(--popover, var(--background));
    color: var(--popover-foreground, var(--foreground));
    box-shadow: 0 16px 40px rgb(0 0 0 / 0.18);
    padding: 0.75rem;
  }

  .support-menu__facts {
    display: grid;
    gap: 0.5rem;
    margin: 0;
    font-size: 0.75rem;
  }

  .support-menu__facts div {
    display: grid;
    grid-template-columns: 5.25rem minmax(0, 1fr);
    gap: 0.5rem;
  }

  .support-menu__facts dt {
    color: var(--muted-foreground);
  }

  .support-menu__facts dd {
    margin: 0;
    overflow-wrap: anywhere;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .support-menu__actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
    flex-wrap: wrap;
  }

  .support-menu__actions button {
    border-radius: 999px;
    border: 1px solid var(--border);
    padding: 0.35rem 0.65rem;
    font-size: 0.75rem;
  }

  .support-menu__actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .support-menu__status {
    margin: 0.625rem 0 0;
    color: var(--muted-foreground);
    font-size: 0.75rem;
  }
</style>
