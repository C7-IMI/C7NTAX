/**
 * Editing one block, in a way both interfaces can drive.
 *
 * The two arrangements differ in *where* a block's fields appear — a labelled grid under a select in the
 * classic form, a property list beside the block it belongs to in the modern editor — but they must not
 * differ in *what* a field is called or what it writes. So the fields are described once, here, and the
 * interfaces draw that description their own way.
 *
 * Two things are deliberately absent from the list. **Font size and colour** are not block properties:
 * they come from the brand kit, which is why the classic grid prints that fact under the field instead
 * of offering a value that would do nothing. **`required`** is not in `EmailBlock` and is not added
 * here — the sentences whose presence is a mechanism are listed in `emailCodeV0.ts` and matched on
 * their wording, so a shared union two other agents also hold does not have to change for it.
 */
import type { EmailBlock, EmailCondition } from "@C7NTAX/shared";
import { EMAIL_CONDITIONS } from "@C7NTAX/shared";
import { BLOCK_KINDS } from "./emailBlocks";

export interface BlockField {
  name: string;
  label: string;
  /** What the field holds, as the interface should offer it. */
  control: "text" | "textarea" | "select";
  value: string;
  options?: { value: string; label: string }[];
  /** The sentence under the field, where the field needs one. */
  hint?: string;
}

/** The scalar fields of a block. `facts.items` and `table.rows` are edited by `BlockRowsEditor`. */
export function blockFields(block: EmailBlock): BlockField[] {
  switch (block.kind) {
    case "heading":
      return [
        { name: "text", label: "Text", control: "text", value: block.text, hint: "h1–h4 only; h5 and h6 are not in the tag set" },
        {
          name: "level",
          label: "Level",
          control: "select",
          value: String(block.level ?? 2),
          options: [
            { value: "1", label: "1 — a header line" },
            { value: "2", label: "2 — a section inside the message" },
          ],
        },
      ];
    case "paragraph":
      return [{ name: "html", label: "Text", control: "textarea", value: block.html, hint: "Fields go in as {{ticket.number}} — insert them from the palette rather than typing them." }];
    case "note":
      return [
        { name: "text", label: "Text", control: "textarea", value: block.text },
        {
          name: "tone",
          label: "Tone",
          control: "select",
          value: block.tone ?? "neutral",
          options: [
            { value: "neutral", label: "neutral" },
            { value: "warn", label: "warn — something to act on" },
            { value: "good", label: "good" },
          ],
        },
      ];
    case "button":
      return [
        { name: "label", label: "Label", control: "text", value: block.label },
        { name: "href", label: "Link", control: "text", value: block.href, hint: "https, mailto, tel or a path. Anything else is refused by the mail sanitiser, not escaped." },
      ];
    case "quote":
      return [
        { name: "title", label: "Title", control: "text", value: block.title ?? "" },
        { name: "source", label: "Source", control: "text", value: block.source ?? "", hint: "Who said it — shown under the quote and kept in the text part." },
        { name: "html", label: "What it says", control: "textarea", value: block.html },
      ];
    case "facts":
      return [{ name: "title", label: "Title", control: "text", value: block.title ?? "" }];
    case "table":
      return [{ name: "title", label: "Title", control: "text", value: block.title ?? "" }];
    case "image":
      return [
        { name: "alt", label: "Alt text", control: "text", value: block.alt, hint: "Required in practice: a picture may not arrive, and the text part carries these words." },
        { name: "src", label: "Image", control: "text", value: block.src },
        { name: "href", label: "Link", control: "text", value: block.href ?? "" },
      ];
    case "attachment":
      return [
        { name: "name", label: "File name", control: "text", value: block.name },
        { name: "note", label: "Note", control: "text", value: block.note ?? "" },
      ];
    case "conditional":
      return [
        {
          name: "when",
          label: "Condition",
          control: "select",
          value: block.when,
          options: EMAIL_CONDITIONS.map((condition) => ({ value: condition.key, label: condition.label })),
          hint: "When the condition is false the blocks inside are not sent at all — not sent empty.",
        },
      ];
    default:
      return [];
  }
}

/** Write one scalar field back onto a block. */
export function setBlockField(block: EmailBlock, name: string, value: string): EmailBlock {
  switch (block.kind) {
    case "heading":
      if (name === "text") return { ...block, text: value };
      if (name === "level") return { ...block, level: value === "1" ? 1 : 2 };
      return block;
    case "paragraph":
      return name === "html" ? { ...block, html: value } : block;
    case "note":
      if (name === "text") return { ...block, text: value };
      if (name === "tone") return { ...block, tone: value === "warn" ? "warn" : value === "good" ? "good" : "neutral" };
      return block;
    case "button":
      if (name === "label") return { ...block, label: value };
      if (name === "href") return { ...block, href: value };
      return block;
    case "quote":
      if (name === "title") return { ...block, title: value };
      if (name === "source") return { ...block, source: value };
      if (name === "html") return { ...block, html: value };
      return block;
    case "facts":
      return name === "title" ? { ...block, title: value } : block;
    case "table":
      return name === "title" ? { ...block, title: value } : block;
    case "image":
      if (name === "alt") return { ...block, alt: value };
      if (name === "src") return { ...block, src: value };
      if (name === "href") return { ...block, href: value };
      return block;
    case "attachment":
      if (name === "name") return { ...block, name: value };
      if (name === "note") return { ...block, note: value };
      return block;
    case "conditional":
      return name === "when" ? { ...block, when: value as EmailCondition } : block;
    default:
      return block;
  }
}

/** The rows a `facts` or `table` block holds, for a rows editor. */
export function blockRows(block: EmailBlock): { label: string; value: string }[] {
  if (block.kind === "facts") return block.items.map((item) => ({ label: item.label, value: item.value }));
  if (block.kind === "table") return block.rows.map((row) => ({ label: row[0] ?? "", value: row[1] ?? "" }));
  return [];
}

export function setBlockRows(block: EmailBlock, rows: { label: string; value: string }[]): EmailBlock {
  if (block.kind === "facts") return { ...block, items: rows.map((row) => ({ label: row.label, value: row.value })) };
  if (block.kind === "table") return { ...block, rows: rows.map((row) => [row.label, row.value]) };
  return block;
}

/** A fresh block of a kind, so "Add block" always produces something drawable. */
export function defaultBlock(kind: EmailBlock["kind"]): EmailBlock {
  switch (kind) {
    case "heading": return { kind: "heading", level: 2, text: "A heading" };
    case "paragraph": return { kind: "paragraph", html: "<p></p>" };
    case "button": return { kind: "button", label: "Open the portal", href: "{{portal.url}}" };
    case "facts": return { kind: "facts", title: "Details", items: [{ label: "Status", value: "{{ticket.status}}" }] };
    case "quote": return { kind: "quote", html: "{{note.body}}", source: "{{contact.fullName}}" };
    case "table": return { kind: "table", title: "Lines", columns: ["Line", "Amount"], rows: [["", ""]] };
    case "image": return { kind: "image", src: "", alt: "Describe the picture in words" };
    case "divider": return { kind: "divider" };
    case "note": return { kind: "note", text: "" };
    case "attachment": return { kind: "attachment", name: "{{invoice.number}}.pdf" };
    case "conditional": return { kind: "conditional", when: "ticket.hasNote", blocks: [{ kind: "paragraph", html: "<p></p>" }] };
    case "signature": return { kind: "signature" };
    case "footer": return { kind: "footer" };
    default: return { kind: "paragraph", html: "<p></p>" };
  }
}

/** The palette's kinds, in the order the panel offers them. */
export function paletteKinds(): { kind: EmailBlock["kind"]; label: string; say: string }[] {
  return BLOCK_KINDS.filter((entry) => entry.palette).map(({ kind, label, say }) => ({ kind, label, say }));
}

export function moveBlock(blocks: EmailBlock[], index: number, delta: number): EmailBlock[] {
  const target = index + delta;
  if (target < 0 || target >= blocks.length) return blocks;
  const next = [...blocks];
  const [moved] = next.splice(index, 1);
  if (!moved) return blocks;
  next.splice(target, 0, moved);
  return next;
}

export function insertBlock(blocks: EmailBlock[], block: EmailBlock, at?: number): EmailBlock[] {
  const next = [...blocks];
  next.splice(at ?? next.length, 0, block);
  return next;
}

export function removeBlock(blocks: EmailBlock[], index: number): EmailBlock[] {
  return blocks.filter((_, position) => position !== index);
}

export function replaceBlock(blocks: EmailBlock[], index: number, block: EmailBlock): EmailBlock[] {
  return blocks.map((entry, position) => (position === index ? block : entry));
}

/** Where a field token should be inserted: into the block being edited, at the end of its text. */
export function insertToken(block: EmailBlock, token: string): EmailBlock {
  const snippet = `{{${token}}}`;
  switch (block.kind) {
    case "heading": return { ...block, text: `${block.text}${snippet}` };
    case "paragraph": return { ...block, html: `${block.html}${snippet}` };
    case "note": return { ...block, text: `${block.text}${snippet}` };
    case "quote": return { ...block, html: `${block.html}${snippet}` };
    case "button": return { ...block, href: token.includes("url") ? snippet : block.href, label: token.includes("url") ? block.label : `${block.label}` };
    case "facts": return { ...block, items: [...block.items, { label: "New fact", value: snippet }] };
    case "table": return { ...block, rows: [...block.rows, [snippet, ""]] };
    case "attachment": return { ...block, name: `${block.name}` };
    default: return block;
  }
}
