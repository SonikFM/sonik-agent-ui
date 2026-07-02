import {
  DEFAULT_DOCUMENT_THEME_ID,
  type DocumentThemeId,
  documentColorSchemeForTheme,
  isDocumentThemeId,
} from "./theme-registry";

export type ThemeSetting = DocumentThemeId | "system";

export const THEME_STORAGE_KEY = "amplify.documentTheme";
export const THEME_CHANGE_EVENT = "amplify:document-theme-change";
export const LEGACY_THEME_CHANGE_EVENT = "sonik-agent-ui:theme-change";
export const DEFAULT_THEME_SETTING: ThemeSetting = "system";

const SYSTEM_DARK_THEME: DocumentThemeId = "dark";
const SYSTEM_LIGHT_THEME: DocumentThemeId = "light";

export function normalizeThemeSetting(value: string | null | undefined): ThemeSetting {
  if (value === "system") return "system";
  return value && isDocumentThemeId(value) ? value : DEFAULT_THEME_SETTING;
}

export function parseThemeSetting(value: string | null | undefined): ThemeSetting | undefined {
  const trimmed = typeof value === "string" ? value.trim() : value;
  if (trimmed === "system") return "system";
  return trimmed && isDocumentThemeId(trimmed) ? trimmed : undefined;
}

export function resolveSystemTheme(): DocumentThemeId {
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return SYSTEM_DARK_THEME;
  }
  return SYSTEM_LIGHT_THEME;
}

export function resolveThemeSetting(setting: ThemeSetting): DocumentThemeId {
  return setting === "system" ? resolveSystemTheme() : setting;
}

export function readStoredThemeSetting(): ThemeSetting {
  if (typeof window === "undefined") return DEFAULT_THEME_SETTING;
  try {
    return parseThemeSetting(window.localStorage.getItem(THEME_STORAGE_KEY)) ?? DEFAULT_THEME_SETTING;
  } catch {
    return DEFAULT_THEME_SETTING;
  }
}

export function readStoredThemePreference(): ThemeSetting | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return parseThemeSetting(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

export function persistThemeSetting(setting: ThemeSetting): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, setting);
  } catch {
    // Storage is best-effort; live theme application should still work.
  }
}

export function applyThemeSetting(setting: ThemeSetting): DocumentThemeId {
  const resolvedTheme = resolveThemeSetting(setting);
  if (typeof document !== "undefined") {
    const colorScheme = documentColorSchemeForTheme(resolvedTheme);
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.themeSetting = setting;
    root.dataset.colorScheme = colorScheme;
    root.style.colorScheme = colorScheme;
  }
  return resolvedTheme;
}

export function emitThemeChange(setting: ThemeSetting, resolvedTheme = resolveThemeSetting(setting)): void {
  if (typeof window === "undefined") return;
  const detail = {
    setting,
    theme: resolvedTheme,
    colorScheme: documentColorSchemeForTheme(resolvedTheme),
  };
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail }));
  window.dispatchEvent(new CustomEvent(LEGACY_THEME_CHANGE_EVENT, { detail }));
}

export function commitThemeSetting(setting: ThemeSetting): DocumentThemeId {
  const normalized = normalizeThemeSetting(setting);
  persistThemeSetting(normalized);
  const resolved = applyThemeSetting(normalized);
  emitThemeChange(normalized, resolved);
  return resolved;
}

export function resolveEmbeddedThemeSetting(input: {
  hostTheme?: string | null;
  storedSetting?: ThemeSetting | null;
  defaultTheme?: DocumentThemeId;
} = {}): ThemeSetting {
  return parseThemeSetting(input.hostTheme)
    ?? input.storedSetting
    ?? input.defaultTheme
    ?? DEFAULT_DOCUMENT_THEME_ID;
}

export function applyEmbeddedThemeSetting(input: {
  hostTheme?: string | null;
  storedSetting?: ThemeSetting | null;
  defaultTheme?: DocumentThemeId;
} = {}): ThemeSetting {
  const setting = resolveEmbeddedThemeSetting({
    ...input,
    storedSetting: input.storedSetting ?? readStoredThemePreference() ?? null,
  });
  const resolved = applyThemeSetting(setting);
  emitThemeChange(setting, resolved);
  return setting;
}

export function initializeTheme(): ThemeSetting {
  const setting = readStoredThemeSetting();
  const resolved = applyThemeSetting(setting);
  emitThemeChange(setting, resolved);

  if (typeof window !== "undefined") {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const handleSystemChange = () => {
      if (readStoredThemeSetting() === "system") {
        const nextResolved = applyThemeSetting("system");
        emitThemeChange("system", nextResolved);
      }
    };
    media?.addEventListener?.("change", handleSystemChange);
  }

  return setting;
}

export { DEFAULT_DOCUMENT_THEME_ID, documentColorSchemeForTheme };
