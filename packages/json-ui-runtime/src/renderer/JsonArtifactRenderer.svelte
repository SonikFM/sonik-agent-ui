<script lang="ts">
  import { JsonUIProvider, Renderer } from "@json-render/svelte";
  import type { ComponentRegistry, Spec } from "@json-render/svelte";

  interface Props {
    spec: Spec;
    registry: ComponentRegistry;
    loading?: boolean;
  }

  let { spec, registry, loading = false }: Props = $props();
</script>

<JsonUIProvider initialState={spec.state}>
  <Renderer {spec} {registry} {loading} />
</JsonUIProvider>
