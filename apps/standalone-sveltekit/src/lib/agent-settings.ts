export type AgentToolPermissionMode = "off" | "ask" | "allow";

export interface AgentModelOption {
  id: string;
  label: string;
  provider: string;
  recommended?: boolean;
  description?: string;
}

export interface AgentSkillOption {
  id: string;
  familyId: string;
  label: string;
  description: string;
  loadPolicy: "startup" | "surface" | "manual";
}

export interface AgentToolFamilyOption {
  id: string;
  label: string;
  description: string;
  commandCount?: number;
  defaultMode: AgentToolPermissionMode;
}

export interface AgentRuntimeSettings {
  modelId: string;
  skillIds: string[];
  toolPermissionModes: Record<string, AgentToolPermissionMode>;
}

export const AGENT_MODEL_OPTIONS: AgentModelOption[] = [
  {
    id: "deepseek/deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    provider: "DeepSeek",
    recommended: true,
    description: "Primary staging model for embedded Sonik workflow demos.",
  },
  {
    id: "deepseek/deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    provider: "DeepSeek",
    description: "Fast low-cost option; use for lightweight artifact drafts only.",
  },
  {
    id: "anthropic/claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    provider: "Anthropic",
    description: "Safe default fallback when no model preference is selected.",
  },
  {
    id: "anthropic/claude-sonnet-4.5",
    label: "Claude Sonnet 4.5",
    provider: "Anthropic",
    description: "Higher-reasoning option for workflow debugging and reviews.",
  },
];

export const DEFAULT_AGENT_MODEL_ID = "deepseek/deepseek-v4-pro";
export const FALLBACK_AGENT_MODEL_ID = "anthropic/claude-haiku-4.5";

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

const MODEL_IDS = new Set(AGENT_MODEL_OPTIONS.map((option) => option.id));
const SKILL_IDS = new Set(AGENT_SKILL_OPTIONS.map((option) => option.id));
const TOOL_FAMILY_IDS = new Set(AGENT_TOOL_FAMILY_OPTIONS.map((option) => option.id));
const PERMISSION_MODES = new Set<AgentToolPermissionMode>(["off", "ask", "allow"]);

export function createDefaultAgentToolPermissionModes(): Record<string, AgentToolPermissionMode> {
  return Object.fromEntries(AGENT_TOOL_FAMILY_OPTIONS.map((option) => [option.id, option.defaultMode]));
}

export function isKnownAgentModelId(value: unknown): value is string {
  return typeof value === "string" && MODEL_IDS.has(value);
}

export function sanitizeAgentRuntimeSettings(value: unknown): AgentRuntimeSettings {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const defaultToolModes = createDefaultAgentToolPermissionModes();
  const modelId = isKnownAgentModelId(record.modelId) ? record.modelId : DEFAULT_AGENT_MODEL_ID;
  const skillIds = Array.isArray(record.skillIds)
    ? [...new Set(record.skillIds.filter((entry): entry is string => typeof entry === "string" && SKILL_IDS.has(entry)))].slice(0, 8)
    : [];
  const toolPermissionModes: Record<string, AgentToolPermissionMode> = { ...defaultToolModes };
  const rawModes = record.toolPermissionModes && typeof record.toolPermissionModes === "object" && !Array.isArray(record.toolPermissionModes)
    ? record.toolPermissionModes as Record<string, unknown>
    : {};
  for (const [familyId, mode] of Object.entries(rawModes)) {
    if (TOOL_FAMILY_IDS.has(familyId) && PERMISSION_MODES.has(mode as AgentToolPermissionMode)) {
      toolPermissionModes[familyId] = mode as AgentToolPermissionMode;
    }
  }
  return { modelId, skillIds, toolPermissionModes };
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
  const disabledFamilies = Object.entries(settings.toolPermissionModes)
    .filter(([, mode]) => mode === "off")
    .map(([familyId]) => familyId);
  const allowFamilies = Object.entries(settings.toolPermissionModes)
    .filter(([, mode]) => mode === "allow")
    .map(([familyId]) => familyId);
  return [
    `Agent settings: model=${settings.modelId}`,
    `Selected runtime skills: ${activeSkills}`,
    `Tool family permission modes: off=${disabledFamilies.join(", ") || "none"}; allow=${allowFamilies.join(", ") || "none"}; ask/default families still require trusted host approval for mutations.`,
  ].join("\n");
}
