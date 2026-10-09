/**
 * Getting a document in — the conversion half of the import.
 *
 * The screen that uses this is `EmailImport.tsx`; this file has no React in it because the conversion
 * is the part worth being able to reason about (and to run) on its own.
 *
 * ── Two real front doors, one mapper ────────────────────────────────────────────────────────────────
 *
 * · **A paste** from any application, which arrives as `text/html` and is the same path the rich-text
 *   composer already takes: `cleanPastedHtml` from `components/richText` is the "Word-aware paste"
 *   precedent, and it is reused rather than re-written.
 * · **A `.docx`**, which is a zip: `word/document.xml` is read out of it, turned into the same HTML the
 *   paste path produces, and handed to the same mapper. The docx route is *not* a second conversion —
 *   it is a second door into one.
 *
 * ── What comes back is a mapping, not a conversion ──────────────────────────────────────────────────
 *
 * Every element is reported with its own disposition (`kept`, `reflowed`, `simplified`, `as an image`,
 * `moved`, `dropped`) and, where a person has a choice, the choice they hold. The output is a list of
 * `EmailBlock`s — the vocabulary the editor composes and `@C7NTAX/shared` defines — so nothing that
 * leaves here is an opaque "imported document".
 *
 * ── What the block set will not carry, and why that is said out loud ────────────────────────────────
 *
 * The shared block vocabulary is deliberately small: every kind in it is something that survives being
 * sent as plain text. It has no list kind, so a bulleted list lands as one line per item with its own
 * bullet; it has no column kind, so two columns become one in reading order; a footer block is the
 * brand's footer and carries no words of its own, so a page footer's words land as a paragraph. Each
 * of those is a row in the review table rather than a footnote, because the person importing is the
 * one who has to live with it.
 */
import { cleanPastedHtml } from "../richText";
import type { EmailBlock } from "./sendKit";

export type Disposition = "kept" | "reflowed" | "simplified" | "image" | "moved" | "dropped";

export interface MappingChoice {
  /** Headings: keep them as heading blocks, or flatten them to bold paragraphs. */
  headingStyle: "heading" | "bold";
  /** A table: keep it, or reflow its cells into one column of lines. */
  tableMode: "table" | "reflow";
  /** The document's own page footer: keep its words, or drop them. */
  pageFooter: "footer" | "drop";
  /** Photographs: embed them in the message as cid parts, or leave them out. */
  images: "embed" | "drop";
  /** Links: keep only the safe schemes, or take the words and leave the address behind. */
  links: "safe" | "unwrap";
  /** Footnotes: move their words into the body where they were referenced, or drop them. */
  footnotes: "move" | "drop";
}

export const DEFAULT_MAPPING: MappingChoice = {
  headingStyle: "heading",
  tableMode: "table",
  pageFooter: "footer",
  images: "embed",
  links: "safe",
  footnotes: "move",
};

export interface MappingRow {
  /** What is in the file, as the file has it. */
  element: string;
  /** What it becomes here. */
  becomes: string;
  disposition: Disposition;
  /** How many of them the file actually contained — a count is a claim, so it is the real one. */
  count: number;
  /** Set when the row is the result of a choice, so the table can say which. */
  chosen?: string;
}

export interface ImportOutcome {
  blocks: EmailBlock[];
  rows: MappingRow[];
  /** Things a person should know before saving: dropped remote images, discarded macros, refused links. */
  warnings: string[];
  /** The document's own page footer, when it had one. An email has no pages, so it can only be words. */
  footerText: string;
}

/** The ceilings the API's own sanitiser enforces on the way out (`apps/api/src/services/emailHtml.ts`). */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGES = 20;
const MAX_IMAGE_TOTAL_BYTES = 8 * 1024 * 1024;

/** `https`, `mailto`, `tel` and site-relative links travel; anything else is unwrapped. */
const SAFE_HREF = /^(https?:|mailto:|tel:|\/)/i;

const BLOCK_CHILDREN = ["p", "div", "table", "ul", "ol", "blockquote", "h1", "h2", "h3", "h4", "hr", "footer", "header"];

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char]!);
}

// ── One walk of one DOM ──────────────────────────────────────────────────────

interface Build {
  blocks: EmailBlock[];
  rows: Map<string, MappingRow>;
  warnings: string[];
  images: { count: number; total: number };
}

function note(build: Build, key: string, element: string, becomes: string, disposition: Disposition, chosen?: string): void {
  const existing = build.rows.get(key);
  if (existing) {
    existing.count += 1;
    return;
  }
  build.rows.set(key, { element, becomes, disposition, count: 1, chosen });
}

function newBuild(): Build {
  return { blocks: [], rows: new Map(), warnings: [], images: { count: 0, total: 0 } };
}

/** The HTML of one node, reduced to what the email sanitiser would keep. */
function inlineHtml(node: Node, build: Build, choices: MappingChoice): string {
  if (node.nodeType === Node.TEXT_NODE) return escape(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const inner = Array.from(el.childNodes).map((child) => inlineHtml(child, build, choices)).join("");
  switch (el.tagName.toLowerCase()) {
    case "strong": case "b": return `<strong>${inner}</strong>`;
    case "em": case "i": return `<em>${inner}</em>`;
    case "u": return `<u>${inner}</u>`;
    case "s": case "strike": case "del": return `<s>${inner}</s>`;
    case "sub": case "sup": case "code": return `<${el.tagName.toLowerCase()}>${inner}</${el.tagName.toLowerCase()}>`;
    case "br": return "<br>";
    case "pre": return `<pre>${inner}</pre>`;
    case "a": {
      const href = (el.getAttribute("href") ?? "").trim();
      if (choices.links === "unwrap" || !href || !SAFE_HREF.test(href)) {
        note(build, "links-unwrapped", "Links to anything else", "Their words, without the address", "reflowed", choices.links === "unwrap" ? "Unwrap all links" : undefined);
        return inner || escape(href);
      }
      note(build, "links", "Hyperlinks, email addresses, phone numbers", "Kept — and only https, mailto, tel and site-relative links", "kept", "Keep safe links");
      return `<a href="${escape(href)}">${inner}</a>`;
    }
    case "span": {
      const style = el.getAttribute("style") ?? "";
      const face = /font-family\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim();
      if (!face) return inner;
      note(build, "fonts", "An embedded or named display font", "The name survives in a font-family; the file does not travel and Outlook substitutes it", "simplified", "Keep the name");
      return `<span style="font-family:${escape(face)}">${inner}</span>`;
    }
    case "img": {
      const src = el.getAttribute("src") ?? "";
      if (!/^data:image\//i.test(src)) {
        note(build, "remote-images", "Clip art pointing at a web address", "Nothing — a mail client blocks remote images anyway", "dropped");
        return "";
      }
      return `<img src="${escape(src)}" alt="${escape(el.getAttribute("alt") ?? "")}">`;
    }
    default: return inner;
  }
}

function imageBlock(el: Element, build: Build, choices: MappingChoice): EmailBlock | null {
  const src = el.getAttribute("src") ?? "";
  const alt = (el.getAttribute("alt") ?? "").trim();
  if (choices.images === "drop") {
    note(build, "images-dropped", "Photographs", "Left out by choice", "dropped", "Leave them out");
    return null;
  }
  const bytes = Math.ceil(((src.length - src.indexOf(",") - 1) * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES || build.images.total + bytes > MAX_IMAGE_TOTAL_BYTES || build.images.count >= MAX_IMAGES) {
    note(build, "images-too-big", "Photographs over 2 MB, or past 20 and 8 MB in total", "Left out, and counted here rather than silently dropped", "dropped");
    return null;
  }
  build.images.count += 1;
  build.images.total += bytes;
  note(build, "images", "Photographs", "Embedded PNG/JPEG, 2 MB each, 20 maximum, 8 MB total", "image", "Embed");
  // An image always carries its words: a picture may not arrive, and a message must not depend on one.
  return { kind: "image", src, alt: alt || "Image from the imported document" };
}

function tableBlocks(table: Element, build: Build, choices: MappingChoice): EmailBlock[] {
  const rows = Array.from(table.querySelectorAll("tr"));
  const grid = rows.map((tr) => Array.from(tr.querySelectorAll("th,td")).map((cell) => inlineHtml(cell, build, choices).trim()));
  const filled = grid.filter((cells) => cells.some((cell) => cell.length > 0));
  if (!filled.length) return [];
  const width = Math.max(...filled.map((cells) => cells.length));
  const head = table.querySelector("thead th") ? filled.shift()! : null;
  if (choices.tableMode === "reflow" || width < 2) {
    note(build, "tables-reflowed", "A table used as a two-column layout", "One column, in reading order", "reflowed", "Reflow to one column");
    return filled.map((cells) => ({ kind: "paragraph" as const, html: cells.map((cell) => cell || "—").join(" · ") }));
  }
  note(build, "tables", "A table — including one used as a two-column layout", "Table block, kept as a table", "kept", "Keep as table");
  const columns = head && head.length === width
    ? head.map((cell) => cell.replace(/<[^>]+>/g, ""))
    : Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
  return [{ kind: "table", columns, rows: filled }];
}

/** `<p>`, `<div>` and anything else that may hold either words or pictures. */
function paragraphBlocks(el: Element, build: Build, choices: MappingChoice): EmailBlock[] {
  const out: EmailBlock[] = [];
  const textOnly = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const images = Array.from(el.children).filter((child) => child.tagName.toLowerCase() === "img");

  if (images.length && !textOnly) {
    for (const img of images) {
      const block = imageBlock(img, build, choices);
      if (block) out.push(block);
    }
    return out;
  }

  const only = el.children.length === 1 ? el.children[0] : null;
  if (only && only.tagName.toLowerCase() === "a" && textOnly && (only.textContent ?? "").trim() === textOnly) {
    const href = (only.getAttribute("href") ?? "").trim();
    if (href && SAFE_HREF.test(href) && choices.links === "safe") {
      note(build, "buttons", "A line that is only a link, with nothing around it", "A button block, so it reads as something to press", "kept");
      return [{ kind: "button", label: textOnly, href }];
    }
  }

  const inner = inlineHtml(el, build, choices).trim();
  if (images.length) {
    for (const img of images) {
      const block = imageBlock(img, build, choices);
      if (block) out.push(block);
    }
  }
  if (inner.replace(/<[^>]+>/g, "").trim() || /<img/i.test(inner)) {
    note(build, "paragraphs", "Body paragraphs", "Paragraph blocks, kept", "kept");
    out.push({ kind: "paragraph", html: inner });
  }
  return out;
}

/** True when a container holds block-level children, so a `<div>` wraps a document rather than a line. */
function holdsBlocks(el: Element): boolean {
  return Array.from(el.children).some((child) => BLOCK_CHILDREN.includes(child.tagName.toLowerCase()));
}

function walk(container: Element, build: Build, choices: MappingChoice): void {
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) build.blocks.push({ kind: "paragraph", html: escape(text) });
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4") {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (choices.headingStyle === "bold") {
        note(build, "headings-bold", "Headings 1–3, and Publisher's “Headline” style", "Bold paragraphs", "reflowed", "Bold paragraph");
        build.blocks.push({ kind: "paragraph", html: `<strong>${escape(text)}</strong>` });
      } else {
        note(build, "headings", "Headings 1–3, and Publisher's “Headline” style", "Heading blocks, kept", "kept", "Keep as heading");
        build.blocks.push({ kind: "heading", text, level: tag === "h1" ? 1 : 2 });
      }
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      const items = Array.from(el.querySelectorAll("li"));
      note(build, "lists", "Bulleted and numbered lists", "One line per item, each keeping its own bullet — the block set has no list kind", "reflowed");
      items.forEach((li, index) => {
        const line = inlineHtml(li, build, choices).trim();
        if (line) build.blocks.push({ kind: "paragraph", html: `${tag === "ol" ? `${index + 1}.` : "•"} ${line}` });
      });
      continue;
    }

    if (tag === "blockquote") {
      note(build, "quotes", "Pull quotes and quoted passages", "Quote blocks", "kept");
      const inner = inlineHtml(el, build, choices).trim();
      if (inner) build.blocks.push({ kind: "quote", html: inner });
      continue;
    }

    if (tag === "table") {
      build.blocks.push(...tableBlocks(el, build, choices));
      continue;
    }

    if (tag === "hr") {
      note(build, "rules", "A horizontal rule or a decorative divider", "A divider block", "kept");
      build.blocks.push({ kind: "divider" });
      continue;
    }

    if (tag === "img") {
      const block = imageBlock(el, build, choices);
      if (block) build.blocks.push(block);
      continue;
    }

    if (tag === "footer" || tag === "header") {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (tag === "footer" && text && choices.pageFooter === "footer") {
        note(build, "page-footers", "Page headers, footers and “Page 2 of 4”", "The footer's own words as a paragraph — an email has no pages, and a footer block is the brand's", "moved", "Keep the footer's words");
        build.blocks.push({ kind: "paragraph", html: escape(text) });
      } else {
        note(build, "page-headers", "Page headers, footers and “Page 2 of 4”", "Dropped: an email has no pages", "dropped", choices.pageFooter === "drop" ? "Drop" : undefined);
      }
      continue;
    }

    if (tag === "div") {
      if (holdsBlocks(el)) walk(el, build, choices);
      else build.blocks.push(...paragraphBlocks(el, build, choices));
      continue;
    }

    if (tag === "p") {
      build.blocks.push(...paragraphBlocks(el, build, choices));
      continue;
    }

    // Anything else that survived the sanitiser: its words, in a paragraph.
    const text = inlineHtml(el, build, choices).trim();
    if (text.replace(/<[^>]+>/g, "").trim()) build.blocks.push({ kind: "paragraph", html: text });
  }
}

/**
 * The mapper. One walk of one DOM, whatever door the HTML came in by.
 *
 * `footerText` is the document's own page footer, lifted out of a Word footer part by the caller.
 */
export function htmlToBlocks(input: string, choices: MappingChoice = DEFAULT_MAPPING, footerText = ""): ImportOutcome {
  const raw = String(input ?? "");
  const html = cleanPastedHtml(raw);
  const build = newBuild();

  if (/<script|on[a-z]+\s*=/i.test(raw)) {
    build.warnings.push("Script and event handlers were removed before anything was read.");
  }

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  walk(doc.body, build, choices);

  if (footerText.trim() && choices.pageFooter === "footer" && !build.rows.has("page-footers")) {
    note(build, "page-footers", "The document's own page footer", "Its words as a paragraph, because the page they belonged to is gone", "moved", "Keep the footer's words");
    build.blocks.push({ kind: "paragraph", html: escape(footerText.trim()) });
  }

  return { blocks: build.blocks, rows: Array.from(build.rows.values()), warnings: build.warnings, footerText: footerText.trim() };
}

/** The paste path: the same mapper, with the clipboard's own HTML as the source. */
export function pasteToBlocks(html: string, choices: MappingChoice = DEFAULT_MAPPING): ImportOutcome {
  return htmlToBlocks(html, choices);
}

// ── .docx ────────────────────────────────────────────────────────────────────

/** The zip entries this needs, read from the central directory rather than by guessing at headers. */
async function readZipEntries(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder();

  let eocd = -1;
  const lowest = Math.max(0, bytes.length - 65_557);
  for (let i = bytes.length - 22; i >= lowest; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("That file is not a zip, so it cannot be a .docx");

  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const entries = new Map<string, Uint8Array>();

  for (let index = 0; index < count && cursor + 46 <= bytes.length; index++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) break;
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    if (nameLength) {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const raw = bytes.subarray(start, start + compressedSize);
      entries.set(name, method === 0 ? raw : await inflateRaw(raw));
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** `deflate-raw` is what a zip entry uses. Reached through `globalThis` so no lib version matters. */
async function inflateRaw(raw: Uint8Array): Promise<Uint8Array> {
  const Ctor = (globalThis as unknown as { DecompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array> }).DecompressionStream;
  if (!Ctor) throw new Error("This browser cannot open a .docx — copy the document and paste it instead");
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new Ctor("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp",
  webp: "image/webp", tif: "image/tiff", tiff: "image/tiff",
};

function dataUri(name: string, bytes: Uint8Array): string {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
  let binary = "";
  for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]!);
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Word's own style names, mapped to the two heading levels the block set has. */
const HEADING_STYLE = /^heading\s*[1-4]$|^title$|^headline$/i;

/**
 * WordprocessingML → HTML.
 *
 * Not a general converter: it keeps what a person wrote and drops what a mail client would remove
 * anyway. Doing it here rather than after the fact is the point — anything it kept that Outlook then
 * strips would be a lie told twice.
 */
function documentXmlToHtml(
  xml: string,
  rels: Map<string, string>,
  footnotes: Map<string, string>,
  media: Map<string, Uint8Array>,
  footerParts: Map<string, string>,
  build: Build,
  choices: MappingChoice,
): { html: string; footerText: string } {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error("word/document.xml could not be read");
  }
  const root = doc.documentElement;
  // `word/document.xml` is a `w:document` wrapping one `w:body`; the content is inside the body, so
  // walking the root would walk one element and find nothing.
  const body = root.localName === "body" ? root : (Array.from(root.children).find((child) => child.localName === "body") ?? root);
  const parts: string[] = [];
  let footerText = "";

  const kids = (el: Element | null, name: string): Element[] => el ? Array.from(el.children).filter((child) => child.localName === name) : [];
  const one = (el: Element | null, name: string): Element | null => kids(el, name)[0] ?? null;
  const wAttr = (el: Element | null, name: string): string => el?.getAttribute(`w:${name}`) ?? el?.getAttribute(name) ?? "";
  const rAttr = (el: Element | null, name: string): string => el?.getAttribute(`r:${name}`) ?? el?.getAttribute(name) ?? "";

  const runHtml = (run: Element): string => {
    const props = one(run, "rPr");
    let text = "";
    for (const child of Array.from(run.children)) {
      switch (child.localName) {
        case "t":
          text += escape(child.textContent ?? "");
          break;
        case "br":
          text += "<br>";
          break;
        case "tab":
          text += " ";
          break;
        case "footnoteReference": {
          const id = wAttr(child, "id");
          const body = footnotes.get(id);
          if (body && choices.footnotes === "move") {
            text += `[${escape(body)}]`;
            note(build, "footnotes", "Footnotes and endnotes", "Moved into the body as bracketed text at the point they were referenced", "moved", "Move into the body");
          } else if (body || id) {
            note(build, "footnotes-dropped", "Footnotes and endnotes", "Dropped by choice", "dropped", "Drop");
          }
          break;
        }
        case "drawing": case "pict": {
          const blip = child.getElementsByTagName("a:blip")[0] ?? child.getElementsByTagName("v:imagedata")[0];
          const relId = rAttr(blip ?? null, "embed") || rAttr(blip ?? null, "id");
          const target = rels.get(relId);
          const bytes = target ? media.get(target) : undefined;
          if (bytes && choices.images !== "drop") {
            if (bytes.length > MAX_IMAGE_BYTES || build.images.total + bytes.length > MAX_IMAGE_TOTAL_BYTES || build.images.count >= MAX_IMAGES) {
              note(build, "images-too-big", "Photographs over 2 MB, or past 20 and 8 MB in total", "Left out, and counted here rather than silently dropped", "dropped");
            } else {
              build.images.count += 1;
              build.images.total += bytes.length;
              note(build, "vector-art", "Vector art: the logo, a swirl, SmartArt, WordArt", "One PNG, embedded as a cid part, so it is crisp at the width it was flattened at", "image", "Embed");
              text += `<img src="${dataUri(target!, bytes)}" alt="">`;
            }
          } else {
            note(build, "drawings", "An embedded object or art that could not be read", "Dropped as an object rather than half-carried", "dropped");
          }
          break;
        }
        default:
          break;
      }
    }
    if (props && text) {
      if (one(props, "b")) text = `<strong>${text}</strong>`;
      if (one(props, "i")) text = `<em>${text}</em>`;
      if (one(props, "u")) text = `<u>${text}</u>`;
      if (one(props, "strike")) text = `<s>${text}</s>`;
      const script = wAttr(one(props, "vertAlign"), "val");
      if (script === "superscript") text = `<sup>${text}</sup>`;
      if (script === "subscript") text = `<sub>${text}</sub>`;
      const color = wAttr(one(props, "color"), "val");
      const font = wAttr(one(props, "rFonts"), "ascii");
      if (font && !build.rows.has("fonts")) {
        note(build, "fonts", "An embedded or named display font", "The name survives in a font-family; the file does not travel and Outlook substitutes it", "simplified", "Keep the name");
      }
      const style: string[] = [];
      if (color && /^[0-9a-f]{6}$/i.test(color) && color.toLowerCase() !== "auto") style.push(`color:#${color}`);
      if (style.length) text = `<span style="${style.join(";")}">${text}</span>`;
    }
    return text;
  };

  const paragraph = (el: Element): { html: string; style: string } => {
    const props = one(el, "pPr");
    const style = wAttr(one(props, "pStyle"), "val");
    let inline = "";
    for (const child of Array.from(el.children)) {
      if (child.localName === "r") inline += runHtml(child);
      else if (child.localName === "ins") inline += kids(child, "r").map(runHtml).join("");
      else if (child.localName === "del") {
        note(build, "tracked-changes", "Tracked changes, comments, revision marks, speaker notes", "Dropped, and named here so nobody wonders where they went", "dropped");
      } else if (child.localName === "hyperlink") {
        const target = rels.get(rAttr(child, "id"));
        const text = kids(child, "r").map(runHtml).join("");
        inline += target && SAFE_HREF.test(target) && choices.links === "safe" ? `<a href="${escape(target)}">${text}</a>` : text;
      }
    }
    return { html: inline, style };
  };

  const headingLevel = (style: string): number => (/heading\s*[34]/i.test(style) ? 3 : /heading\s*2/i.test(style) ? 2 : 1);

  const walkBody = (container: Element): void => {
    for (const child of Array.from(container.children)) {
      if (child.localName === "del") continue; // a deleted run is not in the document
      if (child.localName === "p") {
        const { html, style } = paragraph(child);
        if (!html.trim()) continue;
        if (HEADING_STYLE.test(style) && choices.headingStyle === "heading") {
          note(build, "headings", "Headings 1–3, and Publisher's “Headline” style", "Heading blocks, kept", "kept", "Keep as heading");
          const level = headingLevel(style);
          parts.push(`<h${level}>${html}</h${level}>`);
        } else if (HEADING_STYLE.test(style)) {
          note(build, "headings-bold", "Headings 1–3, and Publisher's “Headline” style", "Bold paragraphs", "reflowed", "Bold paragraph");
          parts.push(`<p><strong>${html.replace(/<[^>]+>/g, "")}</strong></p>`);
        } else {
          parts.push(`<p>${html}</p>`);
        }
        continue;
      }
      if (child.localName === "tbl") {
        const rows = kids(child, "tr").map((tr) => `<tr>${kids(tr, "tc").map((tc) => `<td>${kids(tc, "p").map((p) => paragraph(p).html).join("<br>")}</td>`).join("")}</tr>`);
        parts.push(`<table><tbody>${rows.join("")}</tbody></table>`);
        continue;
      }
      if (child.localName === "sectPr") {
        const columns = one(child, "cols");
        if (columns && Number(wAttr(columns, "num")) > 1) {
          note(build, "columns", "Two real columns", "One column, text in reading order", "reflowed", "Reflow (only option)");
        }
        const footerRef = one(child, "footerReference");
        const target = rels.get(rAttr(footerRef, "id"));
        const words = target ? footerParts.get(target) : undefined;
        if (words) footerText = words;
        if (one(child, "headerReference")) {
          note(build, "page-headers", "Page headers, footers and “Page 2 of 4”", "Dropped: an email has no pages", "dropped");
        }
        continue;
      }
      if (child.localName === "ins") walkBody(child);
    }
  };

  walkBody(body);
  return { html: parts.join("\n"), footerText };
}

/** Reads a `.docx` into blocks. Throws with a readable reason when the file is not one. */
export async function docxToBlocks(file: File, choices: MappingChoice = DEFAULT_MAPPING): Promise<ImportOutcome> {
  const entries = await readZipEntries(await file.arrayBuffer());
  const documentXml = entries.get("word/document.xml");
  if (!documentXml) {
    throw new Error(`${file.name} has no word/document.xml — a .doc, .pub or .pptx is a different format`);
  }

  const decoder = new TextDecoder();
  const rels = new Map<string, string>();
  const relsXml = entries.get("word/_rels/document.xml.rels");
  if (relsXml) {
    const relDoc = new DOMParser().parseFromString(decoder.decode(relsXml), "application/xml");
    for (const rel of Array.from(relDoc.getElementsByTagName("Relationship"))) {
      const id = rel.getAttribute("Id") ?? "";
      let target = rel.getAttribute("Target") ?? "";
      if (target.startsWith("/")) target = target.slice(1);
      else if (!target.startsWith("word/")) target = `word/${target}`;
      if (id) rels.set(id, target);
    }
  }

  const footnotes = new Map<string, string>();
  const footnotesXml = entries.get("word/footnotes.xml");
  if (footnotesXml) {
    const notesDoc = new DOMParser().parseFromString(decoder.decode(footnotesXml), "application/xml");
    for (const footnote of Array.from(notesDoc.getElementsByTagName("w:footnote"))) {
      const id = footnote.getAttribute("w:id") ?? footnote.getAttribute("id") ?? "";
      const body = Array.from(footnote.getElementsByTagName("w:t")).map((t) => t.textContent ?? "").join("").replace(/\s+/g, " ").trim();
      if (id && body) footnotes.set(id, body);
    }
  }

  const footerParts = new Map<string, string>();
  const media = new Map<string, Uint8Array>();
  for (const [name, bytes] of entries) {
    if (/^word\/footer\d*\.xml$/.test(name)) {
      const footerDoc = new DOMParser().parseFromString(decoder.decode(bytes), "application/xml");
      const words = Array.from(footerDoc.getElementsByTagName("w:t")).map((t) => t.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
      if (words) footerParts.set(name, words);
    }
    if (/^word\/media\//.test(name)) media.set(name, bytes);
  }

  const build = newBuild();
  if (entries.has("word/vbaProject.bin")) {
    note(build, "macros", "A macro project in a .docm", "Discarded before anything is read — the document is treated as read-only", "dropped", "Discard macros (only option)");
    build.warnings.push("This document carries macros. They were discarded before anything was read.");
  }

  const { html, footerText } = documentXmlToHtml(decoder.decode(documentXml), rels, footnotes, media, footerParts, build, choices);
  const mapped = htmlToBlocks(html, choices, footerText);
  const merged = new Map(build.rows);
  for (const entry of mapped.rows) {
    const existing = merged.get(entry.element);
    if (existing) existing.count += entry.count;
    else merged.set(entry.element, entry);
  }
  return {
    blocks: mapped.blocks,
    rows: Array.from(merged.values()),
    warnings: [...build.warnings, ...mapped.warnings],
    footerText,
  };
}
