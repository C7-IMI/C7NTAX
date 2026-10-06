/**
 * Outbound email HTML handling.
 *
 * The ticket composer sends rich text. Mail leaves the building to clients, so only a small tag
 * set survives: unknown tags are unwrapped (their text is kept) and anything that can execute —
 * script/style/iframe, `on*` handlers, `javascript:` URLs — is dropped, not escaped. Inline
 * styling is filtered to a safe property list so pasted markup cannot smuggle in positioning or
 * remote content.
 */

const EMAIL_TAGS = new Set([
  "p", "br", "div", "span", "strong", "b", "em", "i", "u", "s", "strike", "del", "sub", "sup",
  "ul", "ol", "li", "blockquote", "a", "h1", "h2", "h3", "h4", "hr", "pre", "code",
  "table", "thead", "tbody", "tr", "td", "th", "img",
]);
const EMAIL_VOID_TAGS = new Set(["br", "hr", "img"]);
const EMAIL_DROP_WITH_CONTENT = ["script", "style", "iframe", "object", "embed", "form", "svg", "template"];
const EMAIL_STYLE_PROPS = new Set([
  "color", "background-color", "font-size", "font-family", "font-weight", "font-style",
  "text-decoration", "text-align", "margin-left", "padding-left", "line-height",
]);
const EMAIL_SAFE_URL = /^(https?:|mailto:|tel:|cid:|\/)/i;
const MAX_HTML_LENGTH = 200_000;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}

function sanitizeStyle(value: string): string {
  return value
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const [property = "", ...rest] = declaration.split(":");
      const name = property.trim().toLowerCase();
      const val = rest.join(":").trim();
      if (!EMAIL_STYLE_PROPS.has(name) || !val) return "";
      if (/expression|javascript:|url\s*\(|@import/i.test(val)) return "";
      return `${name}: ${val}`;
    })
    .filter(Boolean)
    .join("; ");
}

function sanitizeAttrs(rawAttrs: string, tag: string): string {
  const out: string[] = [];
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(rawAttrs))) {
    const name = (match[1] ?? "").toLowerCase();
    const value = (match[2] ?? "").replace(/^["']|["']$/g, "");
    if (name.startsWith("on") || name === "srcdoc" || name === "style") continue;
    if ((name === "href" || name === "src") && !EMAIL_SAFE_URL.test(value.trim())) continue;
    if (name === "href" || name === "src") { out.push(`${name}="${escapeHtml(value.trim())}"`); continue; }
    if (tag === "a" && name === "target") { out.push('target="_blank"'); continue; }
    if (name === "colspan" || name === "rowspan" || name === "alt" || name === "title") {
      out.push(`${name}="${escapeHtml(value.slice(0, 200))}"`);
    }
  }
  const styleMatch = rawAttrs.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
  const style = styleMatch ? sanitizeStyle(styleMatch[2] ?? styleMatch[3] ?? styleMatch[4] ?? "") : "";
  if (style) out.push(`style="${escapeHtml(style)}"`);
  return out.length ? ` ${out.join(" ")}` : "";
}

/** Rewrites rich-text HTML into the subset that is safe to email. */
export function sanitizeEmailHtml(input: string): string {
  let html = String(input ?? "").slice(0, MAX_HTML_LENGTH);
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of EMAIL_DROP_WITH_CONTENT) {
    html = html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "");
    html = html.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), "");
  }

  const open: string[] = [];
  let result = "";
  let lastIndex = 0;
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    result += html.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;
    const closing = match[1] === "/";
    const tag = (match[2] ?? "").toLowerCase();
    if (!EMAIL_TAGS.has(tag)) continue; // unwrap: keep the text, drop the tag
    if (EMAIL_VOID_TAGS.has(tag)) { if (!closing) result += `<${tag}>`; continue; }
    if (closing) {
      const idx = open.lastIndexOf(tag);
      if (idx === -1) continue;
      for (let i = open.length - 1; i >= idx; i--) result += `</${open[i]}>`;
      open.length = idx;
      continue;
    }
    open.push(tag);
    result += `<${tag}${sanitizeAttrs(match[3] ?? "", tag)}>`;
  }
  result += html.slice(lastIndex);
  for (let i = open.length - 1; i >= 0; i--) result += `</${open[i]}>`;
  return result.trim();
}

/** Plain-text rendering of sanitised HTML, used for the multipart alternative and activity. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-4]|blockquote|tr)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
