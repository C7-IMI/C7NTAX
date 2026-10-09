-- Whether closing a ticket on a board emails the client.
--
-- On by default, which is what every board did before this column existed, so nothing changes for a
-- board that does not care. It exists for the boards where the client contact is not a person: a NOC
-- board's tickets arrive from monitoring systems and their addresses are no-reply, so the closure
-- email goes nowhere and the only effect is noise that looks like a notification.
--
-- The close dialog starts from this value, and an operator can still tick the box on any single close
-- to send anyway - this is a default, not a lock. `PATCH /api/tickets/:id` and the batch close read it
-- the same way: an explicit `notifyCustomer` wins, and an absent one means "ask the board".
--
-- NOC Alerts is the board this was asked for, and it is set here rather than left to a person because a
-- migration is the only thing that reaches an installation nobody is sitting in front of. It is matched
-- by name: a deployment that has renamed that board keeps the default (on), which is the safe direction
-- - an unwanted email is recoverable, a client who never hears their ticket closed is not.

ALTER TABLE "ServiceBoard" ADD COLUMN "notifyCustomerOnClose" BOOLEAN NOT NULL DEFAULT true;

UPDATE "ServiceBoard" SET "notifyCustomerOnClose" = false WHERE "name" = 'NOC Alerts';
