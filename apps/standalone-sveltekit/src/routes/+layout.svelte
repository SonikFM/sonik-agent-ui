<script lang="ts">
  import { onMount } from "svelte";
  import "../app.css";
  import favicon from "$lib/assets/favicon.svg";

  let { children } = $props();

  onMount(() => {
    const root = document.documentElement;
    if (!root.dataset.theme) root.dataset.theme = "gunmetal-light";
    root.dataset.colorScheme = root.dataset.theme.includes("dark") ? "dark" : "light";
    root.style.colorScheme = root.dataset.colorScheme;
    window.dispatchEvent(new CustomEvent("sonik-agent-ui:theme-change"));
  });
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>Sonik Chat</title>
</svelte:head>

{@render children()}
