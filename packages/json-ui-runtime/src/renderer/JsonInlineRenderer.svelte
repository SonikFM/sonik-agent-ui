<script lang="ts">
  import type { ComponentRegistry, Spec } from "@json-render/svelte";
  import JsonArtifactRenderer from "./JsonArtifactRenderer.svelte";

  interface Props {
    spec: Spec;
    registry: ComponentRegistry;
    loading?: boolean;
  }

  let { spec, registry, loading = false }: Props = $props();
</script>

<JsonArtifactRenderer {spec} {registry} {loading} />
