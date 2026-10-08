/**
 * What a customer's portal lets them see and do.
 *
 * The portal's rules used to be one set for the whole deployment, which is fine until two clients
 * need different treatment: a one-mailbox small business where everybody should see everything, and
 * a three-hundred-person client where nobody should see anybody else's tickets. Autotask,
 * ConnectWise and Scoro all keep that on the client record — with a per-contact overrule for the
 * person who runs the account — so the same three levels are resolved here:
 *
 *   1. **the contact** (this person's own overrule),
 *   2. **the client** (what this customer gets),
 *   3. **the instance** (the Portal section of the configuration, then the documented default).
 *
 * A level only has a value when somebody set one, so each field is inherited independently and the
 * screen can say where each answer came from. Nothing here is cached: the configuration is read per
 * call, which is what makes an administrator's change take effect on the customer's next page load.
 */
import { configFlag, configText, environmentValue, savedValue } from "./appSettings";

/** `contact` is "their own tickets"; `company` is "every ticket at their client". */
export type PortalVisibility = "contact" | "company";

/** Which level decided a value. `default` is the documented default, with nothing set anywhere. */
export type PortalPolicySource = "contact" | "client" | "instance" | "default";

export interface PortalPolicy {
  visibility: PortalVisibility;
  allowTicketCreation: boolean;
  allowReplies: boolean;
  /** The board portal-raised tickets land on, if one is configured for this client or instance. */
  boardId: string | null;
  /** Where each answer came from, so a screen can say "this client differs here". */
  sources: {
    visibility: PortalPolicySource;
    allowTicketCreation: PortalPolicySource;
    allowReplies: PortalPolicySource;
    boardId: PortalPolicySource;
  };
}

/** The per-client values as stored, with `null` meaning "inherit". */
export interface ClientPortalOverrides {
  visibility: PortalVisibility | null;
  allowTicketCreation: boolean | null;
  allowReplies: boolean | null;
  boardId: string | null;
}

/** The per-contact values as stored, with `null` meaning "inherit from the client". */
export interface ContactPortalOverrides {
  access: boolean | null;
  visibility: PortalVisibility | null;
}

export function asVisibility(value: unknown): PortalVisibility | null {
  return value === "contact" || value === "company" ? value : null;
}

/**
 * Whether the instance supplied a field itself (a saved setting or the deployment's environment)
 * or whether the value is only the documented default. A screen uses this to distinguish "your
 * deployment asked for this" from "nobody has decided".
 */
function instanceSource(fieldId: string): PortalPolicySource {
  if (savedValue("portal", fieldId) !== undefined) return "instance";
  return environmentValue("portal", fieldId) !== undefined ? "instance" : "default";
}

/**
 * The instance's own policy — the Portal section of the configuration registry, which itself
 * falls back to the deployment's environment and then to a documented default.
 */
export function instancePortalPolicy(): PortalPolicy {
  const visibility = asVisibility(configText("portal", "visibility"));
  const boardId = configText("portal", "defaultBoardId").trim();
  return {
    visibility: visibility ?? "contact",
    allowTicketCreation: configFlag("portal", "allowTicketCreation"),
    allowReplies: configFlag("portal", "allowReplies"),
    boardId: boardId || null,
    sources: {
      visibility: visibility ? instanceSource("visibility") : "default",
      allowTicketCreation: instanceSource("allowTicketCreation"),
      allowReplies: instanceSource("allowReplies"),
      boardId: boardId ? instanceSource("defaultBoardId") : "default",
    },
  };
}

interface PolicyInput {
  client: ClientPortalOverrides | null;
  contact: ContactPortalOverrides | null;
}

/**
 * Resolves the policy from the three levels. Kept pure and taking plain values so the resolution
 * can be read — and checked — without a database.
 */
export function resolvePolicyFrom(input: PolicyInput): PortalPolicy {
  const instance = instancePortalPolicy();
  const { client, contact } = input;

  const visibility = contact?.visibility ?? client?.visibility ?? instance.visibility;
  const visibilitySource: PortalPolicySource = contact?.visibility
    ? "contact"
    : client?.visibility
      ? "client"
      : instance.sources.visibility;

  return {
    visibility,
    allowTicketCreation: client?.allowTicketCreation ?? instance.allowTicketCreation,
    allowReplies: client?.allowReplies ?? instance.allowReplies,
    boardId: client?.boardId ?? instance.boardId,
    sources: {
      visibility: visibilitySource,
      allowTicketCreation: client?.allowTicketCreation === null || client?.allowTicketCreation === undefined
        ? instance.sources.allowTicketCreation
        : "client",
      allowReplies: client?.allowReplies === null || client?.allowReplies === undefined
        ? instance.sources.allowReplies
        : "client",
      boardId: client?.boardId ? "client" : instance.sources.boardId,
    },
  };
}

/** The stored overrides for a client, or null when the client has none of any kind. */
export async function clientPortalOverrides(companyId: string): Promise<ClientPortalOverrides | null> {
  const { prisma } = await import("../index");
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      portalVisibility: true,
      portalAllowTicketCreation: true,
      portalAllowReplies: true,
      portalBoardId: true,
    },
  });
  if (!company) return null;
  return {
    visibility: asVisibility(company.portalVisibility),
    allowTicketCreation: company.portalAllowTicketCreation,
    allowReplies: company.portalAllowReplies,
    boardId: company.portalBoardId,
  };
}

export async function contactPortalOverrides(contactId: string): Promise<ContactPortalOverrides | null> {
  const { prisma } = await import("../index");
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { portalAccess: true, portalVisibility: true },
  });
  if (!contact) return null;
  return { access: contact.portalAccess, visibility: asVisibility(contact.portalVisibility) };
}

/**
 * The policy in force for a contact of a client. `contactId` is optional: a caller that only knows
 * the client gets the client's own policy, which is what the configuration screen shows.
 */
export async function resolvePortalPolicy(companyId: string, contactId?: string): Promise<PortalPolicy> {
  const [client, contact] = await Promise.all([
    clientPortalOverrides(companyId),
    contactId ? contactPortalOverrides(contactId) : Promise.resolve(null),
  ]);
  return resolvePolicyFrom({ client, contact });
}
