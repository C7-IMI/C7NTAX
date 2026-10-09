/**
 * One row of the Studio's list: the code's facts about a message, with whatever the API knows laid
 * over the top.
 *
 * The split matters and the screen says which half a row came from:
 *
 *  · **The code's half** — the key, the name, the group, the subject *as written*, the trigger, the
 *    reader, the body, the attachments and the editing class — is a fact about
 *    `packages/email/src/EmailService.ts`, and it is true whether or not the API is answering.
 *  · **The API's half** — the template's state, its version and how many clients hold an override — is
 *    *state*, and it is read rather than assumed.
 *
 * So a row is built from the code and then, when `GET /api/email/messages` answers, the state fields are
 * replaced by the API's. When it does not answer the rows are still drawn — because "every message this
 * instance sends" is a question the code can answer — and `fromCode` is `true` so the screen can say that
 * what it is showing is the code's state rather than the instance's.
 *
 * The API's payload is read as an untyped record on purpose. Its shape is being written in parallel with
 * this screen, and `ApiMessage` in `emailApi.ts` is the shape the *other* Studio screens consume; a row
 * here reads the handful of fields it needs and treats everything absent as "not stated", so a field
 * renamed on the API side degrades to the code's own fact instead of failing the build.
 */
import { EMAIL_MESSAGE_FACTS, EMAIL_FACTS_BY_KEY } from "./emailCatalogue";
import type { EmailAudience, EmailEditingClass, EmailMessageKey, EmailTemplateState } from "@C7NTAX/shared";

export interface EmailMessageRow {
  key: EmailMessageKey;
  name: string;
  group: string;
  audience: EmailAudience;
  editingClass: EmailEditingClass;
  live: boolean;
  reserved: boolean;
  subject: string | null;
  trigger: string;
  reader: string;
  body: string;
  attachments: string | null;
  state: EmailTemplateState;
  overrideCount: number | null;
  version: number | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

type Unstructured = Record<string, unknown>;

function asState(value: unknown): EmailTemplateState | null {
  return value === "customised" || value === "overridden" || value === "default" ? value : null;
}

function asEditingClass(value: unknown): EmailEditingClass | null {
  return value === "full" || value === "security" || value === "internal" || value === "proposed" ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A field on the row, or on the `template` object the API nests it in. */
function pick(row: Unstructured, field: string): unknown {
  const direct = row[field];
  if (direct !== undefined) return direct;
  const template = row.template;
  if (template && typeof template === "object") return (template as Unstructured)[field];
  return undefined;
}

/** Build the list, taking the API's answer where there is one. */
export function buildMessageRows(apiRows: readonly Unstructured[] | null): { rows: EmailMessageRow[]; fromCode: boolean } {
  const byKey = new Map<string, Unstructured>();
  for (const entry of apiRows ?? []) {
    const key = entry?.key;
    if (typeof key === "string") byKey.set(key, entry);
  }
  const fromCode = byKey.size === 0;
  const rows = EMAIL_MESSAGE_FACTS.map((fact) => {
    const api = byKey.get(fact.key);
    return {
      key: fact.key,
      name: asString(api?.name) ?? fact.name,
      group: asString(api?.group) ?? fact.group,
      audience: api?.audience === "internal" ? "internal" : fact.audience,
      editingClass: asEditingClass(api?.editingClass) ?? fact.editingClass,
      live: typeof api?.live === "boolean" ? api.live : fact.live,
      reserved: fact.reserved,
      subject: api ? asString(pick(api, "subject")) ?? fact.subject : fact.subject,
      trigger: fact.trigger,
      reader: fact.reader,
      body: fact.body,
      attachments: fact.attachments,
      state: api ? asState(pick(api, "state")) ?? "default" : "default",
      overrideCount: api ? asNumber(pick(api, "overrideCount")) : null,
      version: api ? asNumber(pick(api, "version")) ?? asNumber(pick(api, "templateVersion")) : null,
      updatedAt: api ? asString(pick(api, "updatedAt")) : null,
      updatedByName: api ? asString(pick(api, "updatedByName")) : null,
    } satisfies EmailMessageRow;
  });
  return { rows, fromCode };
}

/** The facts for a key, for a panel that has a row and needs the code's own sentence about it. */
export function factFor(key: EmailMessageKey) {
  return EMAIL_FACTS_BY_KEY[key];
}
