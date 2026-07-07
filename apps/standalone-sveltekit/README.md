# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv create --template minimal --types ts --no-install svelte-chat
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## JSON-render component registry

This app currently owns the renderable JSON component catalog used by chat inline specs and canvas artifacts. The important files are:

```txt
src/lib/render/catalog.ts              Zod-backed component schemas and catalog descriptions
src/lib/render/registry.ts             Runtime Svelte component bindings
src/lib/render/component-registry.ts   Human/agent-readable component group map
src/lib/render/components/             Svelte implementations for each component id
src/lib/server/intake-artifacts.ts     Skill/intake surface -> json-render artifact factory
```

Reusable renderer packages live one level up in the workspace:

```txt
packages/json-ui-runtime/src/renderer/JsonArtifactRenderer.svelte
packages/svelte/src/ElementRenderer.svelte
packages/svelte/src/contexts/StateProvider.svelte
packages/svelte/src/contexts/ActionProvider.svelte
packages/core/src/
packages/tool-contracts/src/index.ts
```

Display/dashboard components are strong enough for weather/GitHub/crypto/HN style artifacts. Input components are intentionally state-only today; the next stateful-object pass should wire `onStateChange`, artifact version persistence, and trusted intake controller actions around them rather than putting service calls inside renderer components.
