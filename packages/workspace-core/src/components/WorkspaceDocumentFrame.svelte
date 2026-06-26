<script lang="ts" module>
  export interface WorkspaceDocumentSnapshot {
    id: string;
    session_id?: string | null;
    title: string;
    language: string;
    current_content: string;
    version_count: number;
    created_at?: string;
    updated_at?: string;
  }

  export interface WorkspaceDocumentEvent {
    type: "ready" | "opened" | "active" | "changed" | "saved" | "view" | "error";
    document?: WorkspaceDocumentSnapshot;
    message?: string;
  }

  export type PreferredDocumentView = "auto" | "edit" | "preview";

  export interface WorkspaceDocumentFrameProps {
    src?: string;
    documentId?: string;
    title?: string;
    language?: string;
    content?: string;
    preferredView?: PreferredDocumentView;
    targetOrigin?: string;
    allowedOrigin?: string;
    onDocumentEvent?: (event: WorkspaceDocumentEvent) => void;
  }
</script>

<script lang="ts">
  import { onMount } from "svelte";

  let {
    src = "/workspace-document-host.html",
    documentId,
    title = "Workspace Document",
    language = "markdown",
    content = "# Workspace document editor\n\nUse the language selector to switch Markdown, HTML, JSON, code, CSV, or other render modes.",
    preferredView = "auto",
    targetOrigin,
    allowedOrigin,
    onDocumentEvent,
  }: WorkspaceDocumentFrameProps = $props();

  let frame: HTMLIFrameElement | null = $state(null);
  let status = $state<"loading" | "ready" | "opened" | "error">("loading");
  let errorMessage = $state<string | null>(null);
  let lastOpenSignature = $state<string | null>(null);

  const payload = $derived({ documentId, title, language, content, preferredView });
  const openSignature = $derived(JSON.stringify(payload));
  // The bundled workspace host is same-origin for safety. Host adapters may pass
  // explicit origins only when their iframe host enforces the matching allowlist.
  const messageTargetOrigin = $derived(targetOrigin ?? (typeof window !== "undefined" ? window.location.origin : "*"));
  const messageAllowedOrigin = $derived(allowedOrigin ?? (messageTargetOrigin === "*" ? (typeof window !== "undefined" ? window.location.origin : "") : messageTargetOrigin));

  function createThemePayload(): Record<string, string> {
    const styles = getComputedStyle(document.documentElement);
    const read = (name: string) => styles.getPropertyValue(name).trim();
    return {
      theme: document.documentElement.dataset.theme ?? "light",
      colorScheme: document.documentElement.dataset.colorScheme ?? styles.colorScheme ?? "light",
      background: read("--background") || read("--color-base-100"),
      foreground: read("--foreground") || read("--color-base-content"),
      card: read("--card") || read("--color-base-200"),
      border: read("--sonik-border-color") || read("--app-card-border") || read("--color-base-300"),
      muted: read("--muted") || read("--color-base-300"),
      mutedForeground: read("--muted-foreground"),
      accent: read("--accent") || read("--color-primary"),
      primary: read("--color-primary"),
      error: read("--color-error"),
      appPanel: read("--app-panel-bg") || read("--color-base-200"),
      appControl: read("--app-control-bg") || read("--color-base-200"),
    };
  }

  function postTheme(): void {
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage(
      {
        type: "sonik:workspace-document:theme",
        source: "sonik-agent-ui-parent",
        payload: createThemePayload(),
      },
      messageTargetOrigin,
    );
  }

  function postOpen(): void {
    if (!frame?.contentWindow) return;
    if (status !== "ready" && status !== "opened") return;
    if (openSignature === lastOpenSignature) return;
    lastOpenSignature = openSignature;
    postTheme();
    frame.contentWindow.postMessage(
      {
        type: "sonik:workspace-document:open",
        source: "sonik-agent-ui-parent",
        payload,
      },
      messageTargetOrigin,
    );
  }

  $effect(() => {
    if (status === "ready" || status === "opened") postOpen();
  });

  onMount(() => {
    function handleMessage(event: MessageEvent): void {
      if (messageAllowedOrigin && event.origin !== messageAllowedOrigin) return;
      if (event.source !== frame?.contentWindow) return;
      const message = event.data as { source?: string; type?: string; payload?: { message?: string; document?: WorkspaceDocumentSnapshot } & Partial<WorkspaceDocumentSnapshot> };
      if (message?.source !== "sonik-workspace-document-host") return;
      if (!message.type?.startsWith("sonik:workspace-document:")) return;

      const type = message.type.replace("sonik:workspace-document:", "") as WorkspaceDocumentEvent["type"];
      const document = message.payload?.document ?? coerceDocumentSnapshot(message.payload);
      onDocumentEvent?.({ type, document, message: message.payload?.message });

      if (type === "ready") {
        status = "ready";
        postTheme();
        postOpen();
      } else if (type === "opened") {
        status = "opened";
        postTheme();
        errorMessage = null;
      } else if (type === "error") {
        status = "error";
        errorMessage = message.payload?.message ?? "Workspace document editor failed to load.";
      }
    }

    function handleThemeChange(): void {
      postTheme();
    }

    window.addEventListener("message", handleMessage);
    window.addEventListener("sonik-agent-ui:theme-change", handleThemeChange);
    window.addEventListener("amplify:document-theme-change", handleThemeChange);
    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("sonik-agent-ui:theme-change", handleThemeChange);
      window.removeEventListener("amplify:document-theme-change", handleThemeChange);
    };
  });

  function coerceDocumentSnapshot(value: unknown): WorkspaceDocumentSnapshot | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (typeof record.id !== "string") return undefined;
    return {
      id: record.id,
      session_id: typeof record.session_id === "string" || record.session_id === null ? record.session_id : undefined,
      title: typeof record.title === "string" ? record.title : "Untitled",
      language: typeof record.language === "string" ? record.language : "markdown",
      current_content: typeof record.current_content === "string" ? record.current_content : "",
      version_count: typeof record.version_count === "number" ? record.version_count : 1,
      created_at: typeof record.created_at === "string" ? record.created_at : undefined,
      updated_at: typeof record.updated_at === "string" ? record.updated_at : undefined,
    };
  }
</script>

<div class="workspace-document-frame" data-status={status}>
  {#if status === "loading" || status === "ready"}
    <div class="workspace-document-frame__status">Loading workspace document editor…</div>
  {:else if status === "error"}
    <div class="workspace-document-frame__status workspace-document-frame__status--error">{errorMessage}</div>
  {/if}

  <iframe
    bind:this={frame}
    {src}
    title="Workspace document editor"
    onload={() => {
      postTheme();
      if (status === "ready" || status === "opened") postOpen();
    }}
  ></iframe>
</div>

<style>
  .workspace-document-frame {
    position: relative;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    border-radius: 0.625rem;
    background: var(--background);
  }

  iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: var(--background);
  }

  .workspace-document-frame__status {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: grid;
    place-items: center;
    background: color-mix(in oklab, var(--background) 86%, transparent);
    color: var(--foreground);
    font-size: 0.875rem;
    pointer-events: none;
  }

  .workspace-document-frame__status--error {
    color: var(--destructive);
  }

  .workspace-document-frame[data-status="opened"] .workspace-document-frame__status {
    display: none;
  }
</style>
