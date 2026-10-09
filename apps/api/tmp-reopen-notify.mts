// Temporary verification of the reopen notification: drive the real reply path and watch what it does.
process.env.PORT = process.env.PORT || "4000";
process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});
const { prisma } = await import("./src/index");
const { appendEmailToTicket } = await import("./src/services/emailToTicket");

const TESTING_SINCE = new Date(Date.now() - 20 * 60 * 1000);

const ticket = await prisma.ticket.findFirst({
  where: { ticketNumber: "INF-1004-1005" },
  include: { contact: { select: { email: true } }, assignedTo: { select: { email: true, firstName: true } }, createdBy: { select: { email: true } } },
});
if (!ticket) throw new Error("ticket not found");

// Close it first, the way the dialog does.
await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "closed", closedAt: new Date() } });
console.log("closed:", ticket.ticketNumber, "| assignee:", ticket.assignedTo?.email ?? "(none)", "| creator:", ticket.createdBy?.email);
console.log("=> the notification should go to:", (ticket.assignedTo?.email || ticket.createdBy?.email));

const reply = {
  messageId: `<test-reopen-${Date.now()}@c7ntax.test>`,
  from: { email: ticket.contact?.email, name: "Client Contact" },
  to: ["support@c7ntax.test"],
  subject: `[${ticket.ticketNumber}] Re: Addin probe`,
  bodyText: "The problem is back — the VPN still drops after the switch replacement.",
  bodyHtml: "",
  date: new Date(),
  attachments: [],
};
await appendEmailToTicket(ticket.id, reply);

const after = await prisma.ticket.findUnique({ where: { id: ticket.id }, select: { status: true, closedAt: true } });
const notes = await prisma.ticketComment.findMany({ where: { ticketId: ticket.id, isInternal: true, createdAt: { gte: TESTING_SINCE } }, select: { body: true } });
console.log("after the reply:", JSON.stringify(after));
console.log("internal notes:", notes.map(n => n.body.slice(0, 90)).join(" | ") || "(none)");

// put the demo data back
await prisma.ticketComment.deleteMany({ where: { ticketId: ticket.id, createdAt: { gte: TESTING_SINCE } } });
await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "new", closedAt: null, resolvedAt: null } });
console.log("restored:", JSON.stringify(await prisma.ticket.findUnique({ where: { id: ticket.id }, select: { status: true } })));
await prisma.$disconnect();
process.exit(0);
