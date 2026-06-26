<script lang="ts">
  import { onMount } from "svelte";
  import "../app.css";
  import { initializeTheme } from "$lib/theme/theme-runtime";
  import { logArtifactTelemetry } from "$lib/artifacts/artifact-telemetry";
  import favicon from "$lib/assets/favicon.svg";

  let { children } = $props();

  onMount(() => {
    initializeTheme();

    const handleError = (event: ErrorEvent) => {
      logArtifactTelemetry({
        source: "client",
        event: "client.runtime.error",
        ok: false,
        error: summarizeRuntimeError(event.error ?? event.message),
        reason: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : "window.error",
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      logArtifactTelemetry({
        source: "client",
        event: "client.runtime.unhandledrejection",
        ok: false,
        error: summarizeRuntimeError(event.reason),
        reason: "window.unhandledrejection",
      });
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  });

  const RUNTIME_ERROR_MAX_CHARS = 1_500;

  function summarizeRuntimeError(value: unknown): string {
    const summary = value instanceof Error
      ? `${value.name}: ${value.message}${value.stack ? `
${value.stack}` : ""}`
      : typeof value === "string"
        ? value
        : stringifyRuntimeError(value);
    return summary.length > RUNTIME_ERROR_MAX_CHARS ? `${summary.slice(0, RUNTIME_ERROR_MAX_CHARS)}…` : summary;
  }

  function stringifyRuntimeError(value: unknown): string {
    try {
      const json = JSON.stringify(value);
      return typeof json === "string" ? json : String(value);
    } catch {
      return String(value);
    }
  }
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>Sonik Chat</title>
</svelte:head>

{@render children()}
