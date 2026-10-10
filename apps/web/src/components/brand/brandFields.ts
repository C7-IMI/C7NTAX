/**
 * The identity's fields, in the words the screen uses, arranged into the subjects it is read by.
 *
 * **The words come from one place.** `BRAND_FIELDS` in `packages/shared/src/brand.ts` holds each field's
 * `label` and `help`, and the API validates against the same list, so a screen that retyped a label
 * would be a second description of a field that can drift from the one the API enforces. This module
 * therefore *arranges* those entries rather than restating them: it adds the subject a field belongs
 * to, and the sentence saying what an empty value means.
 *
 * The empty-value sentences exist because a brand is legitimately half-filled and `null` is meaningful
 * everywhere in it: a blank logo does not print a blank space where a logo goes, it prints the wordmark
 * in type (`resolveDocumentBrand`), and a person clearing a field deserves to know which of those two
 * they are choosing. That is the same rule the email screens' `unsetNote` follows.
 */
import {
  BRAND_FIELDS,
  BRAND_HEADLINE_FIELDS,
  contrastRatio,
  DEFAULT_BRAND,
  DOCUMENT_PALETTE,
  type BrandKit,
} from "@C7NTAX/shared";
import type { LucideIcon } from "lucide-react";
import { AtSign, Image as ImageIcon, MapPin, Palette, ScrollText, Type } from "lucide-react";

/** The six subjects the identity is read by — the rail in the modern interface, the form's sections in the classic one. */
export type IdentitySubject = "marks" | "name" | "contact" | "colours" | "paper" | "email";

export interface IdentitySubjectSpec {
  id: IdentitySubject;
  label: string;
  icon: LucideIcon;
  /** What the subject answers, in one sentence. */
  blurb: string;
}

export const IDENTITY_SUBJECTS: IdentitySubjectSpec[] = [
  {
    id: "marks",
    label: "The marks",
    icon: ImageIcon,
    blurb: "The logo, the dark-background lockup and the square icon — what a document and an email wear.",
  },
  {
    id: "name",
    label: "Name and description",
    icon: Type,
    blurb: "What the company is called, the line under it, and the name set in type when there is no artwork.",
  },
  {
    id: "contact",
    label: "Contact and address",
    icon: MapPin,
    blurb: "The phone line, the postal address and the website, as they should read on paper.",
  },
  {
    id: "colours",
    label: "Colours",
    icon: Palette,
    blurb: "The two colours this instance owns — one of which is printed, so it has to survive paper.",
  },
  {
    id: "paper",
    label: "Footer and legal text",
    icon: ScrollText,
    blurb: "The sentence at the foot of every generated document, and the small print.",
  },
  {
    id: "email",
    label: "Email sender",
    icon: AtSign,
    blurb: "The name and address the product's own mail appears to come from, and where a reply goes.",
  },
];

/** Which subject each field is read under. Keyed by `keyof BrandKit`, so a new field cannot be missed. */
const SUBJECT_OF: Record<Exclude<keyof BrandKit, "documentPresentation">, IdentitySubject> = {
  productName: "name",
  companyName: "name",
  tagline: "name",
  logoUrl: "marks",
  logoDarkUrl: "marks",
  iconUrl: "marks",
  wordmark: "name",
  contactLine: "contact",
  addressLines: "contact",
  website: "contact",
  primaryColor: "colours",
  accentColor: "colours",
  documentFooter: "paper",
  legalText: "paper",
  fromName: "email",
  fromEmail: "email",
  replyTo: "email",
};

/**
 * What an empty value means, per field.
 *
 * Not "—": each of these names the thing that will be printed instead, which is the answer to the
 * question a person has when they are looking at an empty box next to a document.
 */
const UNSET: Partial<Record<keyof BrandKit, string>> = {
  productName: "Not set — the name this product shipped with is used.",
  companyName: "Not set — the company name this product shipped with is printed instead.",
  tagline: "Not set — the product name stands in under the company name.",
  logoUrl:
    "No logo yet — a document that asks for a lockup uses the icon, and the wordmark in type when there is neither. Every document still has something at the top of the page.",
  logoDarkUrl: "No dark-background lockup — an email drawn on a dark ground uses the light one.",
  iconUrl: "No icon — the app icon, the favicon and an internal report's letterhead fall back to the wordmark in type.",
  wordmark: "Not set — the product name is set in type instead.",
  contactLine: "Not set — no contact line is printed.",
  addressLines: "No address — a document that is posted prints none.",
  website: "Not set — no website is printed.",
  primaryColor: "Not set — the shipped crimson is used.",
  accentColor: "Not set — the shipped cyan is used; it is not printed on paper.",
  documentFooter: "Not set — a document ends without this sentence.",
  legalText: "Not set — a document's footer falls back to a confidential line naming the company.",
  fromName: "Not set — the address is shown on its own.",
  fromEmail: "Not set — the instance's own SMTP_FROM is used.",
  replyTo: "Not set — no Reply-To is sent.",
};

export interface BrandFieldSpec {
  key: keyof BrandKit;
  label: string;
  help: string;
  kind: "text" | "lines" | "color" | "image";
  subject: IdentitySubject;
  /** One of `BRAND_HEADLINE_FIELDS`: the two fields people came here to change. */
  headline: boolean;
  /** What an empty value means, in the words above. */
  unset: string;
}

/**
 * The seventeen fields, in `BRAND_FIELDS`' own order, each carrying that list's `label` and `help`.
 *
 * The headline pair is marked from `BRAND_HEADLINE_FIELDS` rather than named here, so "these two draw
 * the eye" is a fact about the contract rather than a decision this file makes twice.
 */
export const BRAND_FIELD_SPECS: BrandFieldSpec[] = BRAND_FIELDS.map((field) => ({
  key: field.key,
  label: field.label,
  help: field.help,
  kind: field.kind,
  subject: SUBJECT_OF[field.key],
  headline: BRAND_HEADLINE_FIELDS.includes(field.key),
  unset: UNSET[field.key] ?? "Not set — the built-in value is used.",
}));

export function fieldsIn(subject: IdentitySubject): BrandFieldSpec[] {
  return BRAND_FIELD_SPECS.filter((field) => field.subject === subject);
}

export function fieldSpec(key: keyof BrandKit): BrandFieldSpec {
  return BRAND_FIELD_SPECS.find((field) => field.key === key) ?? BRAND_FIELD_SPECS[0]!;
}

// ── A draft, as text ─────────────────────────────────────────────────────────────────────────────

/**
 * The draft is a map of **raw text**, exactly as the email brand editor's is: one string per field, and
 * the address as one line per entry, so a form is a form in both arrangements and neither has to know
 * how a field is stored.
 */
export type BrandDraft = Record<string, string>;

export function draftFromKit(kit: BrandKit): BrandDraft {
  const draft: BrandDraft = {};
  for (const field of BRAND_FIELD_SPECS) {
    const value = kit[field.key];
    draft[field.key] = field.key === "addressLines"
      ? (Array.isArray(value) ? value.join("\n") : "")
      : value === null || value === undefined
        ? ""
        : String(value);
  }
  return draft;
}

/**
 * The draft's text as what `PUT /api/brand` is sent.
 *
 * Three cases, and each is deliberate:
 *   · **an empty string** for a text field, which *clears* it — "left blank means use the instance's"
 *     is the opposite mistake, and the API reads a present-but-blank field as cleared;
 *   · **lines** for the address, trimmed and without blanks;
 *   · **a colour unchanged when blank**, because the API refuses a value that is not a hex colour and
 *     falls back to the stored one for an empty field rather than clearing it.
 */
export function draftPayload(key: keyof BrandKit, raw: string): unknown {
  if (key === "addressLines") {
    return raw.split("\n").map((line) => line.trim()).filter(Boolean);
  }
  return raw.trim();
}

/** The whole draft, as one `PUT /api/brand` body. All seventeen fields, and no `documentPresentation`. */
export function identityPatch(draft: BrandDraft): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of BRAND_FIELD_SPECS) patch[field.key] = draftPayload(field.key, draft[field.key] ?? "");
  return patch;
}

/**
 * The draft as a brand a document could be drawn from, **before it is saved**.
 *
 * The preview has to answer "what will the page look like if I save this", so it is drawn from the
 * draft rather than from the saved record; the resolution an unset field gets (a blank logo falling back
 * to the icon and then to the wordmark, a blank name to the shipped one) is not re-implemented here —
 * `normaliseBrand` decides it when the preview asks for a `DocumentBrand`, which is the same function
 * the API uses. So a preview cannot be more optimistic than the save.
 */
export function kitFromDraft(draft: BrandDraft): Partial<BrandKit> {
  const text = (key: keyof BrandKit): string | null => (draft[key]?.trim() ? draft[key]!.trim() : null);
  return {
    productName: draft.productName ?? "",
    companyName: draft.companyName ?? "",
    tagline: text("tagline"),
    logoUrl: text("logoUrl"),
    logoDarkUrl: text("logoDarkUrl"),
    iconUrl: text("iconUrl"),
    wordmark: text("wordmark"),
    contactLine: text("contactLine"),
    addressLines: (draft.addressLines ?? "").split("\n").map((line) => line.trim()).filter(Boolean),
    website: text("website"),
    primaryColor: draft.primaryColor?.trim() || undefined,
    accentColor: draft.accentColor?.trim() || undefined,
    documentFooter: text("documentFooter"),
    legalText: text("legalText"),
    fromName: text("fromName"),
    fromEmail: text("fromEmail"),
    replyTo: text("replyTo"),
  };
}

// ── Colours ──────────────────────────────────────────────────────────────────────────────────────

/** The shape a colour must be, and the same one the API enforces. */
export const COLOUR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A colour that cannot be sent, or null when the field is empty (which keeps the stored value). */
export function colourProblem(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (!COLOUR_PATTERN.test(value)) {
    return "A colour has to be a hex value such as #c00000. Anything else is refused, so that a typo cannot reach a printed page.";
  }
  return null;
}

/**
 * The contrast sentence for a settable colour.
 *
 * It is a sentence rather than a red border because the failure it describes is invisible on screen and
 * only appears on paper: a mark below 3:1 against white survives a monitor and disappears on a
 * photocopy, and an invoice is the document most likely to be photocopied. The threshold and the ratio
 * are the contract's (`DOCUMENT_MARK_MIN_CONTRAST`, `contrastRatio`), never a number typed here.
 */
export function contrastSentence(colour: string, minimum: number): { ratio: number; survives: boolean; text: string } {
  const safe = COLOUR_PATTERN.test(colour.trim()) ? colour.trim() : DEFAULT_BRAND.primaryColor;
  const ratio = contrastRatio(safe, DOCUMENT_PALETTE.paper);
  const shown = `${ratio.toFixed(1)}:1`;
  if (ratio < minimum) {
    return {
      ratio,
      survives: false,
      text: `${shown} against white — below the ${minimum}:1 a mark needs. This colour will not survive paper: it disappears on a greyscale print and all but disappears on a photocopy. Paper gets no second chance to say it.`,
    };
  }
  return {
    ratio,
    survives: true,
    text: `${shown} against white — above the ${minimum}:1 a mark needs, so it survives a greyscale print and a photocopy.`,
  };
}

/**
 * The colours a person is most likely to want, offered as swatches in the modern arrangement.
 *
 * The first two are the instance's own defaults: a swatch row where the current colour is not in it is a
 * row you have to leave to type.
 */
export const COLOUR_SWATCHES: string[] = [
  DEFAULT_BRAND.primaryColor,
  DEFAULT_BRAND.accentColor,
  "#0f172a",
  "#1d4ed8",
  "#047857",
  "#b45309",
  "#7c3aed",
  "#be123c",
];
