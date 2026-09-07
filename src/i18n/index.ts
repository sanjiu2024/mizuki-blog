import zh from "./zh.json";
import en from "./en.json";

export const defaultLang = "zh" as const;
export const locales = ["zh", "en"] as const;
export type Lang = (typeof locales)[number];

const dicts: Record<Lang, Record<string, string>> = { zh, en };

export function isLang(value: unknown): value is Lang {
  return value === "zh" || value === "en";
}

/** Resolve language from URL: /en/... → "en", everything else → "zh" (default). */
export function getLangFromUrl(url: URL | string): Lang {
  const pathname = typeof url === "string" ? url : url.pathname;
  const first = pathname.split("/").filter(Boolean)[0];
  return first === "en" ? "en" : "zh";
}

/** Resolve language from Astro.url + optional ?lang= cookie/query override. */
export function resolveLang(url: URL | string, override?: string | null): Lang {
  if (override && isLang(override)) return override;
  return getLangFromUrl(url);
}

/** Translate a key, with {var} interpolation. Falls back to zh, then the key itself. */
export function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const template = dicts[lang]?.[key] ?? dicts[defaultLang]?.[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : m,
  );
}

/** Build a t() bound to a language: const _ = createTranslator(lang); _("nav.home") */
export function createTranslator(lang: Lang) {
  return (key: string, vars?: Record<string, string | number>) => t(lang, key, vars);
}

/**
 * Map current path to the other language's equivalent.
 * - zh → en: "/" → "/en/", "/tags" → "/en/tags"
 * - en → zh: "/en/tags" → "/tags", "/en/" → "/"
 * Preserves query string + hash.
 */
export function switchLangPath(currentPath: string, target: Lang): string {
  const [pathAndQuery] = [currentPath];
  const qIndex = pathAndQuery.indexOf("?");
  const hIndex = pathAndQuery.indexOf("#");
  let path = pathAndQuery;
  let suffix = "";
  const cut = Math.min(
    qIndex === -1 ? path.length : qIndex,
    hIndex === -1 ? path.length : hIndex,
  );
  path = pathAndQuery.slice(0, cut);
  suffix = pathAndQuery.slice(cut);
  if (target === "en") {
    if (path === "/") return `/en/${suffix}`;
    if (path.startsWith("/en/") || path === "/en") return `${path}${suffix}`;
    return `/en${path}${suffix}`;
  }
  // target zh: strip /en prefix
  if (path === "/en" || path === "/en/") return `/${suffix}`;
  if (path.startsWith("/en/")) return `${path.slice(3)}${suffix}`;
  return `${path}${suffix}`;
}

/** Language attributes for <html>: zh → zh-CN, en → en. */
export function htmlLang(lang: Lang): string {
  return lang === "zh" ? "zh-CN" : "en";
}
