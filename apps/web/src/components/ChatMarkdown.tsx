import { DiffsHighlighter, getSharedHighlighter, SupportedLanguages } from "@pierre/diffs";
import { CheckIcon, CopyIcon } from "lucide-react";
import type { ServerProviderSkill } from "@t3tools/contracts";
import React, {
  Children,
  Suspense,
  type MouseEvent as ReactMouseEvent,
  isValidElement,
  use,
  useCallback,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import { renderSkillInlineMarkdownChildren } from "./chat/SkillInlineText";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { openInPreferredEditor } from "../editorPreferences";
import {
  CODE_BLOCK_THEME_NAME,
  ensureCodeBlockThemeRegistered,
  type CodeBlockThemeName,
} from "../lib/diffRendering";
import { fnv1a32 } from "../lib/diffRendering";
import { LRUCache } from "../lib/lruCache";
import { useTheme } from "../hooks/useTheme";
import {
  normalizeMarkdownLinkDestination,
  resolveMarkdownFileLinkMeta,
  rewriteMarkdownFileUriHref,
} from "../markdown-links";
import { readLocalApi } from "../localApi";
import { cn } from "../lib/utils";

class CodeHighlightErrorBoundary extends React.Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

interface ChatMarkdownProps {
  text: string;
  cwd: string | undefined;
  isStreaming?: boolean;
  skills?: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
}

const EMPTY_MARKDOWN_SKILLS: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">> = [];

const CODE_FENCE_LANGUAGE_REGEX = /(?:^|\s)language-([^\s]+)/;
const MAX_HIGHLIGHT_CACHE_ENTRIES = 500;
const MAX_HIGHLIGHT_CACHE_MEMORY_BYTES = 50 * 1024 * 1024;
const highlightedCodeCache = new LRUCache<string>(
  MAX_HIGHLIGHT_CACHE_ENTRIES,
  MAX_HIGHLIGHT_CACHE_MEMORY_BYTES,
);
const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();

// T3CODE-FORK-MOD-BEGIN fork/chat-code-highlighting
const CPP_TYPE_COLOR = "#41c7ff";
const DEFAULT_CODE_TOKEN_COLOR_PATTERN = /^(?:#f4f4f4|rgb\(244,\s*244,\s*244\))$/i;
const CPP_LIKE_LANGUAGE_PATTERN = /^(?:c|cpp|c\+\+|h|hpp|cc|cxx)$/i;
const CPP_LIKE_TYPE_IDENTIFIER_PATTERN =
  /\b(?:bool|char|double|float|int|int8|int16|int32|int64|uint8|uint16|uint32|uint64|void|[AFISTU][A-Z]\w*)\b/g;
const INLINE_CODE_LANGUAGE_CANDIDATES = [
  "cpp",
  "ts",
  "tsx",
  "js",
  "json",
  "bash",
  "powershell",
  "text",
] as const;

type InlineCodeLanguage = (typeof INLINE_CODE_LANGUAGE_CANDIDATES)[number];
// T3CODE-FORK-MOD-END fork/chat-code-highlighting

function extractFenceLanguage(className: string | undefined): string {
  const match = className?.match(CODE_FENCE_LANGUAGE_REGEX);
  const raw = match?.[1] ?? "text";
  // Shiki doesn't bundle a gitignore grammar; ini is a close match (#685)
  return raw === "gitignore" ? "ini" : raw;
}

function nodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => nodeToPlainText(child)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeToPlainText(node.props.children);
  }
  return "";
}

// T3CODE-FORK-MOD-BEGIN fork/chat-code-highlighting
function hastNodeToPlainText(node: unknown): string {
  if (node == null || typeof node !== "object") return "";
  const maybeTextNode = node as { value?: unknown; children?: unknown };
  if (typeof maybeTextNode.value === "string") return maybeTextNode.value;
  if (Array.isArray(maybeTextNode.children)) {
    return maybeTextNode.children.map((child) => hastNodeToPlainText(child)).join("");
  }
  return "";
}
// T3CODE-FORK-MOD-END fork/chat-code-highlighting

function extractCodeBlock(
  children: ReactNode,
): { className: string | undefined; code: string } | null {
  const childNodes = Children.toArray(children);
  if (childNodes.length !== 1) {
    return null;
  }

  const onlyChild = childNodes[0];
  if (!isValidElement<{ className?: string; children?: ReactNode }>(onlyChild)) {
    return null;
  }

  return {
    className: onlyChild.props.className,
    code: nodeToPlainText(onlyChild.props.children),
  };
}

function createHighlightCacheKey(
  code: string,
  language: string,
  themeName: CodeBlockThemeName,
): string {
  return `${fnv1a32(code).toString(36)}:${code.length}:${language}:${themeName}`;
}

// T3CODE-FORK-MOD-BEGIN fork/chat-code-highlighting
function createInlineHighlightCacheKey(
  code: string,
  language: string,
  themeName: CodeBlockThemeName,
): string {
  return `inline:${createHighlightCacheKey(code, language, themeName)}`;
}
// T3CODE-FORK-MOD-END fork/chat-code-highlighting

function estimateHighlightedSize(html: string, code: string): number {
  return Math.max(html.length * 2, code.length * 3);
}

function getHighlighterPromise(language: string): Promise<DiffsHighlighter> {
  const cached = highlighterPromiseCache.get(language);
  if (cached) return cached;

  // T3CODE-FORK-MOD-BEGIN fork/chat-code-highlighting
  ensureCodeBlockThemeRegistered();
  const promise = getSharedHighlighter({
    themes: [CODE_BLOCK_THEME_NAME],
    langs: [language as SupportedLanguages],
    preferredHighlighter: "shiki-js",
  }).catch((err) => {
    // T3CODE-FORK-MOD-END fork/chat-code-highlighting
    highlighterPromiseCache.delete(language);
    if (language === "text") {
      // "text" itself failed — Shiki cannot initialize at all, surface the error
      throw err;
    }
    // Language not supported by Shiki — fall back to "text"
    return getHighlighterPromise("text");
  });
  highlighterPromiseCache.set(language, promise);
  return promise;
}

// T3CODE-FORK-MOD-BEGIN fork/chat-code-highlighting
function inferInlineCodeLanguage(code: string): InlineCodeLanguage {
  const trimmedCode = code.trim();
  if (trimmedCode.length === 0) return "text";
  if (/^(?:\{[\s\S]*\}|\[[\s\S]*\])$/.test(trimmedCode)) return "json";
  if (/\b(?:pwsh|powershell|Get-[A-Z]\w+|Set-[A-Z]\w+|Remove-[A-Z]\w+)\b/.test(trimmedCode)) {
    return "powershell";
  }
  if (/^(?:bun|npm|pnpm|yarn|git|cd|ls|rg|cat|mkdir|rm|cp|mv)\b/.test(trimmedCode)) {
    return "bash";
  }
  if (
    /(?:\b[A-ZUTAFS]\w*::|::|->|#include\b|\bstd::|<[A-Z]\w+>|\b(?:nullptr|constexpr|template)\b)/.test(
      trimmedCode,
    )
  ) {
    return "cpp";
  }
  if (/<[A-Z][\w.]*[\s>/]/.test(trimmedCode)) return "tsx";
  if (
    /\b(?:const|let|var|function|import|export|return|await|async|type|interface)\b|=>/.test(
      trimmedCode,
    )
  ) {
    return "ts";
  }
  if (/[.][a-zA-Z_$][\w$]*\(|\w+\([^)]*\)/.test(trimmedCode)) return "ts";
  return "text";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function shikiBlockHtmlToInlineHtml(html: string, fallbackCode: string): string {
  if (typeof document === "undefined") return escapeHtml(fallbackCode);

  const template = document.createElement("template");
  template.innerHTML = html;
  const codeElement = template.content.querySelector("code");
  if (!codeElement) return escapeHtml(fallbackCode);

  const lineElements = [...codeElement.querySelectorAll<HTMLElement>(".line")];
  if (lineElements.length === 0) return codeElement.innerHTML;
  return lineElements.map((lineElement) => lineElement.innerHTML).join("\n");
}

function isDefaultCodeTokenSpan(element: HTMLElement): boolean {
  const styleColor = element.style.color;
  return styleColor.length === 0 || DEFAULT_CODE_TOKEN_COLOR_PATTERN.test(styleColor);
}

function colorCppTypeIdentifiersInTextNode(textNode: Text): boolean {
  const text = textNode.data;
  CPP_LIKE_TYPE_IDENTIFIER_PATTERN.lastIndex = 0;
  const matches = [...text.matchAll(CPP_LIKE_TYPE_IDENTIFIER_PATTERN)];
  if (matches.length === 0) return false;

  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const match of matches) {
    const index = match.index ?? 0;
    if (index > cursor) {
      fragment.append(document.createTextNode(text.slice(cursor, index)));
    }

    const highlight = document.createElement("span");
    highlight.style.color = CPP_TYPE_COLOR;
    highlight.textContent = match[0];
    fragment.append(highlight);
    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    fragment.append(document.createTextNode(text.slice(cursor)));
  }

  textNode.replaceWith(fragment);
  return true;
}

function colorCppTypeIdentifiers(root: ParentNode) {
  const spans = [...root.querySelectorAll<HTMLElement>("span")];
  for (const span of spans) {
    if (!isDefaultCodeTokenSpan(span)) continue;

    const textNodes = [...span.childNodes].filter(
      (node): node is Text => node.nodeType === Node.TEXT_NODE,
    );
    for (const textNode of textNodes) {
      colorCppTypeIdentifiersInTextNode(textNode);
    }
  }
}

function postprocessHighlightedHtml(html: string, language: string): string {
  if (typeof document === "undefined" || !CPP_LIKE_LANGUAGE_PATTERN.test(language)) return html;

  const template = document.createElement("template");
  template.innerHTML = html;
  colorCppTypeIdentifiers(template.content);
  return template.innerHTML;
}
// T3CODE-FORK-MOD-END fork/chat-code-highlighting

function MarkdownCodeBlock({ code, children }: { code: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopy = useCallback(() => {
    if (typeof navigator === "undefined" || navigator.clipboard == null) {
      return;
    }
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        if (copiedTimerRef.current != null) {
          clearTimeout(copiedTimerRef.current);
        }
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, 1200);
      })
      .catch(() => undefined);
  }, [code]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    },
    [],
  );

  return (
    <div className="chat-markdown-codeblock leading-snug">
      <button
        type="button"
        className="chat-markdown-copy-button"
        onClick={handleCopy}
        title={copied ? "Copied" : "Copy code"}
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      </button>
      {children}
    </div>
  );
}

interface SuspenseShikiCodeBlockProps {
  className: string | undefined;
  code: string;
  themeName: CodeBlockThemeName;
  isStreaming: boolean;
}

function SuspenseShikiCodeBlock({
  className,
  code,
  themeName,
  isStreaming,
}: SuspenseShikiCodeBlockProps) {
  const language = extractFenceLanguage(className);
  const cacheKey = createHighlightCacheKey(code, language, themeName);
  const cachedHighlightedHtml = !isStreaming ? highlightedCodeCache.get(cacheKey) : null;

  if (cachedHighlightedHtml != null) {
    return (
      <div
        className="chat-markdown-shiki"
        dangerouslySetInnerHTML={{ __html: cachedHighlightedHtml }}
      />
    );
  }

  return (
    <UncachedShikiCodeBlock
      code={code}
      language={language}
      themeName={themeName}
      cacheKey={cacheKey}
      isStreaming={isStreaming}
    />
  );
}

interface UncachedShikiCodeBlockProps {
  code: string;
  language: string;
  themeName: CodeBlockThemeName;
  cacheKey: string;
  isStreaming: boolean;
}

function UncachedShikiCodeBlock({
  code,
  language,
  themeName,
  cacheKey,
  isStreaming,
}: UncachedShikiCodeBlockProps) {
  const highlighter = use(getHighlighterPromise(language));
  const highlightedHtml = useMemo(() => {
    try {
      return postprocessHighlightedHtml(
        highlighter.codeToHtml(code, { lang: language, theme: themeName }),
        language,
      );
    } catch (error) {
      // Log highlighting failures for debugging while falling back to plain text
      console.warn(
        `Code highlighting failed for language "${language}", falling back to plain text.`,
        error instanceof Error ? error.message : error,
      );
      // If highlighting fails for this language, render as plain text
      return highlighter.codeToHtml(code, { lang: "text", theme: themeName });
    }
  }, [code, highlighter, language, themeName]);

  useEffect(() => {
    if (!isStreaming) {
      highlightedCodeCache.set(
        cacheKey,
        highlightedHtml,
        estimateHighlightedSize(highlightedHtml, code),
      );
    }
  }, [cacheKey, code, highlightedHtml, isStreaming]);

  return (
    <div className="chat-markdown-shiki" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
  );
}

// T3CODE-FORK-MOD-BEGIN fork/chat-code-highlighting
interface SuspenseShikiInlineCodeProps {
  code: string;
  themeName: CodeBlockThemeName;
}

function SuspenseShikiInlineCode({ code, themeName }: SuspenseShikiInlineCodeProps) {
  const language = inferInlineCodeLanguage(code);
  const cacheKey = createInlineHighlightCacheKey(code, language, themeName);
  const cachedHighlightedHtml = highlightedCodeCache.get(cacheKey);

  if (cachedHighlightedHtml != null) {
    return (
      <code
        className="chat-markdown-inline-code chat-markdown-inline-shiki"
        dangerouslySetInnerHTML={{ __html: cachedHighlightedHtml }}
      />
    );
  }

  return (
    <UncachedShikiInlineCode
      code={code}
      language={language}
      themeName={themeName}
      cacheKey={cacheKey}
    />
  );
}

interface UncachedShikiInlineCodeProps {
  code: string;
  language: InlineCodeLanguage;
  themeName: CodeBlockThemeName;
  cacheKey: string;
}

function UncachedShikiInlineCode({
  code,
  language,
  themeName,
  cacheKey,
}: UncachedShikiInlineCodeProps) {
  const highlighter = use(getHighlighterPromise(language));
  const highlightedHtml = useMemo(() => {
    try {
      return shikiBlockHtmlToInlineHtml(
        postprocessHighlightedHtml(
          highlighter.codeToHtml(code, { lang: language, theme: themeName }),
          language,
        ),
        code,
      );
    } catch (error) {
      console.warn(
        `Inline code highlighting failed for language "${language}", falling back to plain text.`,
        error instanceof Error ? error.message : error,
      );
      return shikiBlockHtmlToInlineHtml(
        highlighter.codeToHtml(code, { lang: "text", theme: themeName }),
        code,
      );
    }
  }, [code, highlighter, language, themeName]);

  useEffect(() => {
    highlightedCodeCache.set(
      cacheKey,
      highlightedHtml,
      estimateHighlightedSize(highlightedHtml, code),
    );
  }, [cacheKey, code, highlightedHtml]);

  return (
    <code
      className="chat-markdown-inline-code chat-markdown-inline-shiki"
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
    />
  );
}

function PlainInlineCode({ children }: { children: ReactNode }) {
  return <code className="chat-markdown-inline-code">{children}</code>;
}
// T3CODE-FORK-MOD-END fork/chat-code-highlighting

interface MarkdownFileLinkProps {
  href: string;
  targetPath: string;
  displayPath: string;
  filePath: string;
  label: string;
  theme: "light" | "dark";
  className?: string | undefined;
}

const MARKDOWN_LINK_HREF_PATTERN = /\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
const MARKDOWN_FILE_LINK_CLASS_NAME =
  "chat-markdown-file-link relative top-[2px] max-w-full no-underline";
const MARKDOWN_FILE_LINK_ICON_CLASS_NAME = "chat-markdown-file-link-icon size-3.5 shrink-0";
const MARKDOWN_FILE_LINK_LABEL_CLASS_NAME = "chat-markdown-file-link-label truncate";

function pathParentSegments(path: string): string[] {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments.slice(0, -1);
}

function buildFileLinkParentSuffixByPath(filePaths: ReadonlyArray<string>): Map<string, string> {
  const groups = new Map<string, Set<string>>();
  for (const filePath of filePaths) {
    const pathSegments = filePath
      .replaceAll("\\", "/")
      .split("/")
      .filter((segment) => segment.length > 0);
    const basename = pathSegments[pathSegments.length - 1];
    if (!basename) continue;
    const group = groups.get(basename) ?? new Set<string>();
    group.add(filePath);
    groups.set(basename, group);
  }

  const suffixByPath = new Map<string, string>();
  for (const group of groups.values()) {
    const uniquePaths = [...group];
    if (uniquePaths.length < 2) continue;

    const parentSegmentsByPath = new Map(
      uniquePaths.map((filePath) => [filePath, pathParentSegments(filePath)]),
    );
    const minUniqueDepthByPath = new Map<string, number>();

    for (const filePath of uniquePaths) {
      const segments = parentSegmentsByPath.get(filePath) ?? [];
      let resolvedDepth = segments.length;
      for (let depth = 1; depth <= segments.length; depth += 1) {
        const candidate = segments.slice(-depth).join("/");
        const collision = uniquePaths.some((otherPath) => {
          if (otherPath === filePath) return false;
          const otherSegments = parentSegmentsByPath.get(otherPath) ?? [];
          return otherSegments.slice(-depth).join("/") === candidate;
        });
        if (!collision) {
          resolvedDepth = depth;
          break;
        }
      }
      minUniqueDepthByPath.set(filePath, resolvedDepth);
    }

    for (const filePath of uniquePaths) {
      const segments = parentSegmentsByPath.get(filePath) ?? [];
      if (segments.length === 0) continue;
      const minUniqueDepth = minUniqueDepthByPath.get(filePath) ?? 1;
      const suffixDepth = Math.min(segments.length, Math.max(minUniqueDepth, 2));
      suffixByPath.set(filePath, segments.slice(-suffixDepth).join("/"));
    }
  }

  return suffixByPath;
}

function extractMarkdownLinkHrefs(text: string): string[] {
  const hrefs: string[] = [];
  for (const match of text.matchAll(MARKDOWN_LINK_HREF_PATTERN)) {
    const href = match[1]?.trim();
    if (!href) continue;
    hrefs.push(href);
  }
  return hrefs;
}

function normalizeMarkdownLinkHrefKey(href: string): string {
  const normalizedHref = normalizeMarkdownLinkDestination(href);
  return rewriteMarkdownFileUriHref(normalizedHref) ?? normalizedHref;
}

const MarkdownFileLink = memo(function MarkdownFileLink({
  href,
  targetPath,
  displayPath,
  filePath,
  label,
  theme,
  className,
}: MarkdownFileLinkProps) {
  const handleOpen = useCallback(() => {
    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Open in editor is unavailable",
      });
      return;
    }

    void openInPreferredEditor(api, targetPath).catch((error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open file",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    });
  }, [targetPath]);

  const handleCopy = useCallback((value: string, title: string) => {
    if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Failed to copy ${title.toLowerCase()}`,
          description: "Clipboard API unavailable.",
        }),
      );
      return;
    }

    void navigator.clipboard.writeText(value).then(
      () => {
        toastManager.add({
          type: "success",
          title: `${title} copied`,
          description: value,
        });
      },
      (error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Failed to copy ${title.toLowerCase()}`,
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      },
    );
  }, []);

  const handleContextMenu = useCallback(
    async (event: ReactMouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const api = readLocalApi();
      if (!api) return;

      const clicked = await api.contextMenu.show(
        [
          { id: "open", label: "Open in editor" },
          { id: "copy-relative", label: "Copy relative path" },
          { id: "copy-full", label: "Copy full path" },
        ] as const,
        { x: event.clientX, y: event.clientY },
      );

      if (clicked === "open") {
        handleOpen();
        return;
      }
      if (clicked === "copy-relative") {
        handleCopy(displayPath, "Relative path");
        return;
      }
      if (clicked === "copy-full") {
        handleCopy(targetPath, "Full path");
      }
    },
    [displayPath, handleCopy, handleOpen, targetPath],
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={href}
            className={cn(MARKDOWN_FILE_LINK_CLASS_NAME, className)}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleOpen();
            }}
            onContextMenu={handleContextMenu}
          >
            <VscodeEntryIcon
              pathValue={filePath}
              kind="file"
              theme={theme}
              className={cn(MARKDOWN_FILE_LINK_ICON_CLASS_NAME, "text-current")}
            />
            <span className={MARKDOWN_FILE_LINK_LABEL_CLASS_NAME}>{label}</span>
          </a>
        }
      />
      <TooltipPopup
        side="top"
        className="max-w-[min(40rem,calc(100vw-2rem))] font-mono text-[11px] leading-tight"
      >
        <div className="markdown-file-link-tooltip-scroll overflow-x-auto whitespace-nowrap">
          {displayPath}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}, areMarkdownFileLinkPropsEqual);

function areMarkdownFileLinkPropsEqual(
  previous: Readonly<MarkdownFileLinkProps>,
  next: Readonly<MarkdownFileLinkProps>,
): boolean {
  return (
    previous.href === next.href &&
    previous.targetPath === next.targetPath &&
    previous.displayPath === next.displayPath &&
    previous.filePath === next.filePath &&
    previous.label === next.label &&
    previous.theme === next.theme &&
    previous.className === next.className
  );
}

function ChatMarkdown({
  text,
  cwd,
  isStreaming = false,
  skills = EMPTY_MARKDOWN_SKILLS,
}: ChatMarkdownProps) {
  const { resolvedTheme } = useTheme();
  const markdownFileLinkMetaByHref = useMemo(() => {
    const metaByHref = new Map<
      string,
      NonNullable<ReturnType<typeof resolveMarkdownFileLinkMeta>>
    >();
    for (const href of extractMarkdownLinkHrefs(text)) {
      const normalizedHref = normalizeMarkdownLinkHrefKey(href);
      if (metaByHref.has(normalizedHref)) continue;
      const meta = resolveMarkdownFileLinkMeta(normalizedHref, cwd);
      if (meta) {
        metaByHref.set(normalizedHref, meta);
      }
    }
    return metaByHref;
  }, [cwd, text]);
  const fileLinkParentSuffixByPath = useMemo(() => {
    const filePaths = [...markdownFileLinkMetaByHref.values()].map((meta) => meta.filePath);
    return buildFileLinkParentSuffixByPath(filePaths);
  }, [markdownFileLinkMetaByHref]);
  const markdownUrlTransform = useCallback((href: string) => {
    return rewriteMarkdownFileUriHref(href) ?? defaultUrlTransform(href);
  }, []);
  const markdownComponents = useMemo<Components>(
    () => ({
      p({ node: _node, children, ...props }) {
        return <p {...props}>{renderSkillInlineMarkdownChildren(children, skills)}</p>;
      },
      li({ node: _node, children, ...props }) {
        return <li {...props}>{renderSkillInlineMarkdownChildren(children, skills)}</li>;
      },
      a({ node: _node, href, ...props }) {
        const normalizedHref = href ? normalizeMarkdownLinkHrefKey(href) : "";
        const fileLinkMeta = normalizedHref ? markdownFileLinkMetaByHref.get(normalizedHref) : null;
        if (!fileLinkMeta) {
          return <a {...props} href={href} target="_blank" rel="noopener noreferrer" />;
        }

        const parentSuffix = fileLinkParentSuffixByPath.get(fileLinkMeta.filePath);
        const labelParts = [fileLinkMeta.basename];
        if (typeof parentSuffix === "string" && parentSuffix.length > 0) {
          labelParts.push(parentSuffix);
        }
        if (fileLinkMeta.line) {
          labelParts.push(
            `L${fileLinkMeta.line}${fileLinkMeta.column ? `:C${fileLinkMeta.column}` : ""}`,
          );
        }

        return (
          <MarkdownFileLink
            href={fileLinkMeta.targetPath}
            targetPath={fileLinkMeta.targetPath}
            displayPath={fileLinkMeta.displayPath}
            filePath={fileLinkMeta.filePath}
            label={labelParts.join(" · ")}
            theme={resolvedTheme}
            className={props.className}
          />
        );
      },
      pre({ node: _node, children, ...props }) {
        const codeBlock = extractCodeBlock(children);
        if (!codeBlock) {
          return <pre {...props}>{children}</pre>;
        }

        return (
          <MarkdownCodeBlock code={codeBlock.code}>
            <CodeHighlightErrorBoundary fallback={<pre {...props}>{children}</pre>}>
              <Suspense fallback={<pre {...props}>{children}</pre>}>
                <SuspenseShikiCodeBlock
                  className={codeBlock.className}
                  code={codeBlock.code}
                  themeName={CODE_BLOCK_THEME_NAME}
                  isStreaming={isStreaming}
                />
              </Suspense>
            </CodeHighlightErrorBoundary>
          </MarkdownCodeBlock>
        );
      },
      // T3CODE-FORK-MOD-BEGIN fork/chat-code-highlighting
      code({ node: _node, className, children, ...props }) {
        if (className) {
          return (
            <code {...props} className={className}>
              {children}
            </code>
          );
        }

        const code = nodeToPlainText(children) || hastNodeToPlainText(_node);
        return (
          <CodeHighlightErrorBoundary fallback={<PlainInlineCode>{children}</PlainInlineCode>}>
            <Suspense fallback={<PlainInlineCode>{children}</PlainInlineCode>}>
              <SuspenseShikiInlineCode code={code} themeName={CODE_BLOCK_THEME_NAME} />
            </Suspense>
          </CodeHighlightErrorBoundary>
        );
      },
      // T3CODE-FORK-MOD-END fork/chat-code-highlighting
    }),
    [fileLinkParentSuffixByPath, isStreaming, markdownFileLinkMetaByHref, resolvedTheme, skills],
  );

  // T3CODE-FORK-MOD-BEGIN fork/custom-theme
  return (
    <div className="chat-markdown w-full min-w-0 text-sm leading-relaxed text-[color:var(--chat-message-text)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
        urlTransform={markdownUrlTransform}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
  // T3CODE-FORK-MOD-END fork/custom-theme
}

export default memo(ChatMarkdown);
