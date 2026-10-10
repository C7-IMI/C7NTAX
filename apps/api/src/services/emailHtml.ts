/**
 * Outbound email HTML handling.
 *
 * The ticket composer sends rich text. Mail leaves the building to clients, so only a small tag
 * set survives: unknown tags are unwrapped (their text is kept) and anything that can execute —
 * script/style/iframe, `on*` handlers, `javascript:` URLs — is dropped, not escaped. Inline
 * styling is filtered to a safe property list so pasted markup cannot smuggle in positioning or
 * remote content.
 */

/**
 * The tags a message may contain. Exported so a *check* can assert against this set rather than a copy
 * of it: `apps/api/src/email-studio-probe.ts` proves the renderer stays inside it, and a check holding
 * its own list would stop noticing the day the two drifted.
 */
export const EMAIL_TAGS = new Set([
  "p", "br", "div", "span", "strong", "b", "em", "i", "u", "s", "strike", "del", "sub", "sup",
  "ul", "ol", "li", "blockquote", "a", "h1", "h2", "h3", "h4", "hr", "pre", "code",
  "table", "thead", "tbody", "tr", "td", "th", "img",
]);
const EMAIL_VOID_TAGS = new Set(["br", "hr", "img"]);
const EMAIL_DROP_WITH_CONTENT = ["script", "style", "iframe", "object", "embed", "form", "svg", "template"];
/**
 * The inline style properties that survive; everything else is dropped rather than escaped.
 *
 * The set carries the **geometry** of a document as well as its type, and that is deliberate rather than
 * convenient. An inline style is the only styling a mail client is obliged to honour — a `<style>` block
 * is dropped with its content (see `EMAIL_DROP_WITH_CONTENT`) and Outlook's Word engine ignores one in
 * any case — so a property missing from this list is not a message made safer, it is a message that
 * arrives shapeless: without `padding` and `max-width` there is no way to say "a 600px card with an
 * inset body" and the words sit against the left edge of the reading pane, which is what the message
 * used to look like. This is the same reasoning that exempts `apps/web/src/components/reportKit.tsx`
 * from the design-token lint, and it is the test applied to each property here: a document that leaves
 * the building and must look the same whatever the reader's mail client does with it, compared with
 * what the *author* could reach with the theme — for these, there is genuinely no other way.
 *
 * What is still out is everything that can move, cover or hide *another* element, because this list is
 * also the composer's paste sanitiser (`routes/checklists.ts`, `routes/tickets/index.ts`) and pasted
 * markup is a stranger's clipboard rather than a document this product wrote: `position`,
 * `top`/`right`/`bottom`/`left`, `z-index`, `float`, `transform` and `opacity`. The `background`
 * shorthand is out too — `background-color` says the same thing without resetting the rest of the
 * shorthand. Every value is still refused if it carries `url(...)`, `expression`, `javascript:` or
 * `@import`, so nothing here can fetch or compute anything.
 */
export const EMAIL_STYLE_PROPS = new Set([
  // Type, colour and the words themselves.
  "color", "background-color", "font-size", "font-family", "font-weight", "font-style",
  "text-decoration", "text-align", "line-height", "letter-spacing", "text-transform", "white-space",
  // Geometry: the card, the body inset, and the boxes inside it.
  "max-width", "width", "box-sizing", "display", "vertical-align",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  // Rules and edges: a hairline under a header row, the accent on a quote.
  "border", "border-top", "border-right", "border-bottom", "border-left", "border-collapse", "border-radius",
]);
const EMAIL_SAFE_URL = /^(https?:|mailto:|tel:|cid:|\/)/i;
/** Inline images arrive as data URIs; they are pulled out into cid parts before sending. */
const EMAIL_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/=\s]+$/i;
/** Guard rail on the whole body; the API already caps request bodies at 10 MB. */
const MAX_HTML_LENGTH = 10_000_000;
/** Inline image limits — a message may embed a few screenshots, not a photo library. */
const MAX_INLINE_IMAGES = 20;
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_INLINE_IMAGE_TOTAL_BYTES = 8 * 1024 * 1024;
/** A 2 MB image is ~2.8 M base64 characters; anything longer is not an image we will embed. */
const MAX_INLINE_IMAGE_URI_LENGTH = Math.ceil((MAX_INLINE_IMAGE_BYTES / 3) * 4) + 64;

/** Escape text for interpolation into an HTML template. */
export function escapeHtml(value: string): string {
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
    if (name === "src" && tag === "img") {
      const uri = value.trim();
      if (uri.length <= MAX_INLINE_IMAGE_URI_LENGTH && EMAIL_DATA_IMAGE.test(uri)) { out.push(`src="${uri}"`); continue; }
      if (EMAIL_SAFE_URL.test(uri)) { out.push(`src="${escapeHtml(uri)}"`); continue; }
      continue;
    }
    if ((name === "href" || name === "src") && !EMAIL_SAFE_URL.test(value.trim())) continue;
    if (name === "href" || name === "src") { out.push(`${name}="${escapeHtml(value.trim())}"`); continue; }
    if (tag === "a" && name === "target") { out.push('target="_blank"'); continue; }
    if (name === "colspan" || name === "rowspan" || name === "alt" || name === "title") {
      out.push(`${name}="${escapeHtml(value.slice(0, 200))}"`);
    }
    if (tag === "img" && (name === "width" || name === "height") && /^\d{1,4}$/.test(value)) {
      out.push(`${name}="${value}"`);
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
    if (EMAIL_VOID_TAGS.has(tag)) {
      if (closing) continue;
      const attrs = sanitizeAttrs(match[3] ?? "", tag);
      // An image with no usable source is noise; drop it rather than email a broken placeholder.
      if (tag === "img" && !/\ssrc=/.test(attrs)) continue;
      result += `<${tag}${attrs}>`;
      continue;
    }
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
export interface InlineImage {
  cid: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
}

/**
 * Pulls data-URI images out of the message so they can travel as embedded MIME parts.
 * Mail clients block `data:` images (and Outlook renders none at all), so each one is replaced
 * with a `cid:` reference and sent alongside the message instead. Anything over the limits is
 * dropped rather than shipped, and the reference goes with it.
 */
export function extractInlineImages(html: string): { html: string; images: InlineImage[] } {
  const images: InlineImage[] = [];
  let total = 0;
  let index = 0;
  const result = html.replace(/src\s*=\s*"(data:image\/([a-z+]+);base64,([A-Za-z0-9+/=\s]+))"/gi, (match, _uri: string, subtype: string, base64: string) => {
    if (images.length >= MAX_INLINE_IMAGES) return "";
    const buffer = Buffer.from(base64.replace(/\s+/g, ""), "base64");
    if (!buffer.length || buffer.length > MAX_INLINE_IMAGE_BYTES || total + buffer.length > MAX_INLINE_IMAGE_TOTAL_BYTES) return "";
    total += buffer.length;
    const contentType = `image/${subtype === "jpeg" || subtype === "jpg" ? "jpeg" : subtype}`;
    const extension = contentType.split("/")[1] ?? "png";
    index += 1;
    const cid = `img-${index}-${Math.random().toString(36).slice(2, 10)}@c7ntax`;
    images.push({ cid, filename: `inline-${index}.${extension}`, contentType, buffer });
    return `src="cid:${cid}"`;
  });
  return { html: result, images };
}

export function htmlToText(html: string): string {  return html
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
