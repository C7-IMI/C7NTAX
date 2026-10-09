/**
 * Bring existing ticket numbers into the current scheme: `{board}-{client}-{sequence}`.
 *
 * New tickets have been written this way since the numbering change; the ones already in the database
 * were written under the previous scheme, which put the client's full four-digit id in the middle
 * (`MSP-1001-1008`) or dropped the client entirely (`INF-2006`). This rewrites them so a list shows one
 * convention instead of two.
 *
 * **It is a dry run unless you pass `--apply`.** Renumbering is not a cosmetic operation: a ticket number
 * is the threading key in every email already sent and the reference a client quotes back, so the change
 * should be looked at before it is made, and the mapping it prints is the record of what moved.
 *
 * What it does, per ticket:
 *
 * 1. Works out the target — the board's `ticketCode` (falling back to the client's type), the client's
 *    short octet, and the ticket's own sequence, which is kept rather than regenerated so a ticket people
 *    already know as `…-1008` stays `…-1008`.
 * 2. Leaves alone anything it cannot place: an `id` with no client (`C7-…`), a number whose last segment
 *    is not a number, or a ticket whose client has no `clientId`.
 * 3. Resolves collisions rather than failing on the unique constraint. Two old numbers can collapse onto
 *    one target (`INF-2007` and `INF-1002-2007` both becoming `INF-02-2007` for the same client), so the
 *    earliest ticket keeps the number it asked for and the others are given the next free sequence on
 *    that prefix — reported in the output, because a number that moved for this reason is a number whose
 *    history will not match what was printed last month.
 *
 * Usage:
 *   npx tsx src/renumber-tickets.ts            # dry run: print what would change
 *   npx tsx src/renumber-tickets.ts --apply    # do it, and write out/ticket-renumber-map.json
 */
import { PrismaClient } from "@prisma/client";
import { clientOctet } from "./services/ticketNumberFormat";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

interface Plan {
  id: string;
  from: string;
  to: string;
  client: string;
  board: string;
  reason?: string;
}

async function main() {
  const tickets = await prisma.ticket.findMany({
    select: {
      id: true,
      ticketNumber: true,
      createdAt: true,
      company: { select: { name: true, clientId: true, clientType: true } },
      board: { select: { name: true, ticketCode: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const skipped: Array<{ no: string; why: string }> = [];
  const plans: Plan[] = [];
  // Numbers that will not move, so a target can be checked against them too.
  const untouched = new Set<string>();
  // Targets claimed as we go, so a collision inside the plan is caught before it reaches the database.
  const taken = new Map<string, Plan>();

  for (const ticket of tickets) {
    const number = ticket.ticketNumber ?? "";
    const clientId = ticket.company?.clientId ?? null;
    const segments = number.split("-");
    const sequence = segments[segments.length - 1] ?? "";
    const prefix = (ticket.board?.ticketCode?.trim() || ticket.company?.clientType || "").toUpperCase();

    if (!clientId) { skipped.push({ no: number, why: "no client to key the series on" }); untouched.add(number); continue; }
    if (!prefix) { skipped.push({ no: number, why: "no board code and no client type" }); untouched.add(number); continue; }
    if (!/^\d+$/.test(sequence)) { skipped.push({ no: number, why: "the sequence is not a number" }); untouched.add(number); continue; }
    // The random reference a ticket gets when nobody knows the client — an id, not a series.
    if (/^C7-[A-Z0-9]+-[A-Z0-9]+$/.test(number)) { skipped.push({ no: number, why: "a C7 reference, not a series number" }); untouched.add(number); continue; }

    const octet = clientOctet(clientId);
    const target = `${prefix}-${octet}-${sequence}`;
    if (target === number) { untouched.add(number); continue; }

    if (untouched.has(target)) {
      skipped.push({ no: number, why: `${target} is already taken by a ticket that is not moving` });
      untouched.add(number);
      continue;
    }

    const plan: Plan = {
      id: ticket.id,
      from: number,
      to: target,
      client: ticket.company?.name ?? "—",
      board: ticket.board?.name ?? "—",
    };
    const clash = taken.get(target);
    if (clash) {
      // Two old numbers collapsing onto one: the earlier ticket keeps it, this one moves along.
      let bump = Number(sequence) + 1;
      while (taken.has(`${prefix}-${octet}-${bump}`) || untouched.has(`${prefix}-${octet}-${bump}`)) bump += 1;
      plan.to = `${prefix}-${octet}-${bump}`;
      plan.reason = `collision with ${clash.from}`;
    }
    taken.set(plan.to, plan);
    plans.push(plan);
  }

  console.log(`tickets: ${tickets.length} · to renumber: ${plans.length} · untouched: ${tickets.length - plans.length}`);
  const collisions = plans.filter((p) => p.reason);
  if (collisions.length) {
    console.log(`\n${collisions.length} number(s) moved because two old numbers collapsed onto one:`);
    for (const plan of collisions) console.log(`  ${plan.from} -> ${plan.to}  (${plan.client} · ${plan.board}) — ${plan.reason}`);
  }

  const changed = plans.filter((p) => !p.reason);
  if (changed.length) {
    console.log(`\n${changed.length} straightforward rename(s); first 25:`);
    for (const plan of changed.slice(0, 25)) console.log(`  ${plan.from} -> ${plan.to}  (${plan.client} · ${plan.board})`);
    if (changed.length > 25) console.log(`  … and ${changed.length - 25} more`);
  }

  if (skipped.length) {
    const byReason = new Map<string, number>();
    for (const row of skipped) byReason.set(row.why, (byReason.get(row.why) ?? 0) + 1);
    console.log(`\nleft alone (${skipped.length}):`);
    for (const [why, count] of byReason) console.log(`  ${count} × ${why}`);
  }

  if (!apply) {
    console.log("\nDry run — nothing was written. Re-run with --apply to make these changes.");
    return plans;
  }

  // Applied in one transaction: a half-renumbered table would have two tickets claiming one number,
  // which the unique constraint would reject on the second write anyway — better to fail whole.
  await prisma.$transaction(
    plans.map((plan) => prisma.ticket.update({ where: { id: plan.id }, data: { ticketNumber: plan.to } })),
  );
  const outDir = path.resolve(__dirname, "../../../out");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `ticket-renumber-map-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ appliedAt: new Date().toISOString(), renumbered: plans, leftAlone: skipped }, null, 2), "utf8");
  console.log(`\nApplied ${plans.length} renumbering(s). Map written to ${file}`);
  return plans;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
