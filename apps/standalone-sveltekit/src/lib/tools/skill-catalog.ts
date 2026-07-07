import { tool } from "ai";
import { z } from "zod";
import type { AgentPageContext, SkillLearnAspect } from "@sonik-agent-ui/tool-contracts";
import { learnRuntimeSkill, searchRuntimeSkillCatalog, type RuntimeSkillRegistryContext } from "../server/skill-registry.ts";
import { writeAgentTelemetry } from "../server/agent-telemetry.ts";
import type { HostSessionEnvelope } from "@sonik-agent-ui/platform-adapters";

const skillAspectSchema = z.enum(["description", "workflow", "examples", "policy", "context", "commands"]);

export function createSkillCatalogTools(context: { sessionId?: string | null; pageContext?: AgentPageContext; hostSession?: HostSessionEnvelope | null } = {}) {
  const registryContext = (): RuntimeSkillRegistryContext => ({
    ...context.pageContext,
    authenticated: context.hostSession?.authenticated,
    organizationId: context.hostSession?.organizationId,
    scopes: context.hostSession?.scopes,
  });

  return {
    searchSkillCatalog: tool({
      description:
        "Search compact Sonik Agent UI workflow skills before learning command recipes. Use this for page-specific workflows such as booking reservations without loading every workflow into context.",
      inputSchema: z.object({
        query: z.string().default("").describe("User-language workflow query, e.g. create reservation, booking, campaign wizard, page workflow."),
        limit: z.number().int().min(1).max(20).default(8).describe("Maximum compact skill summaries to return."),
      }),
      execute: async ({ query, limit }) => {
        const result = searchRuntimeSkillCatalog({ query, limit, context: registryContext() });
        await writeAgentTelemetry({
          source: "server",
          event: "tool.searchSkillCatalog",
          ok: true,
          mode: "skill-catalog",
          elementCount: result.skills.length,
          totalMatches: result.totalMatches,
          query,
          sessionId: context.sessionId ?? undefined,
          skillFamilies: context.pageContext?.skillFamilies,
          commandFamilies: context.pageContext?.commandFamilies,
        });
        return { kind: "skill-catalog-search" as const, ...result };
      },
    }),
    learnSkill: tool({
      description:
        "Learn one workflow skill's exact command path, examples, negative constraints, page-context requirements, and success evidence before executing commands.",
      inputSchema: z.object({
        skillId: z.string().describe("Skill id returned by searchSkillCatalog, e.g. booking.reservation.create."),
        aspects: z.array(skillAspectSchema).optional().describe("Optional detail slices to load."),
      }),
      execute: async ({ skillId, aspects }) => {
        const learned = learnRuntimeSkill({ skillId, aspects: aspects as SkillLearnAspect[] | undefined });
        await writeAgentTelemetry({
          source: "server",
          event: "tool.learnSkill",
          ok: Boolean((learned as { ok?: unknown }).ok),
          toolCallId: skillId,
          mode: "skill-catalog",
          sessionId: context.sessionId ?? undefined,
          skillFamilies: context.pageContext?.skillFamilies,
          commandFamilies: context.pageContext?.commandFamilies,
        });
        return learned;
      },
    }),
  };
}
