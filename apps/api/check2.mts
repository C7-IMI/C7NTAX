import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const t = "e28544bc-cb82-4d42-8020-a49b4a2a3a80";
console.log("attachments:", await p.ticketAttachment.count({ where: { ticketId: t } }));
console.log("email comments:", await p.ticketComment.count({ where: { ticketId: t, isEmail: true } }));
const notes = await p.ticketComment.findMany({ where: { ticketId: t }, orderBy: { createdAt: "asc" }, select: { body: true, isInternal: true, isEmail: true } });
console.log("remaining:", notes.map(n => (n.isEmail ? "Email" : n.isInternal ? "Internal" : "Note")).join(", "));
console.log("audit rows mentioning dropped-notes:", await p.auditLog.count({ where: { action: { contains: "dropped-notes" } } }));
await p.$disconnect();
