/**
 * Board tile arrangement (PLAN-015 Phase B #5).
 *
 * A board card's tiles were hardcoded in two rows, so a desk could not lead with the tile that
 * matters to it. The arrangement is stored per board and shared — these assertions cover the
 * reconciliation (unknown ids dropped, duplicates collapsed, a tile added later appearing), the
 * pin rule (a pinned tile leads the card), the permission split (board:view reads, board:manage
 * writes), and that the metrics endpoint every board card already calls carries the arrangement.
 *
 * Run from apps/api:  node probe-board-layout.mjs
 */
const BASE = "http://127.0.0.1:4000";
const PW = "Persona-Dev-Only-2026!";

let pass = 0;
let fail = 0;
const check = (ok, label) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

async function signIn(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, token: data.token };
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const ADMIN = "persona.admin@c7ntax.local";
const TECH = "persona.tech@c7ntax.local";
const READONLY = "persona.readonly@c7ntax.local";

async function main() {
  const admin = await signIn(ADMIN);
  const tech = await signIn(TECH);
  const readonly = await signIn(READONLY);
  check(admin.status === 200 && tech.status === 200 && readonly.status === 200,
    `admin (${admin.status}), technician (${tech.status}) and read-only (${readonly.status}) signed in`);

  const boards = await prisma.serviceBoard.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  check(boards.length > 0, `there is a board to arrange (${boards.length})`);
  const boardId = boards[0].id;
  await prisma.boardLayout.deleteMany({ where: { boardId } });

  console.log("\na board with no saved arrangement leads with the catalogue order");
  const fresh = await call("GET", `/api/boards/${boardId}/layout`, { token: admin.token });
  check(fresh.status === 200, `the arrangement answers (${fresh.status})`);
  const tiles = fresh.data.tiles || [];
  check(tiles.length === 6, `all six tiles are present (${tiles.length})`);
  check(JSON.stringify(tiles.map(t => t.id)) === JSON.stringify(["new", "workable", "on_hold", "waiting", "escalated", "avg_age"]),
    `in catalogue order (${tiles.map(t => t.id).join(", ")})`);
  check(tiles.every(t => t.pinned === false) && fresh.data.personalised === false, "nothing pinned, and reported as not yet arranged");

  console.log("\nan arrangement is stored and returned as it was made");
  const arranged = [
    { id: "escalated", pinned: true },
    { id: "waiting", pinned: false },
    { id: "avg_age", pinned: false },
    { id: "on_hold", pinned: false },
    { id: "new", pinned: false },
    { id: "workable", pinned: false },
  ];
  const saved = await call("PUT", `/api/boards/${boardId}/layout`, { token: admin.token, body: { tiles: arranged } });
  check(saved.status === 200, `the arrangement saved (${saved.status})`);
  check(JSON.stringify(saved.data.tiles) === JSON.stringify(arranged), "and comes back exactly as arranged, pin included");
  const reread = await call("GET", `/api/boards/${boardId}/layout`, { token: admin.token });
  check(JSON.stringify(reread.data.tiles) === JSON.stringify(arranged), "a fresh read returns the same arrangement");
  check(reread.data.personalised === true, "and reports itself as arranged");

  console.log("\na pin leads the card, whatever order was dragged");
  const pinnedMiddle = await call("PUT", `/api/boards/${boardId}/layout`, {
    token: admin.token,
    body: { tiles: [{ id: "new", pinned: false }, { id: "workable", pinned: false }, { id: "on_hold", pinned: true }, { id: "waiting", pinned: false }, { id: "escalated", pinned: false }, { id: "avg_age", pinned: false }] },
  });
  check((pinnedMiddle.data.tiles[0] || {}).id === "on_hold", `the pinned tile is first (${(pinnedMiddle.data.tiles[0] || {}).id})`);
  check(JSON.stringify(pinnedMiddle.data.tiles.slice(1, 3).map(t => t.id)) === JSON.stringify(["new", "workable"]),
    "and the rest keep the order they were dragged into");
  const twoPins = await call("PUT", `/api/boards/${boardId}/layout`, {
    token: admin.token,
    body: { tiles: [{ id: "avg_age", pinned: true }, { id: "escalated", pinned: true }, { id: "new", pinned: false }] },
  });
  check(JSON.stringify(twoPins.data.tiles.slice(0, 2).map(t => t.id)) === JSON.stringify(["avg_age", "escalated"]),
    `two pins keep their relative order (${twoPins.data.tiles.slice(0, 2).map(t => t.id).join(", ")})`);

  console.log("\nthe saved list is input, and is treated like it");
  const junk = await call("PUT", `/api/boards/${boardId}/layout`, {
    token: admin.token,
    body: { tiles: [{ id: "profit_margin", pinned: true }, { id: "new", pinned: false }, { id: "new", pinned: true }, { id: 42 }] },
  });
  const junkIds = junk.data.tiles.map(t => t.id);
  check(junk.status === 200, `an unrecognised arrangement is reconciled rather than rejected (${junk.status})`);
  check(!junkIds.includes("profit_margin"), "an unknown tile id is dropped");
  check(junkIds.filter(id => id === "new").length === 1, "a duplicate is collapsed to one");
  check(junkIds.length === 6, `and the tiles nobody placed are still appended (${junkIds.length})`);
  const notAnArray = await call("PUT", `/api/boards/${boardId}/layout`, { token: admin.token, body: { tiles: "pinned please" } });
  check(notAnArray.status === 400, `a non-array is refused (${notAnArray.status})`);
  const tooMany = await call("PUT", `/api/boards/${boardId}/layout`, { token: admin.token, body: { tiles: Array.from({ length: 40 }, () => ({ id: "new" })) } });
  check(tooMany.status === 400, `an absurd list length is refused (${tooMany.status})`);
  const unknownBoard = await call("PUT", "/api/boards/00000000-0000-0000-0000-000000000000/layout", { token: admin.token, body: { tiles: [] } });
  check(unknownBoard.status === 404, `an unknown board is refused (${unknownBoard.status})`);

  console.log("\nreading is board:view, changing is board:manage");
  const readonlyRead = await call("GET", `/api/boards/${boardId}/layout`, { token: readonly.token });
  check(readonlyRead.status === 200, `a read-only account can see the arrangement (${readonlyRead.status})`);
  const readonlyWrite = await call("PUT", `/api/boards/${boardId}/layout`, { token: readonly.token, body: { tiles: arranged } });
  check(readonlyWrite.status === 403, `but cannot change it (${readonlyWrite.status})`);
  const readonlyReset = await call("DELETE", `/api/boards/${boardId}/layout`, { token: readonly.token });
  check(readonlyReset.status === 403, `nor reset it (${readonlyReset.status})`);
  const anon = await call("GET", `/api/boards/${boardId}/layout`);
  check(anon.status === 401, `an unauthenticated read is refused (${anon.status})`);
  const techWrite = await call("PUT", `/api/boards/${boardId}/layout`, { token: tech.token, body: { tiles: arranged } });
  check([200, 403].includes(techWrite.status), `a technician is answered by permission, not by accident (${techWrite.status})`);

  console.log("\nthe metrics the board cards already call carry the arrangement");
  await call("PUT", `/api/boards/${boardId}/layout`, { token: admin.token, body: { tiles: arranged } });
  const metrics = await call("GET", "/api/boards/metrics", { token: admin.token });
  check(metrics.status === 200 && Array.isArray(metrics.data), `the metrics endpoint answers (${metrics.status})`);
  const card = (metrics.data || []).find(b => b.boardId === boardId) || {};
  check(JSON.stringify(card.tiles) === JSON.stringify(arranged), `the card carries the saved arrangement (${(card.tiles || []).map(t => t.id).join(", ")})`);
  check(card.layoutPersonalised === true, "and says it is arranged");
  const otherBoard = (metrics.data || []).find(b => b.boardId !== boardId) || {};
  check(Array.isArray(otherBoard.tiles) && otherBoard.tiles.length === 6, "every other board still carries a full default arrangement");
  check((otherBoard.tiles || [])[0].id === "new", "in catalogue order, unaffected by this board's arrangement");

  console.log("\nreset puts it back");
  const reset = await call("DELETE", `/api/boards/${boardId}/layout`, { token: admin.token });
  check(reset.status === 200 && reset.data.personalised === false, `reset clears the arrangement (${reset.status})`);
  check((reset.data.tiles || [])[0].id === "new" && (reset.data.tiles || []).length === 6, "and returns the catalogue order");

  await prisma.boardLayout.deleteMany({ where: { boardId } });
  const personaIds = (await prisma.user.findMany({ where: { email: { in: [ADMIN, TECH, READONLY] } }, select: { id: true } })).map(u => u.id);
  await prisma.userSession.deleteMany({ where: { userId: { in: personaIds } } });
  const leftovers = await prisma.boardLayout.count({ where: { boardId } });
  check(leftovers === 0, `the probe cleaned up after itself (${leftovers} arrangements left)`);
  await prisma.$disconnect();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
