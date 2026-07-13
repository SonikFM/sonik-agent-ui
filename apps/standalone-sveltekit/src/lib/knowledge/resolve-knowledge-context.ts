// The SEAM (Phase 9): pure resolution of `agentDefinitionSchema.knowledgeRefs`
// into prompt-ready sections. The future runtime adapter
// (`definitionToRuntimeSettings` / agent.ts, owned elsewhere this wave) calls
// this; it does no route/session/agent wiring itself.

import { createKnowledgeStore, defaultKnowledgeRoot } from "./knowledge-store.ts";
import type { KnowledgeRef } from "../../../../../packages/tool-contracts/src/knowledge-ref.ts";

export type KnowledgeContextSection = { storeId: string; title: string; content: string };

export const DEFAULT_KNOWLEDGE_CONTEXT_MAX_CHARS = 24_000;

export async function resolveKnowledgeContext(
  knowledgeRefs: KnowledgeRef[],
  opts: { maxChars?: number; rootDir?: string } = {},
): Promise<{ sections: KnowledgeContextSection[]; truncated: boolean }> {
  const maxChars = opts.maxChars ?? DEFAULT_KNOWLEDGE_CONTEXT_MAX_CHARS;
  const store = createKnowledgeStore(opts.rootDir ?? defaultKnowledgeRoot());

  const candidates: KnowledgeContextSection[] = [];
  for (const ref of knowledgeRefs) {
    const files = await store.listFiles(ref.storeId).catch(() => null);
    if (!files) continue; // missing store: skip without throwing

    const parts: string[] = [];
    for (const fileRef of ref.fileRefs) {
      const content = await store.readFile(ref.storeId, fileRef.fileId).catch(() => null);
      if (content == null) continue; // missing file: skip without throwing
      parts.push(`## ${fileRef.title}\n\n${content}`);
    }
    if (parts.length === 0) continue;
    candidates.push({ storeId: ref.storeId, title: ref.title, content: parts.join("\n\n---\n\n") });
  }

  // Deterministic char budget, oldest-truncated-first: `knowledgeRefs` order
  // is treated as chronological (index 0 = attached earliest). When combined
  // content exceeds maxChars, we fill the budget from the newest section
  // backward, so newest sections stay whole and older ones are cut or
  // dropped first -- then restore original order for a stable prompt.
  let remaining = maxChars;
  let truncated = false;
  const kept: (KnowledgeContextSection | null)[] = new Array(candidates.length).fill(null);
  for (let i = candidates.length - 1; i >= 0; i--) {
    const section = candidates[i];
    if (remaining <= 0) {
      truncated = true;
      continue;
    }
    if (section.content.length <= remaining) {
      kept[i] = section;
      remaining -= section.content.length;
    } else {
      kept[i] = { ...section, content: section.content.slice(0, remaining) };
      remaining = 0;
      truncated = true;
    }
  }

  const sections = kept.filter((section): section is KnowledgeContextSection => section !== null);
  return { sections, truncated };
}
