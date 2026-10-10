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
 *    preview and the delivered message would be two different documents. The `email-studio-probe`
 *    check holds this from the other side — every default is rendered and every style property in the
 *    result is looked up in the allowlist — so the two move together or the check fails.
 *
 *    That allowlist carries the geometry as well as the type, and the reason is the first paragraph
 *    again: a message is a document that leaves the building and has to arrive as the one somebody
 *    approved. `padding`, `margin` and `max-width` are in it because there is no other way for this
 *    file to say what it means — a 600px card with an inset body rather than prose against the left
 *    edge of a 1200px reading pane. `emailHtml.ts` holds the list and the reasoning, including what is
 *    still refused and why.
 *
 *    The layout is fluid and single-column **on purpose, with no `<style>` block and no media query**:
 *    the markup at 375px is the markup at 600px, which is what makes the message the same message in
 *    every client. A layout that only reads well when a media query fires is a layout that breaks in
 *    the clients that matter. That is also why metadata is a *stack* — a label above its value, both
 *    full width — rather than two columns: a pair sharing a line squeezes and then wraps mid-phrase at
 *    375px, and stacking cannot wrap badly at any width, without a line of mobile CSS.
 *
 *    Spacing is `padding` rather than `margin` wherever a gap matters, and that is not a style
 *    preference: Outlook renders with Word's engine, which drops margins. A rectangle with padding
 *    arrives; a rectangle with a margin arrives touching.
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

const PAGE_BG = "#0b131b";
const CARD_BG = "#0f1923";
const CARD_FG = "#e2e8f0";
const BODY_TEXT = "#cbd5e1";
const DIM = "#94a3b8";
const FAINT = "#64748b";
const PANEL_BG = "#1e293b";
const HAIRLINE = "#1e293b";
const RULE = "#334155";
const WHITE = "#ffffff";
const NOTE_TONES: Record<string, { bg: string; fg: string; line: string }> = {
  neutral: { bg: PANEL_BG, fg: BODY_TEXT, line: RULE },
  warn: { bg: "#78350f", fg: "#fde68a", line: "#f59e0b" },
  good: { bg: "#14532d", fg: "#bbf7d0", line: "#22c55e" },
};

/**
 * The geometry, in one place, because every block shares it and a block that invents its own is the
 * bug this file exists to fix: the message the owner looked at had prose against the frame's left edge.
 *
 *  · `INSET` — the horizontal padding every block carries, so nothing touches an edge at 375px or at
 *    600px. A table's first and last column line up with the paragraphs because the inset is the
 *    container's, not the cell's (see `cellPadding`).
 *  · `GAP` — the space *above* a block, as padding. Nothing carries a bottom gap: the card supplies the
 *    last one, so two blocks are `GAP` apart rather than `GAP` doubled, and no margin can be dropped by
 *    a client that does not honour margins (see the header comment).
 *  · `CARD_TAIL` — the card's own bottom padding, which is what keeps the final block's text off the
 *    card's lower edge.
 */
const INSET = "28px";
const GAP = "18px";
const CARD_TAIL = "22px";
/** A table's column gutter; the first and last column carry none, so the table aligns with the prose. */
const COLUMN_GAP = 14;

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

/**
 * A small upper-case label that sits above its value. `text-transform` and `letter-spacing` change how
 * the words are drawn, not what they say, so the message and its text part are unaffected by them.
 */
const EYEBROW = `color: ${DIM}; font-size: 11px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; line-height: 1.5; margin: 0`;

/**
 * A table cell's padding: `COLUMN_GAP` between columns and *nothing* at the table's own edges, so the
 * first and last column line up with the prose above them rather than sitting in their own gutter.
 * Widths are never set on a column: a fixed column is what forces a table to scroll on a phone.
 */
function cellPadding(index: number, count: number, top: number, bottom: number): string {
  const left = index === 0 ? 0 : COLUMN_GAP;
  const right = index === count - 1 ? 0 : COLUMN_GAP;
  return `padding: ${top}px ${right}px ${bottom}px ${left}px`;
}

/** One block, in both parts. `null` means "do not send this block at all". */
function renderBlock(block: EmailBlock, context: EmailRenderContext, brand: EmailBrandValues, say: Substituter, warnings: Set<string>): RenderedBlock | null {
  switch (block.kind) {
    case "heading": {
      const text = say.html(block.text).trim();
      if (!text) return null;
      const plain = htmlToText(text);
      if (block.level === 1) {
        // The masthead: full-bleed across the card, with padding of its own and a rounded top that
        // follows the card's own corner — a bar rather than a coloured strip, because the title sits
        // inside it instead of against its edge. The space between it and the body is the first body
        // block's `GAP`.
        return {
          html: `<h1 style="background-color:${hex(brand.primaryColor, DEFAULT_BRAND.primaryColor)};color:${WHITE};font-size:19px;font-weight:700;text-align:center;letter-spacing:0.3px;line-height:1.4;padding:22px ${INSET};margin:0;border-radius:9px 9px 0 0">${text}</h1>`,
          text: plain,
        };
      }
      return { html: `<h2 style="color:${WHITE};font-size:17px;font-weight:700;line-height:1.35;padding:24px ${INSET} 0;margin:0">${text}</h2>`, text: plain };
    }

    case "paragraph": {
      const html = say.html(block.html).trim();
      const plain = htmlToText(html);
      if (!plain) return null;
      return { html: `<p style="color:${BODY_TEXT};font-size:13.5px;line-height:1.65;padding:${GAP} ${INSET} 0;margin:0">${html}</p>`, text: plain };
    }

    case "button": {
      const label = htmlToText(say.html(block.label)).trim();
      const href = say.text(block.href).trim();
      if (!label || !href) {
        if (!href) warnings.add(`The button "${label || "untitled"}" has no link, so it was not sent.`);
        return null;
      }
      return {
        // Inline-block, not a block: a link stretched across the message reads as a banner, and a
        // banner is not what a person pictures when they write a button.
        html: `<div style="padding:${GAP} ${INSET} 0"><a href="${rawAttribute(href)}" style="display:inline-block;background-color:${hex(brand.primaryColor, DEFAULT_BRAND.primaryColor)};color:${WHITE};font-size:13.5px;font-weight:700;line-height:1.2;text-decoration:none;padding:12px 22px;border-radius:6px">${escapeHtml(label)}</a></div>`,
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
      // Stacked, one label above its value, both full width — never two columns. A pair sharing a line
      // squeezes and then breaks mid-phrase at 375px; a stack cannot wrap badly at any width. The text
      // part is still the pair written as `Label: value`, so what a client without HTML reads is
      // unchanged by the shape of what it does not read.
      const rows = items
        .map((item, index) => [
          item.label ? `<p style="${EYEBROW};padding-top:${index ? 14 : 0}px">${item.label}</p>` : "",
          item.value ? `<p style="color:${WHITE};font-size:13.5px;line-height:1.5;margin:0;padding-top:3px">${item.value}</p>` : "",
        ].join(""))
        .join("");
      return {
        html: `<div style="padding:${GAP} ${INSET} 0">${title ? `<p style="${EYEBROW};padding-bottom:10px">${title}</p>` : ""}${rows}</div>`,
        text: [title ? htmlToText(title) : "", ...items.map((item) => `${item.label}: ${item.value}`)].filter(Boolean).join("\n"),
      };
    }

    case "quote": {
      const html = say.html(block.html).trim();
      const plain = htmlToText(html);
      if (!plain) return null;
      const title = block.title ? say.html(block.title).trim() : "";
      const source = block.source ? htmlToText(say.html(block.source)).trim() : "";
      // The indent is ours, not the browser's: `blockquote` arrives with a 40px left margin of its own,
      // which is why this used to sit in a rectangle that had drifted away from everything else. The
      // accent rule and the tint make it a quotation rather than a coloured box.
      return {
        html: `<div style="padding:${GAP} ${INSET} 0">${title ? `<p style="${EYEBROW};padding-bottom:8px">${title}</p>` : ""}<blockquote style="background-color:${PANEL_BG};color:${BODY_TEXT};font-size:13px;line-height:1.65;margin:0;padding:14px 16px;border-left:3px solid ${hex(brand.primaryColor, DEFAULT_BRAND.primaryColor)};border-radius:0 6px 6px 0">${html}</blockquote>${source ? `<p style="color:${FAINT};font-size:11.5px;line-height:1.5;margin:0;padding:8px 0 0">— ${escapeHtml(source)}</p>` : ""}</div>`,
        text: [plain.split("\n").map((line) => `> ${line}`.trimEnd()).join("\n"), source ? `— ${source}` : ""].filter(Boolean).join("\n"),
      };
    }

    case "table": {
      const columns = (block.columns ?? []).map((column) => htmlToText(say.html(column)).trim());
      const rows = (block.rows ?? []).map((row) => row.map((cell) => htmlToText(say.html(cell)).trim()));
      if (!rows.length) return null;
      const title = block.title ? say.html(block.title).trim() : "";
      const width = columns.length || rows[0]!.length;
      // A header row by a rule and a tone rather than a border round every cell, and no column width at
      // all: the table is as wide as the card and the columns take what they need.
      const head = columns.length
        ? `<thead><tr>${columns.map((column, index) => `<th style="${EYEBROW};text-align:left;${cellPadding(index, width, 0, 9)};border-bottom:1px solid ${RULE};vertical-align:bottom">${escapeHtml(column)}</th>`).join("")}</tr></thead>`
        : "";
      const body = rows
        .map((row) => `<tr>${row.map((cell, index) => `<td style="color:${BODY_TEXT};font-size:12.5px;line-height:1.6;${cellPadding(index, width, 10, 10)};border-bottom:1px solid ${HAIRLINE};vertical-align:top">${escapeHtml(cell)}</td>`).join("")}</tr>`)
        .join("");
      // Every cell is named, so a row read as text cannot lose what a column header meant.
      const text = rows
        .map((row) => row.map((cell, index) => `${columns[index] || `Column ${index + 1}`}: ${cell}`).join("\n"))
        .join("\n\n");
      return { html: `<div style="padding:${GAP} ${INSET} 0">${title ? `<p style="${EYEBROW};padding-bottom:8px">${title}</p>` : ""}<table style="width:100%;border-collapse:collapse">${head}<tbody>${body}</tbody></table></div>`, text: [title ? htmlToText(title) : "", text].filter(Boolean).join("\n") };
    }

    case "image": {
      const src = say.text(block.src).trim();
      const alt = htmlToText(say.html(block.alt)).trim();
      if (!src) {
        warnings.add("An image had no address, so it was not sent.");
        return null;
      }
      const href = block.href ? say.text(block.href).trim() : "";
      // `max-width` inside an inset box, so a screenshot wider than the card shrinks instead of pushing
      // the message sideways on a phone.
      const img = `<img src="${rawAttribute(src)}" alt="${escapeHtml(alt)}" style="max-width:100%;border-radius:6px">`;
      return {
        html: `<div style="padding:${GAP} ${INSET} 0">${href ? `<a href="${rawAttribute(href)}">${img}</a>` : img}</div>`,
        // A picture may not arrive — a client blocks remote images by default — so the words travel
        // with it rather than being the only way to know what it showed.
        text: `[image: ${alt || "no description"}]${href ? ` ${href}` : ""}`,
      };
    }

    case "divider":
      return { html: `<div style="padding:20px ${INSET} 0"><hr style="border:0;border-top:1px solid ${RULE};margin:0"></div>`, text: "---" };

    case "note": {
      const text = htmlToText(say.html(block.text)).trim();
      if (!text) return null;
      const tone = NOTE_TONES[block.tone ?? "neutral"] ?? NOTE_TONES.neutral!;
      return { html: `<div style="padding:${GAP} ${INSET} 0"><p style="background-color:${tone.bg};color:${tone.fg};font-size:13px;line-height:1.65;margin:0;padding:13px 16px;border-left:3px solid ${tone.line};border-radius:0 6px 6px 0">${say.html(block.text).trim()}</p></div>`, text };
    }

    case "attachment": {
      const name = htmlToText(say.html(block.name)).trim();
      const note = block.note ? htmlToText(say.html(block.note)).trim() : "";
      if (!name) return null;
      return {
        html: `<p style="color:${FAINT};font-size:11.5px;line-height:1.55;padding:${GAP} ${INSET} 0;margin:0">Attached: ${escapeHtml(name)}${note ? ` — ${escapeHtml(note)}` : ""}</p>`,
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
      return { html: `<p style="color:${DIM};font-size:12px;line-height:1.6;padding:${GAP} ${INSET} 0;margin:0">${escapeHtml(name)}</p>`, text: name };
    }

    case "footer": {
      const footer = brand.footerText?.trim() ?? "";
      const legal = brand.legalText?.trim() ?? "";
      if (!footer && !legal) return null;
      const lines = [footer, legal].filter(Boolean);
      return {
        // A hairline above the small print, and the small print at 11.5px — the one place in a message
        // where being quiet is the point. The gap under the rule is the paragraph's own padding, because
        // a margin is what a Word-engine client drops.
        html: `<div style="padding:24px ${INSET} 0"><hr style="border:0;border-top:1px solid ${HAIRLINE};margin:0"><p style="color:${FAINT};font-size:11.5px;line-height:1.6;margin:0;padding-top:12px">${lines.map(escapeHtml).join("<br>")}</p></div>`,
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

  // The composer's own body is a person's rich text, so it goes inside the same body inset as the
  // blocks: what a technician typed is the message's first paragraph, not an exception to its geometry.
  const composerBlock = composerHtml
    ? `<div style="color:${BODY_TEXT};font-size:13.5px;line-height:1.65;padding:${GAP} ${INSET} 0">${composerHtml}</div>`
    : "";
  const inner = [composerBlock, body.html].filter(Boolean).join("\n");
  // The shell is the whole of the layout: a page, a 600px card centred on it, and blocks that carry
  // their own inset. 600px is the width mail is designed at, and the layout is one column at every
  // width — there is no `<style>` block and no media query to switch it, because the sanitiser drops a
  // `<style>` with its content and Outlook ignores one, and a layout that needs one is a layout that
  // breaks in the clients that matter.
  //
  // The family list is written without quotes around "Segoe UI" on purpose: a single quote in a style
  // value comes back from `sanitizeEmailHtml` as `&#39;`, whose semicolon splits the declaration if the
  // markup is ever sanitised a second time. An unquoted multi-word family name is valid CSS, and this
  // keeps the renderer's output exactly what the sanitiser would produce.
  const html = sanitizeEmailHtml(
    `<div style="font-family: -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; background-color: ${PAGE_BG}; color: ${CARD_FG}; line-height: 1.6; padding: 24px 12px">` +
      `<div style="max-width: 600px; margin: 0 auto; background-color: ${CARD_BG}; border: 1px solid ${HAIRLINE}; border-radius: 10px; box-sizing: border-box; padding-bottom: ${CARD_TAIL}">${inner}</div>` +
      `</div>`,
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
