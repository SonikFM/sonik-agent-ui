export type AgentToolPermissionMode = "off" | "ask" | "allow";
export type AgentModelCatalogSource = "fallback" | "gateway";

export interface AgentModelOption {
  id: string;
  label: string;
  provider: string;
  recommended?: boolean;
  description?: string;
  source?: AgentModelCatalogSource;
  contextWindow?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  supportsTools?: boolean;
  supportsImages?: boolean;
  supportsReasoning?: boolean;
  zdrStatus?: "available" | "unknown";
}

export interface AgentSkillOption {
  id: string;
  familyId: string;
  label: string;
  description: string;
  loadPolicy: "startup" | "surface" | "manual";
}

export interface AgentCustomSkill {
  id: string;
  label: string;
  markdown: string;
  enabled: boolean;
}

export interface AgentToolFamilyOption {
  id: string;
  label: string;
  description: string;
  commandCount?: number;
  defaultMode: AgentToolPermissionMode;
  disabledReason?: string;
}

export interface AgentRuntimeSettings {
  modelId: string;
  skillIds: string[];
  customSkills: AgentCustomSkill[];
  additionalSystemPrompt: string;
  requireZdr: boolean;
  toolPermissionModes: Record<string, AgentToolPermissionMode>;
}

export const AGENT_MODEL_OPTIONS: AgentModelOption[] = [
  {
    id: "deepseek/deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    provider: "DeepSeek",
    recommended: true,
    source: "fallback",
    zdrStatus: "unknown",
    description: "Primary staging model for embedded Sonik workflow demos.",
  },
  {
    id: "deepseek/deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    provider: "DeepSeek",
    source: "fallback",
    zdrStatus: "unknown",
    description: "Fast low-cost option; use for lightweight artifact drafts only.",
  },
  {
    id: "anthropic/claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    provider: "Anthropic",
    source: "fallback",
    zdrStatus: "unknown",
    description: "Safe default fallback when no model preference is selected.",
  },
  {
    id: "anthropic/claude-sonnet-4.5",
    label: "Claude Sonnet 4.5",
    provider: "Anthropic",
    source: "fallback",
    zdrStatus: "unknown",
    description: "Higher-reasoning option for workflow debugging and reviews.",
  },
];

export const DEFAULT_AGENT_MODEL_ID = "deepseek/deepseek-v4-pro";
export const FALLBACK_AGENT_MODEL_ID = "anthropic/claude-haiku-4.5";
export const MAX_AGENT_CUSTOM_SKILLS = 8;
export const MAX_AGENT_CUSTOM_SKILL_MARKDOWN_CHARS = 4_000;
export const MAX_AGENT_SYSTEM_PROMPT_CHARS = 2_000;

export const AGENT_SKILL_OPTIONS: AgentSkillOption[] = [
  {
    id: "booking.context.intake",
    familyId: "booking-context-intake",
    label: "Set up a venue",
    description: "Question-card intake for venue schedules, bookable inventory, policies, and manifest drafts.",
    loadPolicy: "surface",
  },
  {
    id: "booking.reservation.create",
    familyId: "booking-reservation",
    label: "Create a reservation",
    description: "Guided booking flow: availability, guest, booking mutation, and proof telemetry.",
    loadPolicy: "surface",
  },
  {
    id: "booking.event.create",
    familyId: "booking-event",
    label: "Create an event",
    description: "Event manifest intake for ticketed or hybrid bookable experiences.",
    loadPolicy: "manual",
  },
  {
    id: "amplify.campaign.template.create",
    familyId: "amplify-campaign-template",
    label: "Campaign template",
    description: "Amplify campaign wizard template intake and validation.",
    loadPolicy: "manual",
  },
];

export const AGENT_TOOL_FAMILY_OPTIONS: AgentToolFamilyOption[] = [
  {
    id: "booking",
    label: "Booking core",
    description: "Contexts, availability, organizer templates, and starter booking runtime commands.",
    defaultMode: "ask",
  },
  {
    id: "bookings",
    label: "Reservations",
    description: "Create/read/update booking reservations and guest-facing booking records.",
    defaultMode: "ask",
  },
  {
    id: "booking-resources",
    label: "Resources",
    description: "Resource types, resource units, tables, rooms, courts, tees, and capacity primitives.",
    defaultMode: "ask",
  },
  {
    id: "booking-policies",
    label: "Policies",
    description: "Booking policies, confirmation rules, cancellation/no-show settings, and enforcement metadata.",
    defaultMode: "ask",
  },
  {
    id: "booking-holds",
    label: "Holds",
    description: "Temporary holds and hold release flows. Prefer reservations unless explicitly needed.",
    defaultMode: "ask",
  },
  {
    id: "booking-guests",
    label: "Guests",
    description: "Guest identity records and customer lookup/creation commands.",
    defaultMode: "ask",
  },
  {
    id: "booking-media",
    label: "Media",
    description: "Upload, fetch, and manage booking media assets when mounted by the host.",
    defaultMode: "ask",
  },
];

const STATIC_MODEL_IDS = new Set(AGENT_MODEL_OPTIONS.map((option) => option.id));
const SKILL_IDS = new Set(AGENT_SKILL_OPTIONS.map((option) => option.id));
const TOOL_FAMILY_IDS = new Set(AGENT_TOOL_FAMILY_OPTIONS.map((option) => option.id));
const PERMISSION_MODES = new Set<AgentToolPermissionMode>(["off", "ask", "allow"]);
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

export function createDefaultAgentToolPermissionModes(): Record<string, AgentToolPermissionMode> {
  return Object.fromEntries(AGENT_TOOL_FAMILY_OPTIONS.map((option) => [option.id, option.defaultMode]));
}

export function isKnownAgentModelId(value: unknown): value is string {
  return isValidAgentModelId(value);
}

export function isValidAgentModelId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 160 && MODEL_ID_PATTERN.test(value);
}

export function isStaticAgentModelId(value: unknown): value is string {
  return typeof value === "string" && STATIC_MODEL_IDS.has(value);
}

export function createAgentCustomSkillId(label: string, existingIds: Iterable<string> = []): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "custom-skill";
  const taken = new Set(existingIds);
  let candidate = `custom.${slug}`;
  let index = 2;
  while (taken.has(candidate)) {
    candidate = `custom.${slug}-${index}`;
    index += 1;
  }
  return candidate;
}

function sanitizeBoundedString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, maxLength) : "";
}

function sanitizeCustomSkill(value: unknown): AgentCustomSkill | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!record) return null;
  const label = sanitizeBoundedString(record.label, 80).trim();
  const markdown = sanitizeBoundedString(record.markdown, MAX_AGENT_CUSTOM_SKILL_MARKDOWN_CHARS).trim();
  const rawId = sanitizeBoundedString(record.id, 96).trim();
  const id = rawId.startsWith("custom.") ? rawId : createAgentCustomSkillId(label || "custom-skill");
  if (!label || !markdown) return null;
  return { id, label, markdown, enabled: record.enabled !== false };
}

export function sanitizeAgentRuntimeSettings(value: unknown): AgentRuntimeSettings {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const defaultToolModes = createDefaultAgentToolPermissionModes();
  const modelId = isValidAgentModelId(record.modelId) ? record.modelId : DEFAULT_AGENT_MODEL_ID;
  const skillIds = Array.isArray(record.skillIds)
    ? [...new Set(record.skillIds.filter((entry): entry is string => typeof entry === "string" && SKILL_IDS.has(entry)))].slice(0, 8)
    : [];
  const customSkills = Array.isArray(record.customSkills)
    ? record.customSkills.map(sanitizeCustomSkill).filter((entry): entry is AgentCustomSkill => Boolean(entry)).slice(0, MAX_AGENT_CUSTOM_SKILLS)
    : [];
  const additionalSystemPrompt = sanitizeBoundedString(record.additionalSystemPrompt, MAX_AGENT_SYSTEM_PROMPT_CHARS).trim();
  const requireZdr = record.requireZdr !== false;
  const toolPermissionModes: Record<string, AgentToolPermissionMode> = { ...defaultToolModes };
  const rawModes = record.toolPermissionModes && typeof record.toolPermissionModes === "object" && !Array.isArray(record.toolPermissionModes)
    ? record.toolPermissionModes as Record<string, unknown>
    : {};
  for (const [familyId, mode] of Object.entries(rawModes)) {
    if (TOOL_FAMILY_IDS.has(familyId) && PERMISSION_MODES.has(mode as AgentToolPermissionMode)) {
      toolPermissionModes[familyId] = mode as AgentToolPermissionMode;
    }
  }
  return { modelId, skillIds, customSkills, additionalSystemPrompt, requireZdr, toolPermissionModes };
}

export function resolveAgentToolPermissionMode(familyId: string | undefined, modes: Record<string, AgentToolPermissionMode> | undefined): AgentToolPermissionMode {
  if (!familyId) return "ask";
  return modes?.[familyId] ?? "ask";
}

export function isAgentToolFamilyEnabled(familyId: string | undefined, modes: Record<string, AgentToolPermissionMode> | undefined): boolean {
  return resolveAgentToolPermissionMode(familyId, modes) !== "off";
}

export function summarizeAgentRuntimeSettings(settings: AgentRuntimeSettings): string {
  const activeSkills = settings.skillIds.length ? settings.skillIds.join(", ") : "none";
  const activeCustomSkills = settings.customSkills.filter((skill) => skill.enabled);
  const disabledFamilies = Object.entries(settings.toolPermissionModes)
    .filter(([, mode]) => mode === "off")
    .map(([familyId]) => familyId);
  const allowFamilies = Object.entries(settings.toolPermissionModes)
    .filter(([, mode]) => mode === "allow")
    .map(([familyId]) => familyId);
  const lines = [
    `Agent settings: model=${settings.modelId}; ZDR required=${settings.requireZdr ? "yes" : "no"}`,
    `Selected runtime skills: ${activeSkills}`,
    `Tool family permission modes: off=${disabledFamilies.join(", ") || "none"}; allow=${allowFamilies.join(", ") || "none"}; ask/default families still require trusted host approval for mutations.`,
  ];
  if (settings.additionalSystemPrompt) {
    lines.push(`User-added agent instructions:\n${settings.additionalSystemPrompt}`);
  }
  if (activeCustomSkills.length > 0) {
    lines.push(`User-created Markdown skills:\n${activeCustomSkills.map((skill) => `- ${skill.label} (${skill.id}):\n${skill.markdown}`).join("\n")}`);
  }
  return lines.join("\n");
}
