<script lang="ts">
  import { JsonUIProvider, Renderer } from "@json-render/svelte";
  import type { ComponentRegistry, Spec } from "@json-render/svelte";

  type StateStore = {
    get(path: string): unknown;
    set(path: string, value: unknown): void;
    update(updates: Record<string, unknown>): void;
    getSnapshot(): Record<string, unknown>;
    getServerSnapshot?: () => Record<string, unknown>;
    subscribe(listener: () => void): () => void;
  };

  interface Props {
    spec: Spec;
    registry: ComponentRegistry;
    loading?: boolean;
    store?: StateStore;
    onStateChange?: (changes: Array<{ path: string; value: unknown }>) => void;
  }

  let { spec, registry, loading = false, store, onStateChange }: Props = $props();
</script>

<JsonUIProvider initialState={spec.state} handlers={{}} {store} {onStateChange}>
  <Renderer {spec} {registry} {loading} />
</JsonUIProvider>
