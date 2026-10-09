/**
 * The renderer — blocks in, a message out.
 *
 * There is **one** implementation and it is reached over the API (`POST /api/email/preview`), so the
 * preview a person approves against a real record is literally the message that goes out. It is not a
 * second code path that approximates the first; that is the mistake the report designer already made
 * once and now says so at the top of `reportKit.tsx`.
 *
 * Three rules are worth stating before the code, because everything below follows from them.
 *
 * 1. **The markup stays inside the allowlist.** Every tag and every style property this file emits is
 *    one `apps/api/src/services/emailHtml.ts` keeps, and the finished document goes through
 *    `sanitizeEmailHtml` like any other outbound message. The renderer therefore does not need its own
 *    sanitiser and must not invent one: if it emitted anything the sanitiser would change, the Studio's
 *    preview and the delivered message would be two different documents. The consequence is deliberate
 *    and visible: the eleven permitted style properties do not include `max-width`, `padding` or
 *    `margin`, so a message is the full width of the reading pane rather than a 520px card. The words,
 *    the order and the structure are the same; the geometry is the allowlist's, not the renderer's.
 *
 * 2. **Plain text is a first-class part.** Every block has a text form of its own — a button is
 *    `Label: <full url>` with the URL written out rather than hidden behind link text, a quote is `> `
 *    prefixed, an image carries its words — and the text part is derived from *the same blocks* by
 *    default (`EmailTemplate.text` is null). A message cannot carry a fact in one part and not the
 *    other, because one of the two is generated from the other. Somebody may edit the text part; the
 *    API then returns both and the renderer warns when a link or an attachment name is in the HTML and
 *    not in the text.
 *
 * 3. **An absence is stated, and a sentence is never left with a hole in it.** A field the record cannot
 *    supply renders as `—`, which is visible in a preview and obvious in a test send. A value a sentence
 *    depends on — a greeting, a pluralised count, the credential — is supplied whole by the caller
 *    (`message.*`), so the sentence is either there or its block is not sent at all: a rendered block
 *    whose text is empty is omitted rather than sent empty.
 */
import { EMAIL_CONDITIONS, type EmailBlock, type EmailCondition, type EmailMessageKey } from "@C7NTAX/shared";
import { escapeHtml, htmlToText, sanitizeEmailHtml } from "./emailHtml";
import { DEFAULT_BRAND, emailMessage, type EmailBrandValues } from "./emailMessages";

/** A template as the renderer needs it: what was stored, or the registry's default. */
export interface EmailRenderable {
  key: EmailMessageKey;
  subject: string;
  blocks: EmailBlock[];
  /** Null means "derive the plain-text part from the blocks". */
  text: string | null;
}

export interface EmailRenderContext {
  /** Merge values, by `EMAIL_FIELDS` token. A missing key is not the same as an empty string:
   *  missing means "this record cannot supply it" and renders as `—`; empty means "there is nothing
   *  here", which omits the block that depended on it. */
  fields: Record<string, string | null | undefined>;
  conditions?: Partial<Record<EmailCondition, boolean>>;
  brand?: EmailBrandValues;
  /** The ticket composer's own message, placed above the blocks for `ticket.note`. */
  composerHtml?: string;
}

export interface EmailRenderResult {
  subject: string;
  html: string;
  /** The plain-text part derived from the blocks. Always present. */
  derivedText: string;
  /** What is actually sent as the text part: the template's own, or the derived one. */
  text: string;
  warnings: string[];
}

/** A value the record could not supply. Not an empty string: a stated absence. */
const ABSENT = "—";
const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

const CARD_BG = "#0f1923";
const CARD_FG = "#e2e8f0";
const BODY_TEXT = "#cbd5e1";
const DIM = "#94a3b8";
const FAINT = "#64748b";
const PANEL_BG = "#1e293b";
const WHITE = "#ffffff";
const NOTE_TONES: Record<string, { bg: string; fg: string }> = {
  neutral: { bg: PANEL_BG, fg: BODY_TEXT },
  warn: { bg: "#78350f", fg: "#fde68a" },
  good: { bg: "#14532d", fg: "#bbf7d0" },
};

/**
 * A colour out of the brand kit is interpolated into a `style` attribute, so it is checked rather than
 * trusted. A value that is not a hex colour is not a colour, and the default is used instead.
 */
function hex(value: string | undefined | null, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value.trim()) ? value.trim() : fallback;
}

/**
 * Tokens whose value is a link. They resolve to an empty string when the record cannot supply one —
 * never to `—` — so the block that depended on the link is omitted rather than pointing at a dash.
 */
function isUrlToken(token: string): boolean {
  return /(^|\.)url$/i.test(token) || /Url$/.test(token);
}

/**
 * An attribute value is emitted **raw** and the sanitiser escapes it once. Escaping here as well would
 * produce `&amp;amp;` — the sanitiser's `sanitizeAttrs` escapes every attribute it keeps. What is
 * removed here is only what could break the attribute open before it gets there.
 */
function rawAttribute(value: string): string {
  return value.replace(/["'<>\r\n\t]/g, (char) => encodeURIComponent(char));
}

interface Substituter {
  /** HTML fragment: values escaped, newlines kept as line breaks. */
  html(input: string): string;
  /** Flat text (a subject line): values as they are, never escaped. */
  text(input: string): string;
}

function substituter(context: EmailRenderContext, warnings: Set<string>): Substituter {
  const value = (token: string): string | null => {
    const raw = context.fields?.[token];
    if (raw === undefined || raw === null) {
      if (isUrlToken(token)) return "";
      warnings.add(`{{${token}}} has no value in this record, so it is sent as ${ABSENT}.`);
      return null;
    }
    return String(raw);
  };
  return {
    html: (input) =>
      String(input ?? "").replace(TOKEN, (_match, token: string) => {
        const found = value(token);
        return escapeHtml(found === null ? ABSENT : found).replace(/\r?\n/g, "<br>");
      }),
    text: (input) =>
      String(input ?? "").replace(TOKEN, (_match, token: string) => {
        const found = value(token);
        return found === null ? ABSENT : found;
      }),
  };
}

interface RenderedBlock {
  html: string;
  text: string;
}

/** One block, in both parts. `null` means "do not send this block at all". */
function renderBlock(block: EmailBlock, context: EmailRenderContext, brand: EmailBrandValues, say: Substituter, warnings: Set<string>): RenderedBlock | null {
  switch (block.kind) {
    case "heading": {
      const text = say.html(block.text).trim();
      if (!text) return null;
      const plain = htmlToText(text);
      if (block.level === 1) {
        return {
          html: `<h1 style="background-color:${hex(brand.primaryColor, DEFAULT_BRAND.primaryColor)};color:${WHITE};font-size:20px;font-weight:700;text-align:center;line-height:1.4">${text}</h1>`,
          text: plain,
        };
      }
      return { html: `<h2 style="color:${WHITE};font-size:18px;font-weight:700;line-height:1.4">${text}</h2>`, text: plain };
    }

    case "paragraph": {
      const html = say.html(block.html).trim();
      const plain = htmlToText(html);
      if (!plain) return null;
      return { html: `<p style="color:${BODY_TEXT};font-size:13.5px;line-height:1.6">${html}</p>`, text: plain };
    }

    case "button": {
      const label = htmlToText(say.html(block.label)).trim();
      const href = say.text(block.href).trim();
      if (!label || !href) {
        if (!href) warnings.add(`The button "${label || "untitled"}" has no link, so it was not sent.`);
        return null;
      }
      return {
        html: `<a href="${rawAttribute(href)}" style="background-color:${hex(brand.primaryColor, DEFAULT_BRAND.primaryColor)};color:${WHITE};font-weight:700;text-decoration:none;line-height:1.4">${escapeHtml(label)}</a>`,
        // The URL is written out rather than hidden behind the label: a client that strips HTML
        // shows the link text and nothing else, and "Respond Now" with no address is not readable.
        text: `${label}: ${href}`,
      };
    }

    case "facts": {
      const items = (block.items ?? []).map((item) => ({
        label: htmlToText(say.html(item.label)).trim(),
        value: htmlToText(say.html(item.value)).trim(),
      })).filter((item) => item.label || item.value);
      if (!items.length) return null;
      const title = block.title ? say.html(block.title).trim() : "";
      const rows = items
        .map((item) => `<tr><td style="color:${DIM};font-size:11px;line-height:1.6">${item.label}</td><td style="color:${WHITE};font-size:12.5px;line-height:1.6">${item.value}</td></tr>`)
        .join("");
      return {
        html: `${title ? `<p style="color:${DIM};font-size:12px">${title}</p>` : ""}<table style="line-height:1.6"><tbody>${rows}</tbody></table>`,
        text: [title ? htmlToText(title) : "", ...items.map((item) => `${item.label}: ${item.value}`)].filter(Boolean).join("\n"),
      };
    }

    case "quote": {
      const html = say.html(block.html).trim();
      const plain = htmlToText(html);
      if (!plain) return null;
      const title = block.title ? say.html(block.title).trim() : "";
      const source = block.source ? htmlToText(say.html(block.source)).trim() : "";
      return {
        html: `${title ? `<p style="color:${DIM};font-size:12px">${title}</p>` : ""}<blockquote style="background-color:${PANEL_BG};color:${BODY_TEXT};font-size:13px;line-height:1.6">${html}</blockquote>${source ? `<p style="color:${FAINT};font-size:12px">— ${escapeHtml(source)}</p>` : ""}`,
        text: [plain.split("\n").map((line) => `> ${line}`.trimEnd()).join("\n"), source ? `— ${source}` : ""].filter(Boolean).join("\n"),
      };
    }

    case "table": {
      const columns = (block.columns ?? []).map((column) => htmlToText(say.html(column)).trim());
      const rows = (block.rows ?? []).map((row) => row.map((cell) => htmlToText(say.html(cell)).trim()));
      if (!rows.length) return null;
      const title = block.title ? say.html(block.title).trim() : "";
      const head = columns.length
        ? `<thead><tr>${columns.map((column) => `<th style="color:${DIM};font-size:11px;font-weight:700;text-align:left">${escapeHtml(column)}</th>`).join("")}</tr></thead>`
        : "";
      const body = rows
        .map((row) => `<tr>${row.map((cell) => `<td style="color:${BODY_TEXT};font-size:12.5px;line-height:1.6">${escapeHtml(cell)}</td>`).join("")}</tr>`)
        .join("");
      // Every cell is named, so a row read as text cannot lose what a column header meant.
      const text = rows
        .map((row) => row.map((cell, index) => `${columns[index] || `Column ${index + 1}`}: ${cell}`).join("\n"))
        .join("\n\n");
      return { html: `${title ? `<p style="color:${DIM};font-size:12px">${title}</p>` : ""}<table style="line-height:1.6">${head}<tbody>${body}</tbody></table>`, text: [title ? htmlToText(title) : "", text].filter(Boolean).join("\n") };
    }

    case "image": {
      const src = say.text(block.src).trim();
      const alt = htmlToText(say.html(block.alt)).trim();
      if (!src) {
        warnings.add("An image had no address, so it was not sent.");
        return null;
      }
      const href = block.href ? say.text(block.href).trim() : "";
      const img = `<img src="${rawAttribute(src)}" alt="${escapeHtml(alt)}">`;
      return {
        html: href ? `<a href="${rawAttribute(href)}">${img}</a>` : img,
        // A picture may not arrive — a client blocks remote images by default — so the words travel
        // with it rather than being the only way to know what it showed.
        text: `[image: ${alt || "no description"}]${href ? ` ${href}` : ""}`,
      };
    }

    case "divider":
      return { html: "<hr>", text: "---" };

    case "note": {
      const text = htmlToText(say.html(block.text)).trim();
      if (!text) return null;
      const tone = NOTE_TONES[block.tone ?? "neutral"] ?? NOTE_TONES.neutral!;
      return { html: `<p style="background-color:${tone.bg};color:${tone.fg};font-size:13px;line-height:1.6">${say.html(block.text).trim()}</p>`, text };
    }

    case "attachment": {
      const name = htmlToText(say.html(block.name)).trim();
      const note = block.note ? htmlToText(say.html(block.note)).trim() : "";
      if (!name) return null;
      return {
        html: `<p style="color:${FAINT};font-size:12px;line-height:1.5">Attached: ${escapeHtml(name)}${note ? ` — ${escapeHtml(note)}` : ""}</p>`,
        text: `Attached: ${name}${note ? ` — ${note}` : ""}`,
      };
    }

    case "conditional": {
      const answered = context.conditions?.[block.when];
      if (answered === undefined) {
        warnings.add(`The condition "${EMAIL_CONDITIONS.find((entry) => entry.key === block.when)?.label ?? block.when}" was not answered by the sender, so that block was not sent.`);
        return null;
      }
      if (!answered) return null;
      return renderBlocks(block.blocks ?? [], context, brand, say, warnings);
    }

    case "signature": {
      const name = brand.companyName?.trim();
      if (!name) return null;
      return { html: `<p style="color:${DIM};font-size:12px;line-height:1.6">${escapeHtml(name)}</p>`, text: name };
    }

    case "footer": {
      const footer = brand.footerText?.trim() ?? "";
      const legal = brand.legalText?.trim() ?? "";
      if (!footer && !legal) return null;
      const lines = [footer, legal].filter(Boolean);
      return {
        html: `<hr><p style="color:${FAINT};font-size:11px;line-height:1.6">${lines.map(escapeHtml).join("<br>")}</p>`,
        text: lines.join("\n"),
      };
    }

    default:
      return null;
  }
}

/** A list of blocks, merged into one fragment so a conditional does not leave its own paragraph gaps. */
function renderBlocks(blocks: EmailBlock[], context: EmailRenderContext, brand: EmailBrandValues, say: Substituter, warnings: Set<string>): RenderedBlock {
  const html: string[] = [];
  const text: string[] = [];
  for (const block of blocks ?? []) {
    const rendered = renderBlock(block, context, brand, say, warnings);
    if (!rendered) continue;
    if (rendered.html) html.push(rendered.html);
    if (rendered.text) text.push(rendered.text);
  }
  return { html: html.join("\n"), text: text.join("\n\n") };
}

function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Every link the HTML carries, so the text part can be checked against it. */
function linksIn(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*"([^"]+)"/gi)) if (/^https?:/i.test(match[1]!)) found.add(match[1]!);
  return [...found];
}

/**
 * Render one message: `template` is what was stored (or the registry's default), `context` is the
 * record. Returns both parts, the subject, and whatever the renderer wants a person to know before
 * they approve it.
 */
export function renderEmail(template: EmailRenderable, context: EmailRenderContext): EmailRenderResult {
  const warnings = new Set<string>();
  const entry = emailMessage(template.key);
  const brand: EmailBrandValues = {
    productName: context.brand?.productName ?? DEFAULT_BRAND.productName,
    companyName: context.brand?.companyName ?? DEFAULT_BRAND.companyName,
    wordmark: context.brand?.wordmark ?? DEFAULT_BRAND.wordmark,
    primaryColor: hex(context.brand?.primaryColor, DEFAULT_BRAND.primaryColor),
    accentColor: hex(context.brand?.accentColor, DEFAULT_BRAND.accentColor),
    footerText: context.brand?.footerText ?? DEFAULT_BRAND.footerText,
    legalText: context.brand?.legalText ?? DEFAULT_BRAND.legalText,
  };
  const say = substituter({ ...context, brand }, warnings);

  const composerHtml = entry?.bodyFromComposer ? sanitizeEmailHtml(String(context.composerHtml ?? "")) : "";
  const body = renderBlocks(template.blocks ?? [], { ...context, brand }, brand, say, warnings);

  const inner = [composerHtml, body.html].filter(Boolean).join("\n");
  // The family list is written without quotes around "Segoe UI" on purpose: a single quote in a style
  // value comes back from `sanitizeEmailHtml` as `&#39;`, whose semicolon splits the declaration if the
  // markup is ever sanitised a second time. An unquoted multi-word family name is valid CSS, and this
  // keeps the renderer's output exactly what the sanitiser would produce.
  const html = sanitizeEmailHtml(
    `<div style="font-family: -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; background-color: ${CARD_BG}; color: ${CARD_FG}; line-height: 1.6">${inner}</div>`,
  );

  const derivedText = tidy([composerHtml ? htmlToText(composerHtml) : "", body.text].filter(Boolean).join("\n\n"));
  const stored = typeof template.text === "string" ? template.text.trim() : "";
  const text = stored || derivedText;

  const subject = say.text(template.subject ?? "").replace(/\s+/g, " ").trim();
  if (!subject) warnings.add("This message has no subject line.");
  if (!html) warnings.add("This message has no body — nothing but the subject would be sent.");

  if (stored) {
    warnings.add("The plain-text part has been edited, so it is not derived from the blocks any more. A client that strips HTML will read it instead of them.");
    for (const link of linksIn(html)) {
      if (!text.includes(link)) warnings.add(`The link ${link} is in the message but not in the plain-text part.`);
    }
    for (const match of html.matchAll(/Attached: ([^<—]+)/g)) {
      const name = match[1]!.trim();
      if (name && !text.includes(name)) warnings.add(`The attachment ${name} is in the message but not named in the plain-text part.`);
    }
  }

  return { subject, html, derivedText, text, warnings: [...warnings] };
}
