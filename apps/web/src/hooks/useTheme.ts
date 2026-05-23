import { useCallback, useEffect, useSyncExternalStore } from "react";

type Theme = "light" | "dark" | "system";

// T3CODE-FORK-MOD-BEGIN fork/custom-theme
export type CustomThemeColorKey = "text" | "chatText" | "toolText";
export type CustomThemeColors = Partial<Record<CustomThemeColorKey, string>>;
export type CustomTheme = {
  enabled: boolean;
  colors: CustomThemeColors;
};
// T3CODE-FORK-MOD-END fork/custom-theme

type ThemeSnapshot = {
  theme: Theme;
  systemDark: boolean;
  // T3CODE-FORK-MOD-BEGIN fork/custom-theme
  customTheme: CustomTheme;
  customThemeKey: string;
  // T3CODE-FORK-MOD-END fork/custom-theme
};

const STORAGE_KEY = "t3code:theme";

// T3CODE-FORK-MOD-BEGIN fork/custom-theme
const CUSTOM_THEME_STORAGE_KEY = "t3code:custom-theme";
// T3CODE-FORK-MOD-END fork/custom-theme

const MEDIA_QUERY = "(prefers-color-scheme: dark)";

// T3CODE-FORK-MOD-BEGIN fork/custom-theme
const CUSTOM_THEME_COLOR_KEYS = ["text", "chatText", "toolText"] as const;
const CUSTOM_THEME_CSS_PROPERTIES: Record<CustomThemeColorKey, readonly string[]> = {
  text: ["--foreground"],
  chatText: ["--chat-message-text"],
  toolText: ["--tool-rendering-text"],
};
const DEFAULT_CUSTOM_THEME: CustomTheme = {
  enabled: false,
  colors: {},
};
const DEFAULT_THEME_SNAPSHOT: ThemeSnapshot = {
  theme: "system",
  systemDark: false,
  customTheme: DEFAULT_CUSTOM_THEME,
  customThemeKey: customThemeSnapshotKey(DEFAULT_CUSTOM_THEME),
};
// T3CODE-FORK-MOD-END fork/custom-theme

const THEME_COLOR_META_NAME = "theme-color";
const DYNAMIC_THEME_COLOR_SELECTOR = `meta[name="${THEME_COLOR_META_NAME}"][data-dynamic-theme-color="true"]`;

let listeners: Array<() => void> = [];
let lastSnapshot: ThemeSnapshot | null = null;
let lastDesktopTheme: Theme | null = null;

function emitChange() {
  for (const listener of listeners) listener();
}

function hasThemeStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function getSystemDark() {
  return typeof window !== "undefined" && window.matchMedia(MEDIA_QUERY).matches;
}

function getStored(): Theme {
  if (!hasThemeStorage()) return DEFAULT_THEME_SNAPSHOT.theme;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return DEFAULT_THEME_SNAPSHOT.theme;
}

// T3CODE-FORK-MOD-BEGIN fork/custom-theme
export function normalizeCustomThemeColor(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return null;

  const shortHexMatch = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (shortHexMatch) {
    const shortHex = shortHexMatch[1];
    if (!shortHex) return null;
    return `#${shortHex
      .split("")
      .map((character) => `${character}${character}`)
      .join("")}`;
  }

  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : null;
}

function normalizeCustomTheme(value: unknown): CustomTheme {
  if (!value || typeof value !== "object") {
    return DEFAULT_CUSTOM_THEME;
  }

  const record = value as Record<string, unknown>;
  const colorsRecord =
    record.colors && typeof record.colors === "object"
      ? (record.colors as Record<string, unknown>)
      : {};
  const colors: CustomThemeColors = {};

  for (const key of CUSTOM_THEME_COLOR_KEYS) {
    const color = normalizeCustomThemeColor(
      typeof colorsRecord[key] === "string" ? colorsRecord[key] : null,
    );
    if (color) {
      colors[key] = color;
    }
  }

  return {
    enabled: record.enabled === true,
    colors,
  };
}

function getStoredCustomTheme(): CustomTheme {
  if (!hasThemeStorage()) return DEFAULT_CUSTOM_THEME;
  const raw = localStorage.getItem(CUSTOM_THEME_STORAGE_KEY);
  if (!raw) return DEFAULT_CUSTOM_THEME;

  try {
    return normalizeCustomTheme(JSON.parse(raw));
  } catch {
    return DEFAULT_CUSTOM_THEME;
  }
}

function writeCustomTheme(customTheme: CustomTheme) {
  localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(customTheme));
}

function customThemeSnapshotKey(customTheme: CustomTheme): string {
  return JSON.stringify(customTheme);
}

export function isCustomThemeDefault(customTheme: CustomTheme): boolean {
  return (
    customThemeSnapshotKey(normalizeCustomTheme(customTheme)) ===
    customThemeSnapshotKey(DEFAULT_CUSTOM_THEME)
  );
}
// T3CODE-FORK-MOD-END fork/custom-theme

function ensureThemeColorMetaTag(): HTMLMetaElement {
  let element = document.querySelector<HTMLMetaElement>(DYNAMIC_THEME_COLOR_SELECTOR);
  if (element) {
    return element;
  }

  element = document.createElement("meta");
  element.name = THEME_COLOR_META_NAME;
  element.setAttribute("data-dynamic-theme-color", "true");
  document.head.append(element);
  return element;
}

function normalizeThemeColor(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim().toLowerCase();
  if (
    !normalizedValue ||
    normalizedValue === "transparent" ||
    normalizedValue === "rgba(0, 0, 0, 0)" ||
    normalizedValue === "rgba(0 0 0 / 0)"
  ) {
    return null;
  }

  return value?.trim() ?? null;
}

function resolveBrowserChromeSurface(): HTMLElement {
  return (
    document.querySelector<HTMLElement>("main[data-slot='sidebar-inset']") ??
    document.querySelector<HTMLElement>("[data-slot='sidebar-inner']") ??
    document.body
  );
}

export function syncBrowserChromeTheme() {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return;
  const surfaceColor = normalizeThemeColor(
    getComputedStyle(resolveBrowserChromeSurface()).backgroundColor,
  );
  const fallbackColor = normalizeThemeColor(getComputedStyle(document.body).backgroundColor);
  const backgroundColor = surfaceColor ?? fallbackColor;
  if (!backgroundColor) return;

  document.documentElement.style.backgroundColor = backgroundColor;
  document.body.style.backgroundColor = backgroundColor;
  ensureThemeColorMetaTag().setAttribute("content", backgroundColor);
}

// T3CODE-FORK-MOD-BEGIN fork/custom-theme
function applyCustomTheme(customTheme = getStoredCustomTheme()) {
  if (typeof document === "undefined") return;

  for (const properties of Object.values(CUSTOM_THEME_CSS_PROPERTIES)) {
    for (const property of properties) {
      document.documentElement.style.removeProperty(property);
    }
  }

  if (!customTheme.enabled) return;

  for (const key of CUSTOM_THEME_COLOR_KEYS) {
    const color = customTheme.colors[key];
    if (!color) continue;
    for (const property of CUSTOM_THEME_CSS_PROPERTIES[key]) {
      document.documentElement.style.setProperty(property, color);
    }
  }
}
// T3CODE-FORK-MOD-END fork/custom-theme

function applyTheme(theme: Theme, suppressTransitions = false) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  if (suppressTransitions) {
    document.documentElement.classList.add("no-transitions");
  }
  const isDark = theme === "dark" || (theme === "system" && getSystemDark());
  document.documentElement.classList.toggle("dark", isDark);
  // T3CODE-FORK-MOD-BEGIN fork/custom-theme
  applyCustomTheme();
  // T3CODE-FORK-MOD-END fork/custom-theme
  syncBrowserChromeTheme();
  syncDesktopTheme(theme);
  if (suppressTransitions) {
    // Force a reflow so the no-transitions class takes effect before removal
    // oxlint-disable-next-line no-unused-expressions
    document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("no-transitions");
    });
  }
}

function syncDesktopTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  const bridge = window.desktopBridge;
  if (!bridge || lastDesktopTheme === theme) {
    return;
  }

  lastDesktopTheme = theme;
  void bridge.setTheme(theme).catch(() => {
    if (lastDesktopTheme === theme) {
      lastDesktopTheme = null;
    }
  });
}

// Apply immediately on module load to prevent flash
if (typeof document !== "undefined" && hasThemeStorage()) {
  applyTheme(getStored());
}

function getSnapshot(): ThemeSnapshot {
  if (!hasThemeStorage()) return DEFAULT_THEME_SNAPSHOT;
  const theme = getStored();
  const systemDark = theme === "system" ? getSystemDark() : false;
  // T3CODE-FORK-MOD-BEGIN fork/custom-theme
  const customTheme = getStoredCustomTheme();
  const customThemeKey = customThemeSnapshotKey(customTheme);
  // T3CODE-FORK-MOD-END fork/custom-theme

  if (
    lastSnapshot &&
    lastSnapshot.theme === theme &&
    lastSnapshot.systemDark === systemDark &&
    // T3CODE-FORK-MOD-BEGIN fork/custom-theme
    lastSnapshot.customThemeKey === customThemeKey
    // T3CODE-FORK-MOD-END fork/custom-theme
  ) {
    return lastSnapshot;
  }

  // T3CODE-FORK-MOD-BEGIN fork/custom-theme
  lastSnapshot = { theme, systemDark, customTheme, customThemeKey };
  // T3CODE-FORK-MOD-END fork/custom-theme
  return lastSnapshot;
}

function getServerSnapshot() {
  return DEFAULT_THEME_SNAPSHOT;
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.push(listener);

  // Listen for system preference changes
  const mq = window.matchMedia(MEDIA_QUERY);
  const handleChange = () => {
    if (getStored() === "system") applyTheme("system", true);
    emitChange();
  };
  mq.addEventListener("change", handleChange);

  // Listen for storage changes from other tabs
  const handleStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      applyTheme(getStored(), true);
      emitChange();
    }
    // T3CODE-FORK-MOD-BEGIN fork/custom-theme
    if (e.key === CUSTOM_THEME_STORAGE_KEY) {
      applyCustomTheme(getStoredCustomTheme());
      emitChange();
    }
    // T3CODE-FORK-MOD-END fork/custom-theme
  };
  window.addEventListener("storage", handleStorage);

  return () => {
    listeners = listeners.filter((l) => l !== listener);
    mq.removeEventListener("change", handleChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const theme = snapshot.theme;
  // T3CODE-FORK-MOD-BEGIN fork/custom-theme
  const customTheme = snapshot.customTheme;
  // T3CODE-FORK-MOD-END fork/custom-theme

  const resolvedTheme: "light" | "dark" =
    theme === "system" ? (snapshot.systemDark ? "dark" : "light") : theme;

  const setTheme = useCallback((next: Theme) => {
    if (!hasThemeStorage()) return;
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next, true);
    emitChange();
  }, []);

  // T3CODE-FORK-MOD-BEGIN fork/custom-theme
  const setCustomTheme = useCallback((next: CustomTheme) => {
    if (!hasThemeStorage()) return;
    const normalized = normalizeCustomTheme(next);
    writeCustomTheme(normalized);
    applyCustomTheme(normalized);
    emitChange();
  }, []);

  const resetCustomTheme = useCallback(() => {
    setCustomTheme(DEFAULT_CUSTOM_THEME);
  }, [setCustomTheme]);
  // T3CODE-FORK-MOD-END fork/custom-theme

  // Keep DOM in sync on mount/change
  useEffect(() => {
    applyTheme(theme);
    // T3CODE-FORK-MOD-BEGIN fork/custom-theme
  }, [theme, customTheme]);
  // T3CODE-FORK-MOD-END fork/custom-theme

  // T3CODE-FORK-MOD-BEGIN fork/custom-theme
  return { theme, setTheme, resolvedTheme, customTheme, setCustomTheme, resetCustomTheme } as const;
  // T3CODE-FORK-MOD-END fork/custom-theme
}
