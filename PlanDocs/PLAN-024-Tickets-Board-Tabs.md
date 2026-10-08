# PLAN-024 — Boards as Tabs on the Tickets Screen

> **Sequence:** taken now, at the user's request, and built to be undone in one line.
> **Decided:** yes — implemented behind the `BOARD_TABS` switch in `apps/web/src/pages/Tickets.tsx`.
> **Mockup:** the running screen itself (`/tickets`) — this is a live implementation rather than a
> standalone page, because the change is small enough to measure in place. Flip `BOARD_TABS` to
> `false` to see the previous screen again.
> **Cost when taken:** one new component (`apps/web/src/components/TicketBoardTabs.tsx`), one switch
> plus a three-line branch in `Tickets.tsx`, and two classes on the shared `Tabs` component. No API
> work, no schema change, no migration — the board list already carried the counts.
> **Cost to revert:** set `BOARD_TABS = false`. The dropdown markup is still there in the other
> branch, the board chip returns to the active-filters row, and the URL parameter was never touched,
> so links and bookmarks behave identically either way. Deleting the experiment afterwards means
> deleting the component, the constant and the branch.

---

## 1. The complaint

Selecting a board was a `<select>` in the toolbar, sitting next to **Create**:

```
[ All Boards ▾ ]  [ + Create ]                    [ Quick Actions ] [ Filter ] [ Choose Columns ]
```

A dropdown says nothing until it is opened. You cannot see how many boards exist, which one you are
in without reading a small grey word, or what else is available — and "Filtered by board" in the page
subtitle was the only other clue about where you were. On a screen whose whole job is "the tickets for
a board", the board is the primary navigation, and it was the least visible control on the page.

## 2. What was built

The board becomes a **tab strip** with a **notation band** directly under it, placed below the toolbar
and the search box so the list's own controls read in the order they are used — search, then narrow,
then choose the board:

```
Tickets
Manage service tickets

[ + Create ]                                      [ Quick Actions ] [ Filter ] [ Choose Columns ]
🔍 Search tickets by number or subject...

[ All Boards 113 ] [ Infrastructure Desk 33 ] [ Intelligence Desk 23 ] [ MSP Service Desk 34 ] [ NOC Alerts 23 ]
▌ Viewing   MSP Service Desk   MSP   General IT support                     34 tickets on this board
```

- **The strip is the shared `Tabs` component** — the same one the customer portal settings screen and
  the configuration screens use, so it is the tab style the product already has: a bordered group, the
  chosen tab on the primary fill, counts as pills, arrow-key navigation, and a proper `tablist` role.
  It scrolls horizontally rather than squashing when a workspace has more boards than fit.
- **Counts come from `_count.tickets`** on `GET /boards`, which the endpoint already returned. Every
  ticket has a board (`Ticket.boardId` is required), so "All Boards" is the exact sum — 33 + 23 + 34 +
  23 = 113 — and not an estimate.
- **The band names what is on screen**: "Viewing", the board name in white, its ticket code in mono,
  its description, and how many tickets are on it. With "All Boards" chosen it says "113 tickets
  across 4 boards" instead.
- **The board is still the URL parameter** (`?boardId=…`), unchanged. Tabs are a different control for
  the same state, so a deep link selects the right tab, a reload keeps you there, and every existing
  link into a board continues to work. The tab strip derives its selection from the URL rather than
  holding its own state.
- **Two things stopped being said twice**: the subtitle no longer reads "Filtered by board" (the band
  says it properly), and the board no longer appears as a chip in the active-filters row, which is now
  only about filters.

## 3. Measured in the running app

| Check | Result |
|---|---|
| Tabs rendered | All Boards 113 · Infrastructure Desk 33 · Intelligence Desk 23 · MSP Service Desk 34 · NOC Alerts 23 |
| Arithmetic | 33 + 23 + 34 + 23 = 113, matching the All Boards pill |
| Clicking a tab | `?boardId=8be4cb6f-…` set, band becomes "Viewing **MSP Service Desk** MSP General IT support — 34 tickets on this board" |
| Scoping | every visible row's board column reads "MSP Service Desk" after the click; footer shows the 25-row page |
| Deep link | opening `/tickets?boardId=…` selects that tab and scopes the list on first paint |
| Active vs idle tab | active: primary fill, weight 600, white; idle: transparent, weight 500, grey — clearly distinguishable |
| Narrow viewport (420 px) | tabs stay 38 px tall on one line, the strip scrolls horizontally, no page-level horizontal scroll |
| Customer portal tabs | unchanged by the shared component tweak (3 tabs, 38 px, same active style) |
| Order on the page | heading 160 → toolbar 226 → search 282 → **tabs 336** → band 392 → table 455 px |

## 4. What is deliberately not decided

- **Whether the strip stays.** It is on by default with the switch in place, so the answer can be given
  by using it rather than by reading about it.
- **Whether "All Boards" should exist at all.** A board-first product might reasonably always be in a
  board, but a triage view across boards is genuinely useful, so it stays for now.
- **Whether the counts should be per-board *open* tickets** rather than all tickets. The board list
  returns a total; an open-only count needs an aggregate in the boards endpoint, which is a real (if
  small) API change and was not worth making to try an idea out.
