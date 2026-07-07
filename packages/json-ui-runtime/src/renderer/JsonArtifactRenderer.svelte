<script lang="ts">
  import { JsonUIProvider, Renderer } from "@json-render/svelte";
  import type { ComponentRegistry, Spec } from "@json-render/svelte";

  type JsonRendererActionHandler = (params: Record<string, unknown>) => void | Promise<void>;

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
    onAction?: (actionName: string, params?: Record<string, unknown>) => void | Promise<void>;
  }

  let { spec, registry, loading = false, store, onStateChange, onAction }: Props = $props();

  let handlers = $derived.by(() => {
    if (!onAction) return {};
    return new Proxy({} as Record<string, JsonRendererActionHandler>, {
      get: (_target, prop: string) => {
        return (params: Record<string, unknown>) => onAction(prop, params);
      },
      has: () => true,
    });
  });
</script>

<JsonUIProvider initialState={spec.state} {handlers} {store} {onStateChange}>
  <Renderer {spec} {registry} {loading} />
</JsonUIProvider>
