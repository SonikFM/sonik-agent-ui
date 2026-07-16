<script lang="ts">
  import type { Snippet } from "svelte";
  import "./DevWorkbench.css";
  import type { DevWorkbenchCallbacks } from "./actions";
  import type { DevWorkbenchViewProps, WorkbenchDetail } from "./schema";

  type Props = DevWorkbenchViewProps & DevWorkbenchCallbacks & {
    /** Host-owned xterm mount. The renderer never receives the PTY token. */
    terminalContent?: Snippet;
  };

  let {
    title,
    repository,
    workspace,
    preview,
    terminal,
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
    onOpenPreview,
    onStopWorkspace,
    onDetailChange,
    terminalContent,
  }: Props = $props();

  const revisionLabel = $derived(repository.revision.length > 12 ? repository.revision.slice(0, 12) : repository.revision);

  const detailTabs = $derived([
    { id: "problems" as const, label: "Problems", count: problems.length },
    { id: "changes" as const, label: "Changed files", count: changedFiles.length },
    { id: "console" as const, label: "Console", count: consoleEntries.length },
    { id: "network" as const, label: "Network", count: failedRequests.length },
  ]);
  const disabledReasons = $derived(
    [...new Set(Object.values(actions).flatMap((action) => action.disabledReason ? [action.disabledReason] : []))],
  );

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

<main class="dev-workbench" aria-labelledby="dev-workbench-title">
  <header class="dev-workbench__toolbar">
    <div class="dev-workbench__identity">
      <p class="dev-workbench__eyebrow">Developer workspace</p>
      <h1 id="dev-workbench-title">{title}</h1>
    </div>

    <div class="dev-workbench__meta" aria-label="Repository context">
      <span>{repository.name}</span>
      <span>{repository.branch}</span>
      <span>{revisionLabel}</span>
      {#if repository.dirty}<span>Uncommitted changes</span>{/if}
    </div>

    <div class="dev-workbench__status" data-status={workspace.status} aria-live="polite">
      <span class="dev-workbench__status-dot" aria-hidden="true"></span>
      <span><strong>{workspace.label}</strong> · {workspace.message}</span>
    </div>

    <div class="dev-workbench__actions" aria-label="Workspace controls">
      <button
        class="dev-workbench__button dev-workbench__button--primary"
        type="button"
        disabled={!actions.startWorkspace.enabled}
        aria-describedby={!actions.startWorkspace.enabled ? "workbench-action-readiness" : undefined}
        title={actions.startWorkspace.disabledReason ?? "Start isolated development workspace"}
        onclick={() => onStartWorkspace?.()}
      >
        Start workspace
      </button>
      <button
        class="dev-workbench__button"
        type="button"
        disabled={!actions.captureSnapshot.enabled}
        aria-describedby={!actions.captureSnapshot.enabled ? "workbench-action-readiness" : undefined}
        title={actions.captureSnapshot.disabledReason ?? "Synchronize sanitized page context"}
        onclick={() => onCaptureSnapshot?.()}
      >
        Sync page context
      </button>
      <button
        class="dev-workbench__button"
        type="button"
        disabled={!actions.openPreview.enabled}
        aria-describedby={!actions.openPreview.enabled ? "workbench-action-readiness" : undefined}
        title={actions.openPreview.disabledReason ?? "Open preview in a new tab"}
        onclick={() => onOpenPreview?.()}
      >
        Open preview
      </button>
      <button
        class="dev-workbench__button"
        type="button"
        disabled={!actions.stopWorkspace.enabled}
        aria-describedby={!actions.stopWorkspace.enabled ? "workbench-action-readiness" : undefined}
        title={actions.stopWorkspace.disabledReason ?? "Stop workspace"}
        onclick={() => onStopWorkspace?.()}
      >
        Stop workspace
      </button>
    </div>

    {#if disabledReasons.length}
      <p class="dev-workbench__readiness" id="workbench-action-readiness">
        <strong>Unavailable controls:</strong> {disabledReasons.join(" ")}
      </p>
    {/if}
  </header>

  <div class="dev-workbench__split">
    <section class="dev-workbench__panel" aria-labelledby="preview-heading">
      <header class="dev-workbench__panel-header">
        <div>
          <h2 id="preview-heading">Live preview</h2>
          <p class="dev-workbench__meta">{preview.path} · {preview.viewportLabel}</p>
        </div>
        <div class="dev-workbench__status" data-status={preview.status}>
          <span class="dev-workbench__status-dot" aria-hidden="true"></span>
          <span>{preview.status}</span>
        </div>
        <button
          class="dev-workbench__button"
          type="button"
          disabled={!actions.restartPreview.enabled}
          aria-describedby={!actions.restartPreview.enabled ? "workbench-action-readiness" : undefined}
          title={actions.restartPreview.disabledReason ?? "Restart development preview"}
          onclick={() => onRestartPreview?.()}
        >
          Restart preview
        </button>
      </header>

      <div class="dev-workbench__panel-body">
        {#if preview.status === "ready" && preview.url}
          <iframe
            class="dev-workbench__preview-frame"
            src={preview.url}
            title="Live development preview"
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

    <section class="dev-workbench__panel" aria-labelledby="terminal-heading">
      <header class="dev-workbench__panel-header">
        <div>
          <h2 id="terminal-heading">Codex terminal</h2>
          <p class="dev-workbench__meta">{terminal.transport}</p>
        </div>
        <div class="dev-workbench__status" data-status={terminal.status} aria-live="polite">
          <span class="dev-workbench__status-dot" aria-hidden="true"></span>
          <span>{terminal.status}</span>
        </div>
        <button
          class="dev-workbench__button"
          type="button"
          disabled={!actions.reconnectTerminal.enabled}
          aria-describedby={!actions.reconnectTerminal.enabled ? "workbench-action-readiness" : undefined}
          title={actions.reconnectTerminal.disabledReason ?? "Reconnect to tmux session"}
          onclick={() => onReconnectTerminal?.()}
        >
          Reconnect terminal
        </button>
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
