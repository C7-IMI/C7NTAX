# Admin bulk ticket email — reference

Why `POST /api/bulk` can change a ticket's status without emailing the customer, and what it would take to wire it.

**Status:** Not wired (deliberate scope call). See the customer-notification change in BuildNotes `2026.10.5.007`.

---

## Summary

Customer notifications are wired into the ticket workflows and the background auto-close job. There is **one remaining place** the app can change a ticket status and stay silent: the generic admin bulk runner at `POST /api/bulk` with `type: "ticket_update"`.

## Two different bulk endpoints

Don't confuse these — they are unrelated systems with similar names.

| | `POST /api/tickets/batch` | `POST /api/bulk` |
|---|---|---|
| Where | Ticket-list "bulk bar" in the UI | Generic admin bulk-operation runner |
| Code | [apps/api/src/routes/tickets/index.ts](apps/api/src/routes/tickets/index.ts) | [apps/api/src/routes/bulk.ts](apps/api/src/routes/bulk.ts) |
| Called by | Web app (select rows → Acknowledge/Close/Set Status) | Nothing in `apps/**` |
| Shape | `{ ticketIds, status, priority }` | `{ type, entity, config, ids }` |
| Execution | Synchronous | Async job — returns `202`, processes in background |
| Sends customer email | ✅ Yes | ❌ No |

## Why `POST /api/bulk` can change status silently

The `ticket_update` case passes the free-form `config` straight into Prisma with no validation:

```ts
// apps/api/src/routes/bulk.ts
case "ticket_update":
  await prisma.ticket.update({ where: { id: itemId }, data: config as Record<string, unknown> });
  break;
```

`config` is typed `Record<string, unknown>`, so `config: { status: "closed" }` changes the status but never calls `notifyTicketStatusChange`, so no email is sent.

Example request:

```jsonc
POST /api/bulk
{ "type": "ticket_update", "entity": "ticket", "config": { "status": "closed" }, "ids": ["<ticket-id>", "..."] }
```

## Why it was left out

- **Nothing calls it.** No web or desktop code references `/api/bulk` or `ticket_update`. Its only references are the API route itself and [apps/api/src/sample-data-toggle.ts](apps/api/src/sample-data-toggle.ts), which merely names the `bulkOperation` table when toggling sample data. It is an unexposed backend/admin primitive.
- **Deliberately generic and unvalidated.** `entity` is ignored (the switch keys off `type`) and `config` is arbitrary JSON, so adding an email side effect means any future caller could trigger unexpected customer mail.
- **Asynchronous / fire-and-forget.** The request returns before processing, so notifications would fire later with no user-visible connection — a different delivery contract than the synchronous ticket endpoints.

It was a scoping judgment, not a technical blocker: wire the paths real users and the system actually drive, and don't add implicit email to an unused, unvalidated generic writer.

## What wiring it would take

Small — the notification helper already exists in [apps/api/src/services/ticketNotifications.ts](apps/api/src/services/ticketNotifications.ts). Inside `processBulk` in [apps/api/src/routes/bulk.ts](apps/api/src/routes/bulk.ts):

1. Check `typeof config.status === "string"`.
2. Fetch the ticket's current status before the update.
3. After a successful update where the status changed, call `notifyTicketStatusChange(itemId, oldStatus, newStatus)`.
4. Keep notification best-effort — a mail failure must not increment `failureCount`.

## Decision to make first

Should an admin bulk job email customers at all, or should that be left to the ticket workflows? If yes, implement the four steps above.
