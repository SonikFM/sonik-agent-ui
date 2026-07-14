import {
  classifyRunErrorCode,
  describeRunError,
  isRunErrorCode,
  type RunErrorCode,
} from "@sonik-agent-ui/tool-contracts";

export interface SafeRunFailure {
  code: RunErrorCode;
  message: string;
  resumable: boolean;
}

export function sanitizeRunFailure(
  error: unknown,
  options: { code?: RunErrorCode | null; fallbackCode?: RunErrorCode; resumable?: boolean } = {},
): SafeRunFailure {
  const rawMessage = readErrorMessage(error);
  const classified = options.code ?? classifyRunErrorCode({ message: rawMessage, status: readErrorStatus(error) });
  const code = options.code ?? (classified === "UNKNOWN" && options.fallbackCode ? options.fallbackCode : classified);
  const affordance = describeRunError(code);
  return { code, message: affordance.title, resumable: options.resumable ?? affordance.resumable };
}

export function sanitizeFailureRecord<T extends object>(value: T): T {
  const record = value as Record<string, unknown>;
  if (!("error" in record) || record.error === undefined || record.error === null) return value;
  const code = isRunErrorCode(record.error_code) ? record.error_code : undefined;
  const failure = sanitizeRunFailure(record.error, { code, resumable: typeof record.resumable === "boolean" ? record.resumable : undefined });
  const payload = isRecord(record.payload) && "error" in record.payload ? { ...record.payload, error: failure.message } : record.payload;
  return { ...record, error: failure.message, ...(payload === record.payload ? {} : { payload }) } as T;
}

export function sanitizeSessionFailureProjection<T>(value: T): T {
  return sanitizeSessionValue(value) as T;
}

export function sanitizeSessionMessages<T>(messages: T): T {
  if (!Array.isArray(messages)) return messages;
  return messages.map((message) => sanitizeSessionValue(message)) as T;
}

const PROVIDER_PRIVATE_KEY = /^(?:provider(?:$|metadata|data|options|request|response|id|name|ref|reference|references)|model(?:$|id|name|metadata|data|options|request|response))/;
const PROVIDER_REFERENCE_KEY = /^(?:providerref|providerreference|providerreferences|rawreference|storagekey)$/;
const SECRET_KEY = /^(?:credentials?|secrets?|clientsecret|privatekey|password|apikeys?|authorization|setcookie|cookie|accesstoken|refreshtoken|idtoken|authtoken|sessiontoken)$/;
const URL_KEY = /^(?:url|uri|href|endpoint|baseurl|callbackurl|requesturl|responseurl)$/;
const PRIVATE_URL_KEY = /^(?:requesturl|responseurl)$/;
const RAW_PROVIDER_MATERIAL_KEY = /^(?:rawtext|providertext|rawerror|rawresponse|responsebody)$/;

function sanitizeSessionValue(value: unknown, errorBearing = false, failureMessage = "Run interrupted"): unknown {
  if (typeof value === "string") return containsPrivateMaterial(value) ? failureMessage : value;
  if (Array.isArray(value)) return value.map((entry) => sanitizeSessionValue(entry, errorBearing, failureMessage));
  if (!isRecord(value)) return value;
  const code = isRunErrorCode(value.error_code) ? value.error_code : undefined;
  const hasError = errorBearing || isErrorBearing(value);
  const hasPrivateFields = Object.keys(value).some(isPrivateField);
  const safeMessage = hasError
    ? sanitizeRunFailure(value.errorText ?? value.error ?? failureMessage, { code, fallbackCode: "AGENT_STREAM_FAILED" }).message
    : failureMessage;
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    if (isPrivateField(key) || ((hasError || hasPrivateFields) && URL_KEY.test(normalizeKey(key)))) return [];
    if (hasError && /^(?:error|errorText|detail|message)$/.test(key) && entry !== undefined && entry !== null) return [[key, safeMessage]];
    return [[key, sanitizeSessionValue(entry, hasError && key !== "spec", safeMessage)]];
  }));
}

function isPrivateField(key: string): boolean {
  const normalized = normalizeKey(key);
  return PROVIDER_PRIVATE_KEY.test(normalized) || PROVIDER_REFERENCE_KEY.test(normalized) || SECRET_KEY.test(normalized) || PRIVATE_URL_KEY.test(normalized) || RAW_PROVIDER_MATERIAL_KEY.test(normalized);
}

function containsPrivateMaterial(value: string): boolean {
  return /(?<![\/A-Za-z0-9_-])files\/(?!handbook\b)[A-Za-z0-9_-]{6,}(?=$|[\s"'?#,;:)\]}]|\.(?:\s|$))|\bsk[-_][A-Za-z0-9_-]{8,}\b|\bAIza[A-Za-z0-9_-]{8,}\b|\bbearer\s+(?!(?:authentication|authorization)(?:[.!?,;:)\]}]+)?(?=$|\s))(?:(?=[A-Za-z0-9._-]{12,}\b)(?=[A-Za-z0-9._-]*[0-9._-])[A-Za-z0-9._-]+|(?!authentication\b|authorization\b)[A-Za-z]{12,}(?=$|["',;:)\]}]))/i.test(value);
}

function normalizeKey(key: string): string {
  return key.replace(/[_-]/g, "").toLowerCase();
}

function isErrorBearing(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.type === "error"
    || value.type === "tool-output-error"
    || value.state === "output-error"
    || value.state === "input-error"
    || value.state === "output-denied"
    || ("errorText" in value && value.errorText !== undefined && value.errorText !== null)
    || ("error" in value && value.error !== undefined && value.error !== null && value.error !== false);
}

function readErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return undefined;
}

function readErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const status = Number(error.status);
  return Number.isFinite(status) ? status : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
