import { normalizeAgentEmbedIntent } from "@sonik-agent-ui/agent-embed";
import type { PageLoad } from "./$types";

// The standalone chat/canvas prototype is an interactive client app.
// Disable SSR so AI SDK Chat/transport setup and json-render canvas state
// only initialize in the browser during local manual testing.
export const ssr = false;

export const load: PageLoad = ({ url }) => ({
  embedIntent: normalizeAgentEmbedIntent({
    embedMode: url.searchParams.get("embedMode"),
    agentUiMode: url.searchParams.get("agentUiMode"),
    railMode: url.searchParams.get("railMode"),
    rail: url.searchParams.get("rail"),
  }),
});
