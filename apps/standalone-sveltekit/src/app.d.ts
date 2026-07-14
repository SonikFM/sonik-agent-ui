// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    interface Platform {
      env?: Record<string, unknown> & {
        AGENT_UI_FILES_BUCKET?: R2Bucket;
        CF_VERSION_METADATA?: {
          id?: string;
          tag?: string;
          timestamp?: string;
        };
      };
      context?: unknown;
      caches?: CacheStorage;
    }
    interface Locals {}
    interface PageData {}
    interface PageState {}
  }
}

export {};
