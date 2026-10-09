/**
 * The email block vocabulary as the *editor* sees it: what each of the 13 kinds is for, how it is
 * drawn on the canvas, and what it becomes in the plain-text part.
 *
 * Two jobs, and they are the same job from two directions.
 *
 * **Drawing.** The canvas is the sanitiser's canvas — what is drawn is what would leave the
 * building — so a paragraph's HTML goes through `inspectPastedHtml()` before it is shown, a
 * `{{field}}` becomes a chip carrying the value it resolves to for the record being previewed, and a
 * conditional is drawn as a rail around the blocks it guards rather than as a note about one.
 *
 * **The text part.** The sender always supplies one, and it is derived from *these blocks* rather
 * than from the rendered HTML, so the two parts cannot carry different facts. The rules are the ones
 * the product owner asked for, in so many words — "some mail systems strip the HTML out of it, so I
 * still want the email to be readable":
 *
 *  · a **button** becomes `Label: <full url>`, never link text with the URL hidden behind it, because
 *    the URL is the information;
 *  · **facts** and a **table** become `Label: value` lines;
 *  · a **quote** is prefixed `> ` so a reply's nesting survives;
 *  · an **image** always carries its words, because a picture may not arrive;
 *  · an **attachment** is named, because the name is all the reader has if the file is blocked.
 */
import type { EmailBlock, EmailCondition } from "@C7NTAX/shared";
import { EMAIL_CONDITIONS } from "@C7NTAX/shared";

/** The 13 kinds, with the sentence the palette offers each one under. */
export const BLOCK_KINDS: { kind: EmailBlock["kind"]; label: string; say: string; palette: boolean }[] = [
  { kind: "heading", label: "Heading", say: "h1–h4 only; h5 and h6 are not in the tag set", palette: true },
  { kind: "paragraph", label: "Paragraph", say: "The thing itself, with fields in it", palette: true },
  { kind: "facts", label: "Fact pairs", say: "Label and value on a line — Status, Priority, Technician, Client", palette: true },
  { kind: "quote", label: "Quote — the conversation so far", say: "Almost always conditional: only when there is a note to quote", palette: true },
  { kind: "button", label: "Button", say: "One link: https/mailto/tel or a path", palette: true },
  { kind: "table", label: "Table", say: "For invoice lines and time entries", palette: true },
  { kind: "image", label: "Image", say: "Inline only — pulled out into a cid: part before sending", palette: true },
  { kind: "divider", label: "Divider", say: "The <hr> the composer already writes", palette: true },
  { kind: "attachment", label: "Attachment / report block", say: "Names the PDF that travels with the message", palette: true },
  { kind: "note", label: "Note", say: "A line set apart — the sentence the renderer already writes in a panel", palette: true },
  { kind: "conditional", label: "Conditional", say: "Blocks present only when a condition holds", palette: false },
  { kind: "signature", label: "Signature", say: "The brand kit's sign-off — one place, one change", palette: false },
  { kind: "footer", label: "Footer", say: "The legal line and the unsubscribe rule, inherited rather than restated", palette: false },
];

export function blockKindLabel(kind: EmailBlock["kind"]): string {
  return BLOCK_KINDS.find((entry) => entry.kind === kind)?.label ?? kind;
}

/** The condition's own label, so the picker and the renderer cannot disagree about what it means. */
export function conditionLabel(condition: EmailCondition): string {
  return EMAIL_CONDITIONS.find((entry) => entry.key === condition)?.label ?? condition;
}

/** The API's own HTML-to-text, mirrored so the editor can show what a paragraph becomes as text. */
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

/** Every field token a block mentions, so the canvas can list what it inserted. */
export function tokensInBlock(block: EmailBlock): string[] {
  const found: string[] = [];
  const add = (value: string | undefined) => {
    if (!value) return;
    for (const match of value.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)) {
      if (match[1] && !found.includes(match[1])) found.push(match[1]);
    }
  };
  switch (block.kind) {
    case "heading": add(block.text); break;
    case "paragraph": add(block.html); break;
    case "note": add(block.text); break;
    case "quote": add(block.html); add(block.title); add(block.source); break;
    case "button": add(block.label); add(block.href); break;
    case "facts": add(block.title); block.items.forEach((item) => { add(item.label); add(item.value); }); break;
    case "table": add(block.title); block.columns.forEach(add); block.rows.forEach((row) => row.forEach(add)); break;
    case "image": add(block.src); add(block.alt); break;
    case "attachment": add(block.name); add(block.note); break;
    case "conditional": block.blocks.forEach((inner) => tokensInBlock(inner).forEach((token) => { if (!found.includes(token)) found.push(token); })); break;
    default: break;
  }
  return found;
}

/**
 * The plain-text form of one block. An array of lines, because the caller decides the blank lines.
 *
 * This is the whole answer to "some mail systems strip the HTML out": the text part is built from the
 * blocks, so nothing in it can disagree with the HTML, and a URL is written out in full.
 */
export function blockToTextLines(block: EmailBlock, resolve: (value: string) => string): string[] {
  switch (block.kind) {
    case "heading":
      return [resolve(block.text)];
    case "paragraph":
      return splitParagraph(htmlToText(resolve(block.html)));
    case "button":
      // The URL in full, never hidden behind the label — the link text is a courtesy, the URL is the fact.
      return [`${resolve(block.label)}: ${resolve(block.href)}`];
    case "facts": {
      const lines = block.title ? [resolve(block.title)] : [];
      for (const item of block.items) lines.push(`${resolve(item.label)}: ${resolve(item.value)}`);
      return lines;
    }
    case "quote": {
      const inner = splitParagraph(htmlToText(resolve(block.html))).map((line) => `> ${line}`);
      const lines = block.title ? [`${resolve(block.title)}${block.source ? ` — ${resolve(block.source)}` : ""}`] : [];
      return [...lines, ...inner];
    }
    case "table": {
      const lines = block.title ? [resolve(block.title)] : [];
      if (block.columns.length) lines.push(block.columns.map((column) => resolve(column)).join("   "));
      for (const row of block.rows) {
        // Two columns read as "Label: value"; more than two are separated so a wrapped line still parses.
        lines.push(row.length === 2 ? `${resolve(row[0] ?? "")}: ${resolve(row[1] ?? "")}` : row.map((cell) => resolve(cell)).join("   "));
      }
      return lines;
    }
    case "image": {
      // An image always says its words, because a picture may not arrive.
      const alt = resolve(block.alt);
      return block.href ? [`${alt}: ${resolve(block.href)}`] : [alt];
    }
    case "divider":
      return ["--"];
    case "note":
      return splitParagraph(resolve(block.text));
    case "attachment":
      return [`Attachment: ${resolve(block.name)}${block.note ? ` — ${resolve(block.note)}` : ""}`];
    case "conditional": {
      const lines: string[] = [];
      for (const inner of block.blocks) lines.push(...blockToTextLines(inner, resolve));
      return lines;
    }
    case "signature":
      return ["--"];
    case "footer":
      return [];
    default:
      return [];
  }
}

function splitParagraph(text: string): string[] {
  return text.split(/\n{2,}/).filter((chunk) => chunk.trim().length > 0);
}

/**
 * The plain-text part, derived from the blocks. Always present — the sender supplies it on every
 * message, so a client that strips HTML still gets a readable one.
 */
export function derivePlainText(blocks: EmailBlock[], resolve: (value: string) => string): string {
  const chunks: string[] = [];
  for (const block of blocks) {
    const lines = blockToTextLines(block, resolve).filter((line) => line.trim().length > 0);
    if (lines.length) chunks.push(lines.join("\n"));
  }
  return chunks.join("\n\n").trim();
}

/**
 * Whether a derived text part and somebody's edited one carry the same facts.
 *
 * Not a string comparison: the two are allowed to differ in whitespace and in wording. What is
 * compared is the *content* — the digits, the money, the addresses, the URLs — because a text part
 * that quietly drops a figure the HTML shows is the failure the owner named.
 */
export interface TextDifference {
  /** Facts the HTML carries and the edited text does not. */
  missingFromText: string[];
  /** Facts the edited text carries and the HTML does not. */
  extraInText: string[];
}

export function compareTextFacts(html: string, text: string): TextDifference {
  const facts = (value: string) => {
    const found = new Set<string>();
    for (const match of value.matchAll(/(https?:\/\/[^\s<>"']+|\$[\d,]+(?:\.\d{2})?|\b\d[\d,.]{2,}\b)/g)) {
      if (match[1]) found.add(match[1]);
    }
    return found;
  };
  const inHtml = facts(htmlToText(html));
  const inText = facts(text);
  return {
    missingFromText: [...inHtml].filter((fact) => !inText.has(fact)),
    extraInText: [...inText].filter((fact) => !inHtml.has(fact)),
  };
}
