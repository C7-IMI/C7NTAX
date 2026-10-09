/**
 * The Studio's own calls — the template, the preview, the versions and the two writes that change
 * what a client reads.
 *
 * The read/write chrome (`useEmailRead`, `writeEmail`, `describeReadFailure`, `Read<T>`) is shared
 * with the Brand kit and Delivery log screens in `emailApi.ts`, because "a read that did not arrive is
 * not an empty list" is one rule and it should be worded once.
 *
 * Two calls carry the weight of this screen:
 *
 *  · **`POST /api/email/preview` is the only renderer in the product.** There is deliberately no
 *    client-side renderer here: the preview a person approves has to be literally the message that
 *    goes out, and a second renderer written to fill a gap is exactly how that stops being true. If
 *    this call fails the preview says which read failed and draws nothing.
 *  · **`PUT /api/email/templates/:key` writes a version.** `text: null` means "derive it from the
 *    blocks" — the default, and the only setting that cannot drift.
 */
import type { EmailBlock, EmailMessageKey, EmailTemplate, EmailTemplateVersion } from "@C7NTAX/shared";
import api from "../../api";
import {
  describeReadFailure,
  normaliseList,
  useEmailRead,
  writeEmail,
  type Read,
  type WriteResult,
} from "./emailApi";
import { EMAIL_MESSAGE_FACTS } from "./emailCatalogue";
import { codeBlocksFor } from "./emailCodeV0";

/** `GET /api/email/templates/:key`. */
export function useEmailTemplate(key: EmailMessageKey): Read<EmailTemplate> {
  return useEmailRead<EmailTemplate>(`/email/templates/${encodeURIComponent(key)}`, "This template");
}

/** `GET /api/email/templates/:key/versions`. */
export function useEmailVersions(key: EmailMessageKey): Read<unknown> {
  return useEmailRead<unknown>(`/email/templates/${encodeURIComponent(key)}/versions`, "The version history");
}

/**
 * The versions as a list, however the API envelopes them. The Studio reads the history through this
 * rather than assuming a bare array, because a list route that names its own key is the product's own
 * convention and the two should be able to differ without a blank panel.
 */
export function versionsFrom(read: Read<unknown>): EmailTemplateVersion[] {
  if (read.status !== "ok") return [];
  return normaliseList<EmailTemplateVersion>(read.data, "versions");
}

/** `PUT /api/email/templates/:key`. */
export function saveEmailTemplate(
  key: EmailMessageKey,
  body: { subject: string; blocks: EmailBlock[]; text: string | null; note?: string },
): Promise<WriteResult<EmailTemplate>> {
  return writeEmail<EmailTemplate>("put", `/email/templates/${encodeURIComponent(key)}`, body, "The template could not be saved");
}

/** `POST /api/email/templates/:key/reset` — back to the body the code writes. */
export function resetEmailTemplate(key: EmailMessageKey): Promise<WriteResult<EmailTemplate>> {
  return writeEmail<EmailTemplate>("post", `/email/templates/${encodeURIComponent(key)}/reset`, undefined, "The template could not be reset");
}

/** `POST /api/email/templates/:key/test` — a real send to a named address, logged. */
export function sendTemplateTest(key: EmailMessageKey, to: string): Promise<WriteResult<{ messageId?: string }>> {
  return writeEmail<{ messageId?: string }>(
    "post",
    `/email/templates/${encodeURIComponent(key)}/test`,
    { to },
    "The test send was refused",
  );
}

export interface PreviewAnswer {
  subject: string;
  html: string;
  text: string;
  derivedText: string;
  warnings: string[];
  attachments: { filename: string; contentType?: string; note?: string }[];
}

export interface PreviewRequest {
  key: EmailMessageKey;
  subject: string;
  blocks: EmailBlock[];
  /** Only sent when somebody has edited it; `null` asks the API to derive the text from the blocks. */
  text: string | null;
  /** The record's own number, as the chooser names it. */
  recordId: string | null;
  /** The record's id, which is what the endpoint resolves fields by. Falls back to the number. */
  targetId?: string | null;
}

export interface PreviewState {
  status: "idle" | "loading" | "ok" | "unavailable";
  data: PreviewAnswer | null;
  message: string | null;
}

/** The preview's shape, read tolerantly: the endpoint owes all four parts and may name them. */
export function previewFrom(payload: unknown): PreviewAnswer | null {
  const raw = unwrapRecord(payload);
  if (!raw) return null;
  const html = typeof raw.html === "string" ? raw.html : "";
  const text = typeof raw.text === "string" ? raw.text : "";
  if (!html && !text) return null;
  return {
    subject: typeof raw.subject === "string" ? raw.subject : "",
    html,
    text,
    derivedText: typeof raw.derivedText === "string" ? raw.derivedText : text,
    warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((entry): entry is string => typeof entry === "string") : [],
    attachments: Array.isArray(raw.attachments)
      ? raw.attachments
          .map((entry) => {
            const item = entry as Record<string, unknown>;
            return typeof item.filename === "string"
              ? {
                  filename: item.filename,
                  ...(typeof item.contentType === "string" ? { contentType: item.contentType } : {}),
                  ...(typeof item.note === "string" ? { note: item.note } : {}),
                }
              : null;
          })
          .filter((entry): entry is { filename: string; contentType?: string; note?: string } => entry !== null)
      : [],
  };
}

function unwrapRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
    return record.data as Record<string, unknown>;
  }
  return record;
}

/**
 * Ask the one renderer to draw the message against a real record.
 *
 * `context.kind` is `sample` when no record is chosen, which is the contract's third case: the fields'
 * own samples, never rendered into a real message. The failure sentence names the endpoint, because
 * "the preview could not be rendered" is not actionable on its own.
 */
export async function requestPreview(request: PreviewRequest): Promise<{ ok: true; answer: PreviewAnswer } | { ok: false; message: string }> {
  const kind = request.recordId ? (request.recordId.startsWith("INV-") ? "invoice" : "ticket") : "sample";
  const id = request.targetId ?? request.recordId ?? "sample";
  const target = request.recordId ? { kind, id } : { kind: "sample", id: "sample" };
  try {
    const response = await api.post("/email/preview", {
      key: request.key,
      subject: request.subject,
      blocks: request.blocks,
      ...(request.text === null ? {} : { text: request.text }),
      /*
       * The record is sent under `context` (the shape this screen was specified against) **and** under
       * `target`, which is the name the route reads. Sending one and not the other is how a preview comes
       * back resolved against the sample records while the chooser says otherwise — the screen would then
       * be showing figures for a record nobody selected, which is worse than showing none.
       */
      context: target,
      target,
    });
    const answer = previewFrom(response.data);
    if (!answer) {
      return { ok: false, message: "The preview answered without an html or a text part, so nothing is drawn." };
    }
    return { ok: true, answer };
  } catch (error) {
    return { ok: false, message: describeReadFailure(error, "The preview") };
  }
}

/**
 * The template the editor opens with when `GET /templates/:key` has not answered.
 *
 * It is the **code's own body, transcribed into blocks** — the same thing the API imports read-only as
 * v0 — and the screen labels it "the code's version, not a record" wherever it is used, so a
 * transcription is never mistaken for something somebody saved.
 */
export function codeTemplateForKey(key: EmailMessageKey): EmailTemplate {
  const fact = EMAIL_MESSAGE_FACTS.find((entry) => entry.key === key);
  return {
    key,
    name: fact?.name ?? key,
    group: fact?.group ?? "reserved",
    audience: fact?.audience ?? "customer",
    editingClass: fact?.editingClass ?? "full",
    live: fact?.live ?? false,
    subject: fact?.subject ?? "",
    blocks: codeBlocksFor(key),
    text: null,
    derivedText: "",
    state: "default",
    version: 0,
    updatedAt: null,
    updatedByName: null,
  };
}
