<script lang="ts">
  import { onMount, tick } from "svelte";
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

  let detailsElement: HTMLDetailsElement | null = $state(null);
  let summaryElement: HTMLElement | null = $state(null);
  let panelElement: HTMLDivElement | null = $state(null);
  let panelLeft = $state(0);
  let panelTop = $state(0);
  let panelMaxWidth: number | null = $state(null);
  let panelMaxHeight: number | null = $state(null);
  let panelPlacement = $state<"below" | "above" | "viewport">("below");
  const panelStyle = $derived(
    panelMaxWidth === null || panelMaxHeight === null
      ? ""
      : `left:${panelLeft}px;top:${panelTop}px;max-width:${panelMaxWidth}px;max-height:${panelMaxHeight}px`,
  );

  const VIEWPORT_GUTTER = 16;
  const PANEL_GAP = 8;

  async function clampPanelToViewport(): Promise<void> {
    if (!detailsElement?.open) return;
    await tick();
    if (!summaryElement || !panelElement) return;

    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const maxWidth = Math.max(1, viewportWidth - VIEWPORT_GUTTER * 2);
    const maxHeight = Math.max(1, viewportHeight - VIEWPORT_GUTTER * 2);
    panelMaxWidth = maxWidth;
    panelMaxHeight = maxHeight;
    await tick();

    const triggerRect = summaryElement.getBoundingClientRect();
    const panelRect = panelElement.getBoundingClientRect();
    const panelWidth = Math.min(panelRect.width, maxWidth);
    const panelHeight = Math.min(panelRect.height, maxHeight);

    const left = Math.min(
      Math.max(triggerRect.right - panelWidth, viewportLeft + VIEWPORT_GUTTER),
      viewportRight - VIEWPORT_GUTTER - panelWidth,
    );
    const belowTop = triggerRect.bottom + PANEL_GAP;
    const aboveTop = triggerRect.top - PANEL_GAP - panelHeight;
    let top = viewportTop + VIEWPORT_GUTTER;
    panelPlacement = "viewport";
    if (belowTop + panelHeight <= viewportBottom - VIEWPORT_GUTTER) {
      top = belowTop;
      panelPlacement = "below";
    } else if (aboveTop >= viewportTop + VIEWPORT_GUTTER) {
      top = aboveTop;
      panelPlacement = "above";
    }

    panelLeft = left;
    panelTop = top;
  }

  function handleToggle(): void {
    if (detailsElement?.open) void clampPanelToViewport();
  }

  function handleMenuKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !detailsElement?.open) return;
    event.preventDefault();
    detailsElement.open = false;
    summaryElement?.focus();
  }

  onMount(() => {
    const handleViewportChange = () => void clampPanelToViewport();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("keydown", handleMenuKeydown);
    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("scroll", handleViewportChange);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("keydown", handleMenuKeydown);
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("scroll", handleViewportChange);
    };
  });
</script>

<details bind:this={detailsElement} class="support-menu" ontoggle={handleToggle}>
  <summary bind:this={summaryElement} class="support-menu__summary" aria-label="Open support diagnostics menu">
    Support
  </summary>
  <div
    bind:this={panelElement}
    class="support-menu__panel"
    role="group"
    aria-label="Support diagnostics"
    data-support-menu-panel
    data-placement={panelPlacement}
    style={panelStyle}
  >
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
    position: fixed;
    z-index: 20;
    width: min(20rem, calc(100vw - 2rem));
    max-height: calc(100dvh - 2rem);
    overflow-y: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--sonik-border-color);
    border-radius: 0.875rem;
    background: var(--popover, var(--background));
    color: var(--popover-foreground, var(--foreground));
    box-shadow: var(--app-card-shadow-elevated);
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
    border: 1px solid var(--sonik-border-color);
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
