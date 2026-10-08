import type { PrismaClient } from "@prisma/client";
import { Permission } from "@C7NTAX/shared";

/**
 * The application's functions, offered to a model.
 *
 * Two rules decide what is in here, and both are about what happens when the model is wrong.
 *
 * 1. **A read function runs as the person asking.** It is gated on the same permission the
 *    equivalent screen is gated on, so a technician cannot use the assistant to see a client they
 *    cannot open. No function takes a permission as an argument: the caller's session is the
 *    authority, never the model.
 * 2. **Nothing here writes.** A function that would change data is a *proposal*: it raises the risk
 *    classified `AiAction` the AI actions screen already reviews, and a person decides. A model that
 *    can create a ticket directly is a model that can create a hundred while somebody reads the
 *    answer.
 *
 * A third rule is about the text: every `description` is written for the model, and every `summary`
 * is written for whoever reads the trace afterwards.
 *
 * The database client is passed into each function rather than reached for through a module import.
 * That keeps this file free of the API's entry point — importing a service must not start a server —
 * so the loop and its functions can be exercised directly, with a client of the caller's choosing.
 */

export interface AssistantCaller {
  userId: string;
  permissions: string[];
}

/** The slice of the Prisma client the functions use; structural, so a test client fits. */
export type AssistantDb = PrismaClient;

export interface ToolStep {
  tool: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  /** One line for the trace, in the application's terms. */
  summary: string;
  /** What the model is told. */
  content: string;
}

export interface AssistantTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** The permission the equivalent screen requires. */
  permission: Permission;
  kind: "read" | "propose";
  run(args: Record<string, unknown>, caller: AssistantCaller, db: AssistantDb): Promise<ToolStep>;
}

const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback);
const num = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clipped = (value: string, max = 600): string => (value.length > max ? `${value.slice(0, max)}…` : value);
/** A person's name is two columns in this schema, which is easy to forget when writing a prompt. */
const person = (user: { firstName: string; lastName: string } | null | undefined): string =>
  user ? `${user.firstName} ${user.lastName}`.trim() : "unknown";
const day = (value: Date | null | undefined) => (value ? value.toISOString().slice(0, 10) : "unknown");
const ok = (tool: string, args: Record<string, unknown>, summary: string, content: string): ToolStep =>
  ({ tool, arguments: args, ok: true, summary, content });
const refuse = (tool: string, args: Record<string, unknown>, summary: string): ToolStep =>
  ({ tool, arguments: args, ok: false, summary, content: summary });

/** A function with no arguments still needs an object schema, or some providers reject the tool. */
const NO_ARGS: Record<string, unknown> = { type: "object", properties: {}, additionalProperties: false };

const oneId = (name: string, description: string) => ({
  type: "object",
  properties: { [name]: { type: "string", description } },
  required: [name],
  additionalProperties: false,
});

const TOOLS: AssistantTool[] = [
  {
    name: "find_clients",
    description: "Find clients (companies) whose name matches a search term. Call this first whenever a question names a client, because the other client functions need the id it returns.",
    parameters: oneId("query", "Part of the client's name, e.g. 'Contoso'"),
    permission: Permission.ClientView,
    kind: "read",
    async run(args, _caller, db) {
      const query = str(args.query).trim();
      if (!query) return refuse("find_clients", args, "No search term was given.");
      const clients = await db.company.findMany({
        where: { name: { contains: query, mode: "insensitive" } },
        select: { id: true, name: true, email: true, phone: true, isActive: true, companyType: true },
        orderBy: { name: "asc" },
        take: 8,
      });
      if (!clients.length) return ok("find_clients", args, `No client matched "${query}".`, `No client matches "${query}".`);
      const content = clients
        .map(c => `${c.id} | ${c.name} | ${c.companyType ?? "Client"} | ${c.isActive ? "active" : "inactive"} | ${c.email ?? "no email"} | ${c.phone ?? "no phone"}`)
        .join("\n");
      return ok("find_clients", args, `${clients.length} client${clients.length === 1 ? "" : "s"} matched "${query}".`, `Clients (id | name | type | state | email | phone):\n${content}`);
    },
  },
  {
    name: "client_overview",
    description: "Everything held about one client: contact details, how many tickets they have and how many are still open, their most recent tickets, and how many assets are on record.",
    parameters: oneId("clientId", "The client id from find_clients"),
    permission: Permission.ClientView,
    kind: "read",
    async run(args, _caller, db) {
      const clientId = str(args.clientId).trim();
      const client = await db.company.findUnique({
        where: { id: clientId },
        select: { id: true, name: true, email: true, phone: true, website: true, isActive: true, companyType: true, createdAt: true },
      });
      if (!client) return refuse("client_overview", args, `No client exists with id ${clientId}.`);

      const [contacts, tickets, openTickets, assets, recent] = await Promise.all([
        db.contact.count({ where: { companyId: client.id } }),
        db.ticket.count({ where: { companyId: client.id } }),
        db.ticket.count({ where: { companyId: client.id, status: { notIn: ["resolved", "closed"] } } }),
        db.asset.count({ where: { companyId: client.id } }),
        db.ticket.findMany({
          where: { companyId: client.id },
          select: { ticketNumber: true, title: true, status: true, priority: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
      ]);

      const content = [
        `Client: ${client.name} (${client.id})`,
        `State: ${client.isActive ? "active" : "inactive"}, ${client.companyType ?? "Client"}, on record since ${day(client.createdAt)}`,
        `Contact: ${client.email ?? "no email"} · ${client.phone ?? "no phone"} · ${client.website ?? "no website"}`,
        `Counts: ${tickets} tickets (${openTickets} open), ${contacts} contacts, ${assets} assets`,
        recent.length
          ? `Recent tickets:\n${recent.map(t => `  ${t.ticketNumber} | ${t.title} | ${t.status} | ${t.priority} | ${day(t.createdAt)}`).join("\n")}`
          : "No tickets on record.",
      ].join("\n");
      return ok("client_overview", args, `${client.name}: ${openTickets} open of ${tickets} tickets, ${assets} assets.`, content);
    },
  },
  {
    /*
     * The tool that makes "create a ticket for David Chen" possible.
     *
     * Everything else here looks things up by id, and a prompt names a *person* — so without this the
     * model has no way to turn a name into the contact a ticket needs, and it either gives up or
     * invents an id. A name is also the one thing that is genuinely ambiguous: two clients can each
     * have a David Chen, which is why this returns everyone who matches, with their client, and the
     * instructions say to ask rather than choose.
     */
    name: "find_people",
    description: "Find contacts (people) by name or email. Use this whenever a prompt names a person — 'create a ticket for David Chen' — because the ticket and note functions need the contact id it returns. A full name, a surname, or an email address all work. If it returns more than one person, ask which one is meant rather than guessing.",
    parameters: oneId("query", "The person's name, or part of it, or their email address — e.g. 'David Chen', 'Chen' or 'dchen@acme.com'"),
    permission: Permission.ContactView,
    kind: "read",
    async run(args, _caller, db) {
      const query = str(args.query).trim();
      if (!query) return refuse("find_people", args, "No name or email was given.");
      /*
       * Every word has to appear in the person's name or address, which is what makes a full name work:
       * a first name and a surname are two columns, so a single `contains` on each column can never
       * match "David Chen" — the search would fail for the most natural way anybody types a name.
       */
      const words = query.split(/\s+/).filter(Boolean).slice(0, 4);
      const people = await db.contact.findMany({
        where: {
          AND: words.map(word => ({
            OR: [
              { firstName: { contains: word, mode: "insensitive" } },
              { lastName: { contains: word, mode: "insensitive" } },
              { email: { contains: word, mode: "insensitive" } },
            ],
          })),
        },
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, title: true, companyId: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        take: 8,
      });
      if (!people.length) {
        return ok("find_people", args, `No contact matched "${query}".`, `No contact matches "${query}". Nobody by that name is on record — ask the person who prompted you whether a contact should be created, rather than creating a ticket against the wrong client.`);
      }
      // The client each person belongs to, so the answer can say which "David Chen" this is.
      const clients = await db.company.findMany({
        where: { id: { in: [...new Set(people.map(p => p.companyId))] } },
        select: { id: true, name: true },
      });
      const clientOf = new Map(clients.map(c => [c.id, c.name]));
      const content = people
        .map(p => `${p.id} | ${person(p)} | ${clientOf.get(p.companyId) ?? "unknown client"} (${p.companyId}) | ${p.email ?? "no email"} | ${p.title ?? "no job title"}`)
        .join("\n");
      const ambiguity = people.length > 1
        ? ` There is more than one match: ask which person is meant before proposing anything.`
        : "";
      return ok("find_people", args, `${people.length} contact${people.length === 1 ? "" : "s"} matched "${query}".`, `Contacts (id | name | client (client id) | email | job title):\n${content}${ambiguity}`);
    },
  },
  {
    name: "list_boards",
    description: "List the service boards a ticket can be created on, with how many tickets each holds. Use it when a prompt names a board, or to choose a sensible one before proposing a ticket.",
    parameters: NO_ARGS,
    permission: Permission.TicketView,
    kind: "read",
    async run(args, _caller, db) {
      const boards = await db.serviceBoard.findMany({
        where: { isActive: true },
        select: { id: true, name: true, description: true, _count: { select: { tickets: true } } },
        orderBy: { name: "asc" },
      });
      if (!boards.length) return refuse("list_boards", args, "No service board exists, so a ticket cannot be filed anywhere.");
      const content = boards.map(b => `${b.id} | ${b.name} | ${b._count.tickets} tickets | ${b.description ?? ""}`).join("\n");
      return ok("list_boards", args, `${boards.length} board${boards.length === 1 ? "" : "s"}.`, `Boards (id | name | tickets | description):\n${content}`);
    },
  },
  {
    name: "find_tickets",
    description: "Search tickets by words in the title, optionally narrowed to one client or one status. Returns the most recent matches, newest first.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for in the ticket title" },
        clientId: { type: "string", description: "Optional client id from find_clients" },
        status: { type: "string", description: "Optional status: new, open, in_progress, waiting_on_client, resolved or closed" },
        limit: { type: "number", description: "How many to return, at most 25 (default 10)" },
      },
      additionalProperties: false,
    },
    permission: Permission.TicketView,
    kind: "read",
    async run(args, _caller, db) {
      const query = str(args.query).trim();
      const clientId = str(args.clientId).trim();
      const status = str(args.status).trim();
      const limit = Math.min(Math.max(num(args.limit, 10), 1), 25);
      const tickets = await db.ticket.findMany({
        where: {
          ...(query ? { title: { contains: query, mode: "insensitive" as const } } : {}),
          ...(clientId ? { companyId: clientId } : {}),
          ...(status ? { status } : {}),
        },
        select: { id: true, ticketNumber: true, title: true, status: true, priority: true, createdAt: true, company: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      if (!tickets.length) return ok("find_tickets", args, "No tickets matched.", "No tickets match those filters.");
      const content = tickets
        .map(t => `${t.id} | ${t.ticketNumber} | ${t.title} | ${t.status} | ${t.priority} | ${t.company?.name ?? "no client"} | ${day(t.createdAt)}`)
        .join("\n");
      return ok("find_tickets", args, `${tickets.length} ticket${tickets.length === 1 ? "" : "s"} found.`, `Tickets (id | number | title | status | priority | client | opened):\n${content}`);
    },
  },
  {
    name: "ticket_detail",
    description: "One ticket in full: description, status, client, who it is assigned to, and its most recent notes. Call this before proposing anything about a ticket.",
    parameters: {
      type: "object",
      properties: {
        ticketId: { type: "string", description: "The ticket id from find_tickets" },
        ticketNumber: { type: "string", description: "Or the ticket number, e.g. C7-00000042" },
      },
      additionalProperties: false,
    },
    permission: Permission.TicketView,
    kind: "read",
    async run(args, _caller, db) {
      const ticketId = str(args.ticketId).trim();
      const ticketNumber = str(args.ticketNumber).trim();
      if (!ticketId && !ticketNumber) return refuse("ticket_detail", args, "Neither a ticket id nor a number was given.");
      const ticket = await db.ticket.findFirst({
        where: ticketId ? { id: ticketId } : { ticketNumber },
        select: {
          id: true, ticketNumber: true, title: true, description: true, status: true, priority: true,
          createdAt: true, dueDate: true, isOverdue: true,
          company: { select: { id: true, name: true } },
          assignedTo: { select: { firstName: true, lastName: true } },
          comments: {
            orderBy: { createdAt: "desc" }, take: 8,
            select: { body: true, isInternal: true, createdAt: true, author: { select: { firstName: true, lastName: true } } },
          },
        },
      });
      if (!ticket) return refuse("ticket_detail", args, "No ticket matched that id or number.");
      const comments = ticket.comments
        .map(c => `  ${day(c.createdAt)} ${c.isInternal ? "[internal]" : "[client-visible]"} ${person(c.author)}: ${clipped(c.body, 240)}`)
        .join("\n");
      const content = [
        `${ticket.ticketNumber} — ${ticket.title}`,
        `Id: ${ticket.id}`,
        `Client: ${ticket.company?.name ?? "none"} (${ticket.company?.id ?? "-"})`,
        `Status: ${ticket.status} · priority: ${ticket.priority} · opened ${day(ticket.createdAt)} · due ${ticket.dueDate ? day(ticket.dueDate) : "no due date"}${ticket.isOverdue ? " · overdue" : ""}`,
        `Assigned to: ${person(ticket.assignedTo)}`,
        `Description: ${clipped(ticket.description ?? "none", 1200)}`,
        comments ? `Recent notes, newest first:\n${comments}` : "No notes on this ticket.",
      ].join("\n");
      return ok("ticket_detail", args, `${ticket.ticketNumber} — ${ticket.title} (${ticket.status}).`, content);
    },
  },
  {
    name: "service_alerts",
    description: "The service status picture: which monitored services have an open incident, what those incidents say, and what was resolved recently.",
    parameters: NO_ARGS,
    permission: Permission.ServiceAlertView,
    kind: "read",
    async run(args, _caller, db) {
      const [services, resolved] = await Promise.all([
        db.serviceAlertService.findMany({
          where: { enabled: true },
          select: {
            name: true, category: true,
            alerts: { where: { status: "active" }, orderBy: { detectedAt: "desc" }, take: 3, select: { title: true, severity: true, detectedAt: true, sourceUrl: true } },
          },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        }),
        db.serviceAlert.findMany({
          where: { status: "resolved" },
          select: { title: true, severity: true, detectedAt: true, resolvedAt: true, service: { select: { name: true } } },
          orderBy: { resolvedAt: "desc" },
          take: 8,
        }),
      ]);
      const affected = services.filter(s => s.alerts.length > 0);
      const content = [
        `${services.length} services monitored, ${affected.length} with an open incident.`,
        affected.length
          ? `Open incidents:\n${affected.map(s => `  ${s.name} (${s.category}) — ${s.alerts.map(a => `${a.title} [${a.severity}, since ${day(a.detectedAt)}]`).join("; ")}`).join("\n")}`
          : "No monitored service has an open incident.",
        resolved.length
          ? `Recently resolved:\n${resolved.map(a => `  ${a.service?.name ?? "service"} — ${a.title} | ${a.severity} | ${day(a.detectedAt)} → ${day(a.resolvedAt)}`).join("\n")}`
          : "Nothing resolved recently.",
      ].join("\n");
      return ok("service_alerts", args, affected.length ? `${affected.length} service${affected.length === 1 ? "" : "s"} with an open incident.` : "No open service incidents.", content);
    },
  },
  {
    name: "connection_health",
    description: "Which third-party connections are configured, which are failing, and which model the application is using.",
    parameters: NO_ARGS,
    permission: Permission.IntegrationView,
    kind: "read",
    async run(args, _caller, db) {
      const [integrations, providers] = await Promise.all([
        db.integration.findMany({ select: { name: true, kind: true, status: true, enabled: true, lastSyncAt: true, errorMessage: true }, orderBy: { name: "asc" } }),
        db.aiProviderConfig.findMany({ select: { name: true, provider: true, model: true, isActive: true, isDefault: true } }),
      ]);
      const active = providers.find(p => p.isActive && p.isDefault);
      const broken = integrations.filter(i => i.status === "error");
      const content = [
        `Connections: ${integrations.length} configured, ${broken.length} in error.`,
        integrations.length
          ? integrations.map(i => `  ${i.name} (${i.kind}) | ${i.status} | ${i.enabled ? "enabled" : "disabled"} | last sync ${i.lastSyncAt ? day(i.lastSyncAt) : "never"}${i.errorMessage ? ` | ${clipped(i.errorMessage, 120)}` : ""}`).join("\n")
          : "  none configured",
        active ? `Model in use: ${active.name} (${active.provider}, ${active.model})` : "Model in use: none",
      ].join("\n");
      return ok("connection_health", args, `${integrations.length} connections configured, ${broken.length} failing.`, content);
    },
  },
  {
    name: "search_knowledge_base",
    description: "Search the published knowledge base for articles about a subject. Use this for 'how do we…' questions and for anything the team has solved before.",
    parameters: oneId("query", "Words to look for in the article titles, text and tags"),
    permission: Permission.KBView,
    kind: "read",
    async run(args, _caller, db) {
      const query = str(args.query).trim();
      if (!query) return refuse("search_knowledge_base", args, "No search term was given.");
      const articles = await db.knowledgeBaseArticle.findMany({
        where: {
          status: "published",
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { content: { contains: query, mode: "insensitive" } },
            { tags: { has: query } },
          ],
        },
        select: { title: true, excerpt: true, content: true, tags: true, viewCount: true },
        orderBy: { viewCount: "desc" },
        take: 5,
      });
      if (!articles.length) return ok("search_knowledge_base", args, `Nothing published about "${query}".`, `No published article mentions "${query}".`);
      const content = articles
        .map(a => `# ${a.title}${a.tags.length ? ` [${a.tags.join(", ")}]` : ""}\n${clipped(a.excerpt || a.content, 700)}`)
        .join("\n\n");
      return ok("search_knowledge_base", args, `${articles.length} article${articles.length === 1 ? "" : "s"} about "${query}".`, content);
    },
  },
  {
    name: "list_assets",
    description: "Assets on record, optionally for one client — what somebody has, what state it is in, and its serial number.",
    parameters: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "Optional client id from find_clients" },
        limit: { type: "number", description: "How many to return, at most 50 (default 20)" },
      },
      additionalProperties: false,
    },
    permission: Permission.AssetView,
    kind: "read",
    async run(args, _caller, db) {
      const clientId = str(args.clientId).trim();
      const limit = Math.min(Math.max(num(args.limit, 20), 1), 50);
      const assets = await db.asset.findMany({
        where: clientId ? { companyId: clientId } : {},
        select: { name: true, assetTag: true, type: true, status: true, serialNumber: true, companyId: true },
        orderBy: { name: "asc" },
        take: limit,
      });
      if (!assets.length) return ok("list_assets", args, "No assets matched.", "No assets are on record for that filter.");
      const content = assets
        .map(a => `${a.name} | ${a.type} | ${a.status} | tag ${a.assetTag}${a.serialNumber ? ` | serial ${a.serialNumber}` : ""}`)
        .join("\n");
      return ok("list_assets", args, `${assets.length} asset${assets.length === 1 ? "" : "s"}${clientId ? " for that client" : ""}.`, `Assets (name | type | status | asset tag | serial):\n${content}`);
    },
  },

  // ── Proposals: these raise a decision, they never write ─────────────────────────────────
  {
    name: "propose_ticket_note",
    description: "Propose a note on a ticket. This does not add the note — it raises a proposal that a person reviews first. Say in your answer that you have proposed it and that somebody has to approve it.",
    parameters: {
      type: "object",
      properties: {
        ticketId: { type: "string", description: "The ticket id from find_tickets or ticket_detail" },
        note: { type: "string", description: "The note text, written as it should appear on the ticket" },
        internal: { type: "boolean", description: "True for an internal note the client will not see (the default), false for one the client sees" },
      },
      required: ["ticketId", "note"],
      additionalProperties: false,
    },
    permission: Permission.TicketEdit,
    kind: "propose",
    async run(args, caller, db) {
      const ticketId = str(args.ticketId).trim();
      const note = str(args.note).trim();
      if (!ticketId || !note) return refuse("propose_ticket_note", args, "A ticket and the note text are both needed.");
      const ticket = await db.ticket.findUnique({ where: { id: ticketId }, select: { ticketNumber: true, title: true } });
      if (!ticket) return refuse("propose_ticket_note", args, `No ticket exists with id ${ticketId}.`);
      // The default is internal: a note the client can see is a message to the customer, and the
      // model should have to mean it.
      const internal = args.internal === false ? false : true;
      const action = await db.aiAction.create({
        data: {
          entityType: "ticket",
          entityId: ticketId,
          title: `Add ${internal ? "an internal" : "a client-visible"} note to ${ticket.ticketNumber}`,
          summary: clipped(note, 400),
          riskTier: internal ? "low" : "medium",
          payload: { kind: "ticket_note", ticketId, note, internal },
          status: "pending",
          requestedById: caller.userId,
          audit: { create: { event: "proposed", userId: caller.userId, detail: "Raised by the assistant from a prompt" } },
        },
      });
      return ok(
        "propose_ticket_note",
        args,
        `Proposed a ${internal ? "internal" : "client-visible"} note on ${ticket.ticketNumber} — awaiting approval.`,
        `Proposal ${action.id} was raised and is awaiting a person's approval. Nothing has been added to the ticket.`,
      );
    },
  },
  {
    name: "propose_ticket",
    description: "Propose a new ticket. Give the client when it is known, and the contact when the prompt named a person. This does not create the ticket — it raises a proposal that a person reviews and approves, and approving it is what creates the ticket. Always say in your answer that it is a proposal.",
    parameters: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "The client id from find_clients, or from find_people if the prompt only named a person" },
        contactId: { type: "string", description: "The contact id from find_people, when the prompt named a person — the ticket is then attached to them" },
        boardId: { type: "string", description: "The board id from list_boards. Optional: left out, the ticket is filed on the default board" },
        title: { type: "string", description: "The ticket title" },
        description: { type: "string", description: "What the problem is, with as much detail as is known" },
        priority: { type: "string", description: "low, medium, high or urgent (default medium)" },
      },
      required: ["title"],
      additionalProperties: false,
    },
    permission: Permission.TicketCreate,
    kind: "propose",
    async run(args, caller, db) {
      const clientId = str(args.clientId).trim();
      const contactId = str(args.contactId).trim();
      const title = str(args.title).trim();
      if (!title) return refuse("propose_ticket", args, "A title is needed.");

      /*
       * The client is required by the ticket, and a prompt often names only a person — so it comes
       * from the contact when it was not given. That is the difference between "create a ticket for
       * David Chen" working and the model having to ask a second question.
       */
      let clientId_ = clientId;
      let contactName: string | null = null;
      if (contactId) {
        const contact = await db.contact.findUnique({
          where: { id: contactId },
          select: { firstName: true, lastName: true, companyId: true },
        });
        if (!contact) return refuse("propose_ticket", args, `No contact exists with id ${contactId}.`);
        contactName = person(contact);
        if (!clientId_) clientId_ = contact.companyId;
      }
      if (!clientId_) return refuse("propose_ticket", args, "A client is needed — call find_clients, or find_people if the prompt named a person.");

      const client = await db.company.findUnique({ where: { id: clientId_ }, select: { name: true } });
      if (!client) return refuse("propose_ticket", args, `No client exists with id ${clientId_}.`);

      // A board named by name is resolved here rather than handed on, so a proposal cannot create a
      // ticket on a board that does not exist.
      let boardId = str(args.boardId).trim();
      let boardName: string | null = null;
      if (boardId) {
        const board = await db.serviceBoard.findUnique({ where: { id: boardId }, select: { name: true, isActive: true } });
        if (!board || !board.isActive) return refuse("propose_ticket", args, `There is no active board with id ${boardId} — call list_boards.`);
        boardName = board.name;
      }

      const priority = ["low", "medium", "high", "urgent"].includes(str(args.priority)) ? str(args.priority) : "medium";
      const action = await db.aiAction.create({
        data: {
          entityType: "ticket",
          entityId: null,
          title: `Create ticket for ${client.name}${contactName ? ` (${contactName})` : ""}: ${clipped(title, 120)}`,
          summary: clipped(str(args.description) || "No description given.", 400),
          // A new ticket is not a note: it lands in somebody's queue and starts a conversation with a
          // client, so it is proposed at a tier that needs a decision.
          riskTier: "medium",
          payload: {
            kind: "create_ticket",
            companyId: clientId_,
            contactId: contactId || undefined,
            boardId: boardId || undefined,
            title,
            description: str(args.description),
            priority,
          },
          status: "pending",
          requestedById: caller.userId,
          audit: { create: { event: "proposed", userId: caller.userId, detail: "Raised by the assistant from a prompt" } },
        },
      });
      const where = [`${client.name}`, contactName ? `for ${contactName}` : null, boardName ? `on ${boardName}` : null].filter(Boolean).join(" ");
      return ok(
        "propose_ticket",
        args,
        `Proposed a ticket for ${where} — awaiting approval.`,
        `Proposal ${action.id} was raised and is awaiting a person's approval. Approving it creates the ticket; nothing exists yet.`,
      );
    },
  },
];

/** Every function, for the screens and probes that need the list. */
export const ASSISTANT_TOOLS: AssistantTool[] = TOOLS;

export function toolByName(name: string): AssistantTool | undefined {
  return TOOLS.find(tool => tool.name === name);
}

/**
 * The functions this caller may be offered.
 *
 * One filter, used both to build the model's tool list and to check a call the model makes anyway —
 * models do ask for functions they were not given, and a prompt can suggest one. Filtering the list
 * is a courtesy to the model; the check at call time is the control.
 */
export function toolsFor(caller: AssistantCaller, opts: { allowProposals?: boolean } = {}): AssistantTool[] {
  return TOOLS.filter(tool => caller.permissions.includes(tool.permission) && (tool.kind === "read" || opts.allowProposals !== false));
}

export function canRun(tool: AssistantTool, caller: AssistantCaller): boolean {
  return caller.permissions.includes(tool.permission);
}

/** The catalogue of functions and the permission each needs, for the Help screen and probes. */
export function toolCatalogue(): Array<{ name: string; permission: string; kind: string; description: string }> {
  return TOOLS.map(t => ({ name: t.name, permission: t.permission, kind: t.kind, description: t.description }));
}
