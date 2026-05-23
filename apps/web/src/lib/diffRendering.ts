import { RegisteredCustomThemes, registerCustomTheme } from "@pierre/diffs";

export const DIFF_THEME_NAMES = {
  light: "pierre-light",
  dark: "pierre-dark",
} as const;

export type DiffThemeName = (typeof DIFF_THEME_NAMES)[keyof typeof DIFF_THEME_NAMES];

// T3CODE-FORK-MOD-BEGIN fork/chat-code-highlighting
export const CODE_BLOCK_THEME_NAME = "t3code-ember-dark" as const;
export type CodeBlockThemeName = typeof CODE_BLOCK_THEME_NAME;

const CODE_BLOCK_THEME = {
  name: CODE_BLOCK_THEME_NAME,
  type: "dark" as const,
  colors: {
    "editor.background": "#191919",
    "editor.foreground": "#f4f4f4",
  },
  tokenColors: [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#6A9955", fontStyle: "italic" },
    },
    {
      scope: [
        "keyword",
        "storage",
        "constant.language",
        "constant.language.boolean",
        "constant.language.null",
      ],
      settings: { foreground: "#ff007c" },
    },
    {
      scope: ["storage.type", "storage.type.primitive"],
      settings: { foreground: "#58c7ff" },
    },
    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "entity.name.namespace",
        "entity.name.scope-resolution",
        "support.type",
        "support.class",
        "support.type.property-name",
        "meta.qualified_type",
      ],
      settings: { foreground: "#41c7ff" },
    },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call entity.name.function",
      ],
      settings: { foreground: "#7ee22a" },
    },
    {
      scope: ["variable.parameter", "meta.function.parameters variable.other"],
      settings: { foreground: "#ff9800" },
    },
    {
      scope: ["variable.other.member", "variable.other.property"],
      settings: { foreground: "#f4f4f4" },
    },
    {
      scope: ["string", "punctuation.definition.string"],
      settings: { foreground: "#ffd866" },
    },
    {
      scope: ["constant.numeric"],
      settings: { foreground: "#ff4fa3" },
    },
    {
      scope: ["keyword.operator"],
      settings: { foreground: "#ff007c" },
    },
    {
      scope: ["punctuation", "meta.brace"],
      settings: { foreground: "#f4f4f4" },
    },
  ],
};

export function ensureCodeBlockThemeRegistered() {
  if (RegisteredCustomThemes.has(CODE_BLOCK_THEME_NAME)) return;
  registerCustomTheme(CODE_BLOCK_THEME_NAME, async () => CODE_BLOCK_THEME);
}
// T3CODE-FORK-MOD-END fork/chat-code-highlighting

export function resolveDiffThemeName(theme: "light" | "dark"): DiffThemeName {
  return theme === "dark" ? DIFF_THEME_NAMES.dark : DIFF_THEME_NAMES.light;
}

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
const SECONDARY_HASH_SEED = 0x9e3779b9;
const SECONDARY_HASH_MULTIPLIER = 0x85ebca6b;

export function fnv1a32(
  input: string,
  seed = FNV_OFFSET_BASIS_32,
  multiplier = FNV_PRIME_32,
): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, multiplier) >>> 0;
  }
  return hash >>> 0;
}

export function buildPatchCacheKey(patch: string, scope = "diff-panel"): string {
  const normalizedPatch = patch.trim();
  const primary = fnv1a32(normalizedPatch, FNV_OFFSET_BASIS_32, FNV_PRIME_32).toString(36);
  const secondary = fnv1a32(
    normalizedPatch,
    SECONDARY_HASH_SEED,
    SECONDARY_HASH_MULTIPLIER,
  ).toString(36);
  return `${scope}:${normalizedPatch.length}:${primary}:${secondary}`;
}
