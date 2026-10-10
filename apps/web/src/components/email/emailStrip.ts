/**
 * The editor's copy of the mail sanitiser's rules — what a pasted element would lose *before* it is
 * sent, rather than after a client has read it.
 *
 * **`apps/api/src/services/emailHtml.ts` is the authority, not this file.** The lists below are its
 * lists, repeated here so the canvas can *draw* its decision while somebody is editing: the API
 * cannot answer "what would you strip?" without being handed the markup, and a round trip per
 * keystroke would make the editor unusable. The reason the two must agree is that a canvas which
 * keeps something the send path removes is a canvas that lies about the message.
 *
 * What it reports, in the sanitiser's own vocabulary:
 *
 *  · **unwrapped** — the tag is not in the 30-tag set, so the tag goes and the text is kept;
 *  · **dropped** — `script`, `style`, `iframe`, `object`, `embed`, `form`, `svg` and `template` are
 *    removed *with everything inside them*;
 *  · **attribute** — every `on*` handler and every `srcdoc` is refused, and a `style` value is
 *    filtered declaration by declaration against the 34 allowed properties;
 *  · **url** — a link or image that is not `https:`, `mailto:`, `tel:`, `cid:` or a path is refused
 *    rather than escaped, so `javascript:` never becomes a link.
 */

const EMAIL_TAGS = new Set([
  "p", "br", "div", "span", "strong", "b", "em", "i", "u", "s", "strike", "del", "sub", "sup",
  "ul", "ol", "li", "blockquote", "a", "h1", "h2", "h3", "h4", "hr", "pre", "code",
  "table", "thead", "tbody", "tr", "td", "th", "img",
]);
const EMAIL_DROP_WITH_CONTENT = ["script", "style", "iframe", "object", "embed", "form", "svg", "template"];
const EMAIL_STYLE_PROPS = new Set([
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
const EMAIL_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i;

/** The tag set, as a sentence, for the panel that explains what happened to a pasted element. */
export const SAFE_TAGS_SENTENCE = [...EMAIL_TAGS].join(" ");
export const SAFE_STYLE_SENTENCE = [...EMAIL_STYLE_PROPS].join(" ");
export const DROP_WITH_CONTENT_SENTENCE = EMAIL_DROP_WITH_CONTENT.join(", ");

export type StripReason = "unwrapped" | "dropped" | "style" | "attribute" | "url";

export interface StripRemoval {
  reason: StripReason;
  /** What went — the tag name, the attribute, the property. */
  what: string;
  /** Why, in the sanitiser's own terms, so the panel can be read without the source. */
  why: string;
}

export interface StripInspection {
  /** The markup as it would leave the building. */
  html: string;
  /** Everything that would not survive, in the order it was found. */
  removals: StripRemoval[];
}

const REASON_WHY: Record<StripReason, string> = {
  unwrapped: "not in the tag set, so the tag goes and the text is kept",
  dropped: "removed with everything inside it, because it can execute or fetch",
  style: "not one of the allowed style properties, so the declaration goes",
  attribute: "an event handler is refused outright, never escaped",
  url: "refused, because a link must be https, mailto, tel, cid or a path",
};

function cleanElement(element: Element, removals: StripRemoval[]): void {
  for (const child of [...element.children]) {
    const tag = child.tagName.toLowerCase();
    if (EMAIL_DROP_WITH_CONTENT.includes(tag)) {
      removals.push({ reason: "dropped", what: tag, why: REASON_WHY.dropped });
      child.remove();
      continue;
    }
    if (!EMAIL_TAGS.has(tag)) {
      removals.push({ reason: "unwrapped", what: tag, why: REASON_WHY.unwrapped });
      cleanElement(child, removals);
      child.replaceWith(...[...child.childNodes]);
      continue;
    }
    for (const attr of [...child.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc") {
        removals.push({ reason: "attribute", what: name, why: REASON_WHY.attribute });
        child.removeAttribute(attr.name);
        continue;
      }
      if (name === "style") {
        const kept = attr.value
          .split(";")
          .map((declaration) => declaration.trim())
          .filter(Boolean)
          .filter((declaration) => {
            const [property = "", ...rest] = declaration.split(":");
            const value = rest.join(":").trim();
            const propertyName = property.trim().toLowerCase();
            const ok = EMAIL_STYLE_PROPS.has(propertyName) && !!value;
            if (!ok) {
              removals.push({
                reason: "style",
                what: propertyName || declaration,
                why: REASON_WHY.style,
              });
              return false;
            }
            return true;
          })
          .join("; ");
        if (kept) child.setAttribute("style", kept);
        else child.removeAttribute("style");
        continue;
      }
      if (name === "href" || name === "src") {
        const value = attr.value.trim();
        const allowed =
          tag === "img" && EMAIL_DATA_IMAGE.test(value)
            ? true
            : EMAIL_SAFE_URL.test(value);
        if (!allowed) {
          removals.push({ reason: "url", what: `${name}="${value.slice(0, 60)}"`, why: REASON_WHY.url });
          child.removeAttribute(attr.name);
        }
        continue;
      }
      if (["target", "width", "height", "alt", "title", "colspan", "rowspan"].includes(name)) continue;
      removals.push({ reason: "attribute", what: name, why: "not part of the mail vocabulary" });
      child.removeAttribute(attr.name);
    }
    cleanElement(child, removals);
  }
}

/**
 * What the send path would keep of a piece of pasted markup, and what it would remove.
 *
 * Ran over every paragraph's HTML while it is being edited, so the removal is shown at editing time
 * with its reason instead of being discovered after the client has read the message.
 */
export function inspectPastedHtml(input: string): StripInspection {
  if (typeof DOMParser === "undefined") return { html: input, removals: [] };
  const document_ = new DOMParser().parseFromString(`<body><div id="c7-strip-root"></div></body>`, "text/html");
  const root = document_.getElementById("c7-strip-root");
  if (!root) return { html: input, removals: [] };
  root.innerHTML = input;
  const removals: StripRemoval[] = [];
  cleanElement(root, removals);
  return { html: root.innerHTML, removals };
}

/** How a removal reads in the panel: one sentence per finding. */
export function describeRemoval(removal: StripRemoval): string {
  const verb = removal.reason === "unwrapped" ? "Unwrapped" : removal.reason === "dropped" ? "Dropped" : removal.reason === "url" ? "Refused" : "Removed";
  return `${verb} ${removal.what} — ${removal.why}.`;
}
