import { AGENT_MODEL_OPTIONS, type AgentModelOption } from "./agent-settings";

export interface GatewayModelCatalogResult {
  models: AgentModelOption[];
  source: "gateway" | "fallback";
  fetchedAt: string;
  error?: string;
}

interface GatewayModelRecord {
  id?: unknown;
  name?: unknown;
  label?: unknown;
  provider?: unknown;
  providerId?: unknown;
  owned_by?: unknown;
  description?: unknown;
  contextWindow?: unknown;
  context_window?: unknown;
  inputTokenPrice?: unknown;
  outputTokenPrice?: unknown;
  pricing?: unknown;
  capabilities?: unknown;
  modality?: unknown;
  tags?: unknown;
}

const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
const DEFAULT_GATEWAY_TIMEOUT_MS = 4_000;
const PREFERRED_MODEL_IDS = new Set(["deepseek/deepseek-v4-pro", "anthropic/claude-sonnet-4.5", "anthropic/claude-haiku-4.5"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function pricePerMillion(value: unknown): number | undefined {
  const parsed = asNumber(value);
  return typeof parsed === "number" ? parsed * 1_000_000 : undefined;
}

function titleCaseProvider(id: string): string {
  const provider = id.split("/")[0] ?? "gateway";
  return provider
    .split(/[._-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Gateway";
}

function labelFromId(id: string): string {
  const model = id.split("/").at(-1) ?? id;
  return model
    .split(/[._:-]+/g)
    .filter(Boolean)
    .map((part) => part.toUpperCase() === part ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function readCapability(capabilities: unknown, keys: string[], tags: unknown): boolean | undefined {
  const normalizedTags = Array.isArray(tags) ? tags.map((tag) => String(tag).toLowerCase()) : [];
  if (normalizedTags.some((tag) => keys.some((key) => tag.includes(key.toLowerCase())))) return true;
  const record = asRecord(capabilities);
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (Array.isArray(value) && value.length > 0) return true;
  }
  return undefined;
}

function mapGatewayModel(raw: GatewayModelRecord): AgentModelOption | null {
  const id = asString(raw.id);
  if (!id || !id.includes("/")) return null;
  const pricing = asRecord(raw.pricing);
  const label = asString(raw.label) ?? asString(raw.name) ?? labelFromId(id);
  const provider = titleCaseProvider(asString(raw.provider) ?? asString(raw.providerId) ?? asString(raw.owned_by) ?? id);
  const contextWindow = asNumber(raw.contextWindow) ?? asNumber(raw.context_window);
  const inputPricePerMillion = pricePerMillion(raw.inputTokenPrice) ?? pricePerMillion(pricing?.input) ?? pricePerMillion(pricing?.inputTokens);
  const outputPricePerMillion = pricePerMillion(raw.outputTokenPrice) ?? pricePerMillion(pricing?.output) ?? pricePerMillion(pricing?.outputTokens);
  const capabilities = raw.capabilities ?? raw.modality;
  return {
    id,
    label,
    provider,
    recommended: PREFERRED_MODEL_IDS.has(id),
    description: asString(raw.description) ?? "Discovered from Vercel AI Gateway.",
    source: "gateway",
    contextWindow,
    inputPricePerMillion,
    outputPricePerMillion,
    supportsTools: readCapability(capabilities, ["tools", "tool-use", "toolCalls", "functionCalling"], raw.tags),
    supportsImages: readCapability(capabilities, ["imageInput", "vision", "images"], raw.tags),
    supportsReasoning: readCapability(capabilities, ["reasoning"], raw.tags),
    // The public catalog may not expose provider-level ZDR agreement metadata.
    // Enforcement happens at request time via Gateway providerOptions/team policy.
    zdrStatus: "unknown",
  };
}

function extractModels(payload: unknown): GatewayModelRecord[] {
  if (Array.isArray(payload)) return payload as GatewayModelRecord[];
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ["data", "models", "items"]) {
    const value = record[key];
    if (Array.isArray(value)) return value as GatewayModelRecord[];
  }
  return [];
}

function sortedUniqueModels(models: AgentModelOption[]): AgentModelOption[] {
  const seen = new Set<string>();
  const unique: AgentModelOption[] = [];
  for (const model of models) {
    if (!seen.has(model.id)) {
      seen.add(model.id);
      unique.push(model);
    }
  }
  return unique.sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)) || a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label));
}

export function createFallbackModelCatalog(error?: string): GatewayModelCatalogResult {
  return {
    models: AGENT_MODEL_OPTIONS.map((model) => ({ ...model, source: "fallback" as const })),
    source: "fallback",
    fetchedAt: new Date().toISOString(),
    error,
  };
}

export async function fetchGatewayModelCatalog(fetchImpl: typeof fetch = fetch, timeoutMs = DEFAULT_GATEWAY_TIMEOUT_MS): Promise<GatewayModelCatalogResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(GATEWAY_MODELS_URL, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return createFallbackModelCatalog(`gateway_models_http_${response.status}`);
    const payload = await response.json() as unknown;
    const models = sortedUniqueModels(extractModels(payload).map(mapGatewayModel).filter((model): model is AgentModelOption => Boolean(model)));
    if (models.length === 0) return createFallbackModelCatalog("gateway_models_empty");
    return { models, source: "gateway", fetchedAt: new Date().toISOString() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "gateway_models_fetch_failed";
    return createFallbackModelCatalog(message);
  } finally {
    clearTimeout(timeout);
  }
}
