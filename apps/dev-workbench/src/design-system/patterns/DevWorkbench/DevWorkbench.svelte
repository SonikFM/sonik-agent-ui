<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import "./DevWorkbench.css";
  import type { DevWorkbenchCallbacks } from "./actions";
  import {
    DEFAULT_TERMINAL_LAYOUT,
    DEFAULT_TERMINAL_SIZE,
    MAX_TERMINAL_SIZE,
    MIN_TERMINAL_SIZE,
    TERMINAL_LAYOUT_STORAGE_KEY,
    clampTerminalSize,
    parseTerminalLayoutPreference,
    serializeTerminalLayoutPreference,
    type TerminalDock,
  } from "./layout-preference";
  import type { DevWorkbenchViewProps, WorkbenchDetail } from "./schema";

  type Props = DevWorkbenchViewProps & DevWorkbenchCallbacks & {
    /** Host-owned xterm mount. The renderer never receives the PTY token. */
    terminalContent?: Snippet;
    /** Compact embed surface used when Dev Mode replaces an Agent UI chat rail. */
    terminalOnly?: boolean;
  };

  let {
    title,
    repository,
    workspace,
    preview,
    terminal,
    visualContext,
    activeDetail,
    problems,
    changedFiles,
    consoleEntries,
    failedRequests,
    actions,
    onStartWorkspace,
    onReconnectTerminal,
    onRestartPreview,
    onCaptureSnapshot,
    onVisualSourceChange,
    onPickVisualTarget,
    onCaptureVisualContext,
    onSetupVisualBrowser,
    onPairVisualExtension,
    onOpenPreview,
    onStopWorkspace,
    onDetailChange,
    terminalContent,
    terminalOnly = false,
  }: Props = $props();

  let splitElement: HTMLDivElement;
  let terminalDock = $state<TerminalDock>(DEFAULT_TERMINAL_LAYOUT.dock);
  let terminalSize = $state(DEFAULT_TERMINAL_LAYOUT.size);
  let narrowViewport = $state(false);
  let resizing = $state(false);

  const revisionLabel = $derived(repository.revision.length > 12 ? repository.revision.slice(0, 12) : repository.revision);
  const effectiveDock = $derived<TerminalDock>(
    terminalOnly || terminalDock === "fullscreen" ? "fullscreen" : narrowViewport ? "bottom" : terminalDock,
  );
  const terminalSizePercent = $derived(Math.round(terminalSize * 100));
  const splitStyle = $derived(`--dw-terminal-size: ${terminalSizePercent}%;`);
  const previewTitle = "Live development preview";
  const detailTabs = $derived([
    { id: "problems" as const, label: "Problems", count: problems.length },
    { id: "changes" as const, label: "Changed files", count: changedFiles.length },
    { id: "console" as const, label: "Console", count: consoleEntries.length },
    { id: "network" as const, label: "Network", count: failedRequests.length },
  ]);
  const disabledReasons = $derived(
    [...new Set(Object.values(actions).flatMap((action) => action.disabledReason ? [action.disabledReason] : []))],
  );

  onMount(() => {
    let preference = DEFAULT_TERMINAL_LAYOUT;
    try {
      preference = parseTerminalLayoutPreference(window.localStorage.getItem(TERMINAL_LAYOUT_STORAGE_KEY));
    } catch {
      // Browsers can deny storage access while still allowing the workbench to run.
    }
    terminalDock = preference.dock;
    terminalSize = preference.size;

    const media = window.matchMedia("(max-width: 760px)");
    const updateViewport = () => (narrowViewport = media.matches);
    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  });

  function persistLayout(): void {
    try {
      window.localStorage.setItem(
        TERMINAL_LAYOUT_STORAGE_KEY,
        serializeTerminalLayoutPreference({ dock: terminalDock, size: terminalSize }),
      );
    } catch {
      // The layout remains usable when storage is unavailable or blocked.
    }
  }

  function setTerminalDock(dock: TerminalDock): void {
    terminalDock = dock;
    persistLayout();
  }

  function updateTerminalSize(clientX: number, clientY: number): void {
    const rect = splitElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    terminalSize = clampTerminalSize(
      effectiveDock === "right"
        ? (rect.right - clientX) / rect.width
        : (rect.bottom - clientY) / rect.height,
    );
  }

  function startResize(event: PointerEvent): void {
    if (effectiveDock === "fullscreen") return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    resizing = true;
    updateTerminalSize(event.clientX, event.clientY);
  }

  function moveResize(event: PointerEvent): void {
    if (!resizing) return;
    updateTerminalSize(event.clientX, event.clientY);
  }

  function endResize(event: PointerEvent): void {
    if (!resizing) return;
    resizing = false;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    persistLayout();
  }

  function resizeWithKeyboard(event: KeyboardEvent): void {
    if (effectiveDock === "fullscreen") return;
    const largerKey = effectiveDock === "right" ? "ArrowLeft" : "ArrowUp";
    const smallerKey = effectiveDock === "right" ? "ArrowRight" : "ArrowDown";
    if (![largerKey, smallerKey, "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    terminalSize = event.key === "Home"
      ? MIN_TERMINAL_SIZE
      : event.key === "End"
        ? MAX_TERMINAL_SIZE
        : event.key === "Escape"
          ? DEFAULT_TERMINAL_SIZE
          : clampTerminalSize(terminalSize + (event.key === largerKey ? 0.02 : -0.02));
    persistLayout();
  }

  function resetTerminalSize(): void {
    terminalSize = DEFAULT_TERMINAL_SIZE;
    persistLayout();
  }

  function runMenuAction(event: MouseEvent, action: (() => unknown) | undefined): void {
    action?.();
    const menu = (event.currentTarget as HTMLElement).closest("details");
    if (menu instanceof HTMLDetailsElement) menu.open = false;
  }

  function selectDetail(detail: WorkbenchDetail): void {
    onDetailChange?.(detail);
  }

  function navigateDetailTabs(event: KeyboardEvent): void {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabList = (event.currentTarget as HTMLElement).parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    const tabs = [...(tabList ?? [])];
    const current = tabs.indexOf(event.currentTarget as HTMLButtonElement);
    if (current < 0 || tabs.length === 0) return;
    event.preventDefault();
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next]?.focus();
    tabs[next]?.click();
  }
</script>

<main
  class="dev-workbench"
  data-terminal-dock={effectiveDock}
  data-terminal-only={terminalOnly}
  data-resizing={resizing}
  aria-labelledby={terminalOnly ? undefined : "dev-workbench-title"}
  aria-label={terminalOnly ? title : undefined}
>
  <header class="dev-workbench__toolbar">
    <div class="dev-workbench__identity">
      <h1 id="dev-workbench-title">{title}</h1>
      <div class="dev-workbench__meta" aria-label="Repository context">
        <span>{repository.name}</span>
        <span>{repository.branch}</span>
        <span>{revisionLabel}</span>
        {#if repository.dirty}<span>Uncommitted changes</span>{/if}
      </div>
    </div>

    <div class="dev-workbench__status" data-status={workspace.status} aria-live="polite">
      <span class="dev-workbench__status-dot" aria-hidden="true"></span>
      <span class="dev-workbench__status-copy"><strong>{workspace.label}</strong><span>{workspace.message}</span></span>
    </div>

    <div class="dev-workbench__actions" aria-label="Workspace controls">
      <label class="dev-workbench__source-control">
        <span>Source</span>
        <select
          aria-label="Visual context source"
          value={visualContext.selectedSourceId ?? ""}
          disabled={!visualContext.sources.length}
          onchange={(event) => onVisualSourceChange?.((event.currentTarget as HTMLSelectElement).value as "preview" | "host")}
        >
          {#if !visualContext.sources.length}<option value="">No source</option>{/if}
          {#each visualContext.sources as source (source.id)}
            <option value={source.id}>{source.label}</option>
          {/each}
        </select>
      </label>
      <button
        class="dev-workbench__button dev-workbench__button--compact"
        type="button"
        disabled={!actions.pickVisualTarget.enabled}
        title={actions.pickVisualTarget.disabledReason ?? "Pick an element"}
        onclick={() => onPickVisualTarget?.()}
      >Pick</button>
      <button
        class="dev-workbench__button dev-workbench__button--compact"
        type="button"
        disabled={!actions.captureVisualContext.enabled}
        aria-describedby={!actions.captureVisualContext.enabled ? "workbench-action-readiness" : undefined}
        title={actions.captureVisualContext.disabledReason ?? "Capture visual context"}
        onclick={() => onCaptureVisualContext?.()}
      >Capture</button>
      <button
        class="dev-workbench__button dev-workbench__button--primary"
        type="button"
        disabled={!actions.startWorkspace.enabled}
        aria-describedby={!actions.startWorkspace.enabled ? "workbench-action-readiness" : undefined}
        onclick={() => onStartWorkspace?.()}
      >
        Start workspace
      </button>

      <details class="dev-workbench__overflow">
        <summary class="dev-workbench__button">More</summary>
        <div class="dev-workbench__overflow-menu" aria-label="More workspace actions">
          <button
            type="button"
            disabled={!actions.setupVisualBrowser.enabled}
            aria-describedby={!actions.setupVisualBrowser.enabled ? "workbench-action-readiness" : undefined}
            title={actions.setupVisualBrowser.disabledReason ?? "Set up controlled browser capture"}
            onclick={(event) => runMenuAction(event, onSetupVisualBrowser)}
          >
            Set up browser capture
          </button>
          <button
            type="button"
            disabled={!actions.pairVisualExtension.enabled}
            title={actions.pairVisualExtension.disabledReason ?? "Pair active-tab extension"}
            onclick={(event) => runMenuAction(event, onPairVisualExtension)}
          >
            Pair active-tab extension
          </button>
          <button
            type="button"
            disabled={!actions.captureSnapshot.enabled}
            aria-describedby={!actions.captureSnapshot.enabled ? "workbench-action-readiness" : undefined}
            onclick={(event) => runMenuAction(event, onCaptureSnapshot)}
          >
            Sync page context
          </button>
          <button
            type="button"
            disabled={!actions.openPreview.enabled}
            aria-describedby={!actions.openPreview.enabled ? "workbench-action-readiness" : undefined}
            onclick={(event) => runMenuAction(event, onOpenPreview)}
          >
            Open preview
          </button>
          <button
            class="dev-workbench__danger-action"
            type="button"
            disabled={!actions.stopWorkspace.enabled}
            aria-describedby={!actions.stopWorkspace.enabled ? "workbench-action-readiness" : undefined}
            onclick={(event) => runMenuAction(event, onStopWorkspace)}
          >
            Stop workspace
          </button>
        </div>
      </details>
    </div>

    {#if disabledReasons.length}
      <details class="dev-workbench__readiness" id="workbench-action-readiness">
        <summary>{disabledReasons.length} {disabledReasons.length === 1 ? "control" : "controls"} unavailable</summary>
        <ul>
          {#each disabledReasons as reason (reason)}<li>{reason}</li>{/each}
        </ul>
      </details>
    {/if}
    <span class="dev-workbench__visual-status" aria-hidden="true">
      {visualContext.statusMessage}
    </span>
  </header>

  <div
    bind:this={splitElement}
    class="dev-workbench__split"
    data-terminal-dock={effectiveDock}
    data-resizing={resizing}
    style={splitStyle}
  >
    <section class="dev-workbench__panel dev-workbench__panel--preview" aria-labelledby="preview-heading">
      <header class="dev-workbench__panel-header">
        <div class="dev-workbench__panel-title">
          <h2 id="preview-heading">Preview</h2>
          <p class="dev-workbench__meta" id="preview-context">{preview.path} · {preview.viewportLabel}</p>
        </div>
        <div class="dev-workbench__panel-tools">
          <div class="dev-workbench__status" data-status={preview.status}>
            <span class="dev-workbench__status-dot" aria-hidden="true"></span>
            <span>{preview.status}</span>
          </div>
          <button
            class="dev-workbench__button dev-workbench__button--compact"
            type="button"
            disabled={!actions.restartPreview.enabled}
            aria-describedby={!actions.restartPreview.enabled ? "workbench-action-readiness" : undefined}
            onclick={() => onRestartPreview?.()}
          >
            Restart
          </button>
        </div>
      </header>

      <div class="dev-workbench__panel-body">
        {#if preview.status === "ready" && preview.url}
          <iframe
            class="dev-workbench__preview-frame"
            src={preview.url}
            title={previewTitle}
            aria-describedby="preview-context"
            sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
            referrerpolicy="no-referrer"
          ></iframe>
        {:else}
          <div class="dev-workbench__empty" role="status">
            <strong>Preview unavailable</strong>
            <p>{preview.disabledReason ?? "The development server has not published a preview URL."}</p>
          </div>
        {/if}
      </div>
    </section>

    {#if effectiveDock !== "fullscreen"}
      <!-- WAI-ARIA window splitter: focusable separator with pointer and keyboard operation. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="dev-workbench__divider"
        role="separator"
        aria-label={`Resize ${effectiveDock}-docked terminal. Arrow keys adjust; Escape or double-click resets.`}
        aria-orientation={effectiveDock === "right" ? "vertical" : "horizontal"}
        aria-valuemin={Math.round(MIN_TERMINAL_SIZE * 100)}
        aria-valuemax={Math.round(MAX_TERMINAL_SIZE * 100)}
        aria-valuenow={terminalSizePercent}
        aria-valuetext={`Terminal uses ${terminalSizePercent} percent of the work area`}
        tabindex="0"
        onpointerdown={startResize}
        onpointermove={moveResize}
        onpointerup={endResize}
        onpointercancel={endResize}
        onkeydown={resizeWithKeyboard}
        ondblclick={resetTerminalSize}
      ></div>
    {/if}

    <section class="dev-workbench__panel dev-workbench__panel--terminal" aria-labelledby="terminal-heading">
      <header class="dev-workbench__panel-header">
        <div class="dev-workbench__panel-title">
          <h2 id="terminal-heading">Codex</h2>
          <p class="dev-workbench__meta">{terminal.transport}</p>
        </div>

        <div class="dev-workbench__panel-tools">
          <div class="dev-workbench__status" data-status={terminal.status} aria-live="polite">
            <span class="dev-workbench__status-dot" aria-hidden="true"></span>
            <span>{terminal.status}</span>
          </div>

          <div class="dev-workbench__dock-controls" role="group" aria-label="Terminal position">
            <button
              type="button"
              aria-pressed={effectiveDock === "right"}
              aria-describedby={narrowViewport ? "terminal-dock-narrow-reason" : undefined}
              disabled={narrowViewport}
              onclick={() => setTerminalDock("right")}
            >Right</button>
            <button
              type="button"
              aria-pressed={effectiveDock === "bottom"}
              onclick={() => setTerminalDock("bottom")}
            >Bottom</button>
            <button
              type="button"
              aria-pressed={effectiveDock === "fullscreen"}
              onclick={() => setTerminalDock("fullscreen")}
            >Full screen</button>
          </div>
          {#if narrowViewport}
            <span class="dev-workbench__sr-only" id="terminal-dock-narrow-reason">Right dock requires a wider viewport.</span>
          {/if}

          <button
            class="dev-workbench__button dev-workbench__button--compact"
            type="button"
            disabled={!actions.reconnectTerminal.enabled}
            aria-describedby={!actions.reconnectTerminal.enabled ? "workbench-action-readiness" : undefined}
            onclick={() => onReconnectTerminal?.()}
          >
            Reconnect
          </button>
        </div>
      </header>

      <div class="dev-workbench__panel-body">
        {#if terminalContent}
          {@render terminalContent()}
        {:else}
          <div class="dev-workbench__terminal" role="log" aria-label="Codex terminal output" aria-live="polite">
            <pre class="dev-workbench__terminal-command">$ cd {terminal.cwd}
$ tmux attach -t {terminal.sessionName}</pre>
            <p class="dev-workbench__terminal-note">
              {terminal.disabledReason ?? "The authenticated PTY is ready for the xterm renderer."}
            </p>
            {#if terminalOnly && actions.startWorkspace.enabled}
              <button
                class="dev-workbench__button dev-workbench__button--primary"
                type="button"
                onclick={() => onStartWorkspace?.()}
              >Start workspace</button>
            {/if}
          </div>
        {/if}
      </div>
    </section>
  </div>

  <section class="dev-workbench__details" aria-label="Workspace diagnostics">
    <div class="dev-workbench__details-nav" role="tablist" aria-label="Workspace diagnostics views">
      {#each detailTabs as tab (tab.id)}
        <button
          class="dev-workbench__tab"
          type="button"
          role="tab"
          id={`workbench-tab-${tab.id}`}
          aria-selected={activeDetail === tab.id}
          aria-controls="workbench-detail-panel"
          tabindex={activeDetail === tab.id ? 0 : -1}
          onclick={() => selectDetail(tab.id)}
          onkeydown={navigateDetailTabs}
        >
          {tab.label} <span class="dev-workbench__count">{tab.count}</span>
        </button>
      {/each}
    </div>

    <div
      class="dev-workbench__detail-panel"
      id="workbench-detail-panel"
      role="tabpanel"
      aria-labelledby={`workbench-tab-${activeDetail}`}
      tabindex="0"
    >
      {#if activeDetail === "problems"}
        {#if problems.length}
          <ul class="dev-workbench__detail-list">
            {#each problems as problem (problem.id)}
              <li class="dev-workbench__detail-row">
                <strong class="dev-workbench__problem" data-severity={problem.severity}>{problem.severity}</strong>
                <span>{problem.message}{#if problem.file} · {problem.file}{#if problem.line}:{problem.line}{/if}{/if}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="dev-workbench__detail-empty">No reported problems.</p>
        {/if}
      {:else if activeDetail === "changes"}
        {#if changedFiles.length}
          <ul class="dev-workbench__detail-list">
            {#each changedFiles as file (file.path)}
              <li class="dev-workbench__detail-row">
                <strong class="dev-workbench__file-status">{file.status}</strong>
                <span>{file.path}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="dev-workbench__detail-empty">The checkout has no reported changes.</p>
        {/if}
      {:else if activeDetail === "console"}
        {#if consoleEntries.length}
          <ul class="dev-workbench__detail-list">
            {#each consoleEntries as entry, index (`${index}:${entry}`)}
              <li class="dev-workbench__detail-row"><span>{entry}</span></li>
            {/each}
          </ul>
        {:else}
          <p class="dev-workbench__detail-empty">No browser console events.</p>
        {/if}
      {:else}
        {#if failedRequests.length}
          <ul class="dev-workbench__detail-list">
            {#each failedRequests as request, index (`${index}:${request}`)}
              <li class="dev-workbench__detail-row"><span>{request}</span></li>
            {/each}
          </ul>
        {:else}
          <p class="dev-workbench__detail-empty">No failed network requests.</p>
        {/if}
      {/if}
    </div>
  </section>
</main>
