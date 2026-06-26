// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    interface Platform {
      env?: Record<string, unknown>;
      context?: unknown;
      caches?: CacheStorage;
    }
    interface Locals {}
    interface PageData {}
    interface PageState {}
  }
}

export {};
