import { getRuntimeSkillCatalog, searchRuntimeSkillCatalog } from "$lib/server/skill-registry";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
  const limit = Number(url.searchParams.get("limit") ?? 40);
  const query = url.searchParams.get("q") ?? "";
  const hasContext = ["route", "surface", "pageType"].some((key) => url.searchParams.has(key));
  if (!hasContext) {
    const catalog = getRuntimeSkillCatalog();
    const normalizedQuery = query.trim().toLowerCase();
    const skills = catalog.skills
      .filter((skill) => !normalizedQuery || `${skill.id} ${skill.title} ${skill.description}`.toLowerCase().includes(normalizedQuery))
      .slice(0, Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 40);
    return Response.json({ version: "sonik-agent-ui.skill-index.v1", provider: catalog.provider, generatedAt: catalog.generatedAt, skills, totalMatches: skills.length, truncated: false, limit });
  }
  return Response.json(searchRuntimeSkillCatalog({
    query,
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 40,
    context: {
      route: url.searchParams.get("route") ?? undefined,
      surface: url.searchParams.get("surface") ?? undefined,
      pageType: url.searchParams.get("pageType") ?? undefined,
    },
  }));
};
