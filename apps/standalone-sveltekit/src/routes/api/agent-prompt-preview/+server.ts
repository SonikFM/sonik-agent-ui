import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { AGENT_PROMPT_CORE, AGENT_PROMPT_MODULES, CORE_MODULE_ID } from "$lib/agent-prompt";
import { listRuntimeSkillPromptDefaults } from "$lib/server/skill-registry";

// Read-only defaults for the Agent Settings "Prompt" tab's override editors.
// `composeAgentSystemPrompt` itself is client-importable (it takes pre-resolved
// skill bodies as plain input, never touching the server-only skill registry),
// so the composed preview with the caller's current overrides applied is
// computed client-side in +page.svelte. This endpoint exists only because the
// runtime skill catalog lives under `$lib/server/` and its default bodies
// cannot otherwise reach a client component.
export const GET: RequestHandler = ({ setHeaders }) => {
  setHeaders({
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
  });
  return json({
    promptModules: [
      { id: CORE_MODULE_ID, title: "Core identity & workflow", defaultBody: AGENT_PROMPT_CORE },
      ...AGENT_PROMPT_MODULES.map((module) => ({ id: module.id, title: module.title, defaultBody: module.body })),
    ],
    skillModules: listRuntimeSkillPromptDefaults(),
  });
};
