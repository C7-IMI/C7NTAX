/**
 * The fields the **API** says a message may use, laid beside the ones the shared vocabulary names.
 *
 * `packages/shared/src/emailTemplate.ts` carries 21 fields with a sample each, and they are what the
 * editor's palette groups by. The API's own registry is wider: a message may use the computed fields a
 * template function builds at send time — `message.greeting` (blank when the ticket has no contact name),
 * `message.clientLine`, `message.code`, `message.credential` — which are not merge fields at all, they are
 * sentences the sender assembles.
 *
 * Without them the canvas would draw `{{message.greeting}}` as "no such field", which is wrong twice over:
 * the field exists, and the reason it has no value in a *drawing* is that only the renderer can compute
 * it. So the API's registry is read from `GET /api/email/messages` and registered here, and a token the
 * contract does not name is then labelled with the API's own words and its own sample — marked as a
 * sample, because that is what it is until the message is rendered.
 *
 * This is a module-level registry rather than a prop because `fieldValue()` is called from the canvas, the
 * key/value rows, the palette and both editors, and threading one list through five call sites would make
 * every one of them depend on a read that is not theirs. It is written once, from the one read that owns
 * it, in the page.
 */
export interface RegisteredField {
  token: string;
  label: string;
  sample: string;
  /** The group the field is offered under: the contract's own, or "This message" for a computed one. */
  group: string;
}

const CONTRACT_GROUPS = ["Ticket", "Client", "Contact", "Technician", "Invoice", "Portal", "Instance"];

/** `message.code` is computed by the sender; `ticket.*` and friends come from the record. */
function groupForToken(token: string, apiGroup: unknown): string {
  if (typeof apiGroup === "string" && apiGroup) return apiGroup;
  const prefix = token.split(".")[0] ?? "";
  if (prefix === "message") return "This message";
  const named = prefix.charAt(0).toUpperCase() + prefix.slice(1);
  return CONTRACT_GROUPS.includes(named) ? named : "This message";
}

function readFields(payload: unknown): RegisteredField[] {
  const list = Array.isArray(payload) ? payload : [];
  const fields: RegisteredField[] = [];
  for (const entry of list) {
    const item = entry as { token?: unknown; label?: unknown; sample?: unknown; group?: unknown } | null;
    if (!item || typeof item.token !== "string") continue;
    fields.push({
      token: item.token,
      label: typeof item.label === "string" ? item.label : item.token,
      sample: typeof item.sample === "string" ? item.sample : "",
      group: groupForToken(item.token, item.group),
    });
  }
  return fields;
}

let registry: RegisteredField[] = [];

/** Register the union of every message's fields, from the one read that owns them. */
export function setRegisteredFields(perMessage: unknown[]): void {
  const next: RegisteredField[] = [];
  for (const fields of perMessage) {
    for (const field of readFields(fields)) {
      if (!next.some((entry) => entry.token === field.token)) next.push(field);
    }
  }
  registry = next;
}

/** The computed fields, which the contract's 21 do not name. */
export function computedFields(): RegisteredField[] {
  return registry.filter((field) => !CONTRACT_GROUPS.includes(field.group));
}

/** The API's words for a token the shared vocabulary does not name, if it named it at all. */
export function registeredField(token: string): RegisteredField | null {
  return registry.find((field) => field.token === token) ?? null;
}
