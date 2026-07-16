<script lang="ts">
  import "../app.css";

  let { children } = $props();
</script>

<svelte:head>
  <title>Sonik Dev Workbench</title>
  <meta
    name="description"
    content="A repository-aware Sonik development workbench with an isolated Vercel Sandbox terminal and live preview."
  />
</svelte:head>

{@render children()}
