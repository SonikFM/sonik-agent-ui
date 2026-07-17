import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { resolveAgentUiDevApiProxyTarget } from "./src/lib/server/dev-api-proxy";

const devApiTarget = resolveAgentUiDevApiProxyTarget(process.env);

export default defineConfig({
  plugins: [sveltekit(), tailwindcss()],
  ...(devApiTarget
    ? {
        server: {
          proxy: {
            "/api": {
              target: devApiTarget,
              changeOrigin: true,
              secure: true,
              ws: true,
            },
          },
        },
      }
    : {}),
  optimizeDeps: {
    exclude: ["@json-render/svelte"],
  },
});
