/**
 * The record's **id**, resolved at run time from the record's number.
 *
 * The Studio's chooser names records the way a person does — `MSP-02-2013`, `INV-2026-002` — because
 * those are the numbers that appear in the ticket list, on the invoice and in a client's email. But
 * `POST /api/email/preview` resolves its fields by **id**, and a ticket's id is a UUID: sending the number
 * comes back as a 404, and a preview that 404s while the chooser says a record is selected is the one
 * thing this screen must not do.
 *
 * So the ids are read rather than written down. A hard-coded UUID would work on this instance and be wrong
 * on the next one — every seed generates its own — and the failure would look like "the preview is
 * broken" rather than "this record is not here".
 *
 * Where a read fails the number is passed through unchanged: the preview then says which record it could
 * not read, which is the honest answer, rather than showing a different record's figures.
 */
import { useEffect, useState } from "react";
import api from "../../api";

export interface ResolvedRecordIds {
  /** Human number → id, for the records this account may read. */
  ids: Record<string, string>;
  /** What could not be read, when a list did not answer. */
  failure: string | null;
}

export function useEmailRecordIds(): ResolvedRecordIds {
  const [state, setState] = useState<ResolvedRecordIds>({ ids: {}, failure: null });

  useEffect(() => {
    let cancelled = false;
    const ids: Record<string, string> = {};
    const unread: string[] = [];

    const load = async () => {
      const results = await Promise.allSettled([
        api.get("/tickets", { params: { take: 300 } }),
        api.get("/billing/invoices"),
      ]);
      const [tickets, invoices] = results;
      if (tickets.status === "fulfilled") {
        const rows = unwrap(tickets.value.data);
        for (const row of rows) {
          const number = row.ticketNumber;
          const id = row.id;
          if (typeof number === "string" && typeof id === "string") ids[number] = id;
        }
      } else {
        unread.push("the ticket list");
      }
      if (invoices.status === "fulfilled") {
        const rows = unwrap(invoices.value.data);
        for (const row of rows) {
          const number = row.invoiceNumber;
          const id = row.id;
          if (typeof number === "string" && typeof id === "string") ids[number] = id;
        }
      } else {
        unread.push("the invoice list");
      }
      if (!cancelled) {
        setState({
          ids,
          failure: unread.length
            ? `${unread.join(" and ")} could not be read, so a record chosen for the preview is resolved by its number rather than by its id.`
            : null,
        });
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

function unwrap(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.data)) return record.data as Record<string, unknown>[];
  }
  return [];
}
