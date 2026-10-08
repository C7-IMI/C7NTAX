# Interface (Screens) — Rollback Guide

The application's **screens** come in two layouts. Both are the same application —
the same routes, the same permissions, the same panels, the same data:

1. **Redesign** (default) — screens arranged around tabs and a **compact single-row
   header**, using the full width of the window. A record leads with what it is,
   where it sits and the two states that matter, and groups its panels into a few
   tabs whose contents are sub-tabs one click away. Built by the screens themselves,
   which ask for it through `useRedesign()`
   ([apps/web/src/hooks/useNavigationStyle.ts](apps/web/src/hooks/useNavigationStyle.ts)).
2. **Classic** — the layout the application had before, unchanged. Every screen that
   has a redesigned form keeps its classic form in the same file, behind the same
   condition, so there is one component and one place to look.

This is **not** the navigation pane's switch. The pane has its own (see
[NAV-PANE-ROLLBACK.md](NAV-PANE-ROLLBACK.md)), and the two are independent: the rail
can be paired with classic screens, and the single tree with redesigned ones. Colour
scheme, light/dark and density belong to neither and are carried across the change
untouched.

Three switches, narrowest first:

| # | Switch | Scope | How |
|---|---|---|---|
| 1 | **System setting** | everyone | Administration → Configuration → Workspace → **Interface** → *Classic*. Stored in `app_settings` under `appearance.interfaceStyle`. |
| 2 | **Browser flag** | one browser | **My Account → Appearance → Interface**, or `localStorage.setItem("c7_ui_redesign", "0")` — and `"1"` forces the redesign on an instance that is set to classic. |
| 3 | **Build flag** | a deployment | `VITE_UI_REDESIGN=false` in `apps/web/.env.local`, then restart the web server. Beats the setting. |

Switch 2 has a face, and everyone is offered it: **My Account → Appearance →
Interface** flips the screens in place, with no reload. That control is shown
whenever the **build** has the redesigned screens — not whenever they are active —
so somebody who has already chosen classic can still choose their way back. It
writes the same `c7_ui_redesign` flag the table above names, so the menu and this
document cannot drift apart.

The default for everyone is **Redesign**: the system setting ships as `redesign`, and
it only becomes classic if an administrator sets it to *Classic* or somebody chooses
that for their own browser.

## Which screens are redesigned today

The switch is one switch, but the screens adopt it as they are converted — a screen
that has not been converted yet renders exactly as it always did, whichever way the
switch is set. That is deliberate: a half-converted screen is worse than a classic
one.

| Screen | Redesigned form |
|---|---|
| **Tickets** (list) | Title and toolbar on one row, so the list begins higher up. |
| **Ticket detail** | Five grouped tabs with sub-tabs, a compact single-row header, no fixed width. |
| Everything else | Classic, while the rest of the redesign lands. |

A screen opts in by calling `useRedesign()` and choosing its shape from the result.
It must keep its classic shape working, under the same condition, so the switch is
never a one-way door.

## What the redesigned detail does that could surprise you

- **`activeTab` still holds a real panel id.** The groups are a *grouping*, not a
  new vocabulary: `activeTab` remains one of the twelve original ids
  (`ticket`, `activities`, `time`, …), so the per-tab loading effect and every
  `activeTab === "…"` panel guard keep working untouched. `TICKET_TAB_GROUPS` only
  decides which of them the strip shows and what the sub-tab row offers.
- **A group remembers its last sub-tab** (`tabByGroup`, per visit). Clicking *Work*
  after *Activity* returns you to the panel you were last on in *Work*, not to its
  first one. Nothing is persisted; a reload starts on *Overview*.
- **Every panel is still one click away at most** — never two. A group with a single
  panel shows no sub-tab row, because a list of one is not a list.
- **The tab strip is sticky.** It stays at the top of the window while the panel
  scrolls, which is what makes the grouping worth having. `main` in `Layout.tsx` is
  the scroll container (`flex h-screen overflow-hidden` around a scrolling `<main>`),
  and `.animate-fade-in` animates opacity only, so nothing in the ancestor chain
  breaks `position: sticky`.
- **The detail page no longer uses `max-w-4xl`** in redesign mode. Be careful with this
  one: it was already **inert**, because the P2 content cap —
  `[data-ui-p2="true"] main > * { max-width: 1600px }` in `index.css` — is what decides a
  page's width while P2 is on. Removing it states the intention (the redesigned detail
  does not add a narrower reading measure of its own) rather than delivering a measured
  gain, and if that blanket cap is ever removed the detail will follow the window instead
  of reverting to two-thirds of it. Do not credit the redesign with a width saving.
- **The actions sit on the tab row.** In redesign mode the toolbar card is a wrapping
  flex row — `order-1` the tabs at `flex-1`, `order-2` the actions, `order-3` the sub-tab
  row at `w-full` — which is worth about 30px. Measured against the classic layout on a
  1280px window, a panel's content begins **about 70px higher** on the ticket detail, and
  **about 90px higher** on the ticket list, where the title and toolbar share a row.
- **There is no drag handle on the context area.** The complaint was scrolling, and the
  fix for it was spacing — header on one row, the actions merged into the tab row,
  padding tightened. A vertical resize handle was the fallback and was not needed; it can
  be added later without disturbing anything here.

## Files

| File | What it is |
|---|---|
| `apps/web/src/lib/uiFlags.ts` | `UI_REDESIGN`, `UI_REDESIGN_AVAILABLE`, `redesignOverride()`, `setUiRedesign()`, the `c7_ui_redesign` key. |
| `apps/web/src/hooks/useNavigationStyle.ts` | Resolves the three switches into `interfaceStyle`, and exports `useRedesign()` for screens. |
| `packages/shared/src/appConfiguration.ts` | The `interfaceStyle` field in the Workspace section. |
| `apps/web/src/components/MyAccountMenu.tsx` | The **Interface** switch in Appearance. |
| `apps/web/src/pages/Tickets.tsx` | `TICKET_TAB_GROUPS`, and both shapes of the list and the detail. |

## Reverting the change in code

Reversing it is subtraction; nothing else depends on it.

1. `Tickets.tsx` — delete the `redesign` branches, the `TicketTabGroup` type and
   `TICKET_TAB_GROUPS`, and restore `className="space-y-6 animate-fade-in max-w-4xl"`
   on the detail root and the two-row header.
2. Delete `useRedesign()` from `useNavigationStyle.ts`, and this file.
3. `uiFlags.ts` — remove `UI_REDESIGN`, `UI_REDESIGN_AVAILABLE`, `redesignOverride`,
   `setUiRedesign` and `c7_ui_redesign` from `FlagStorageKey`.
4. `appConfiguration.ts` — remove the `interfaceStyle` field from the Workspace section.
5. `MyAccountMenu.tsx` — remove the **Interface** chip row, and the
   `interfaceStyle`/`setInterfacePreference`/`UI_REDESIGN_AVAILABLE` uses.
6. `HelpDoc.tsx` — remove the *Interface* walkthrough, its Index row, and the two FAQ
   answers that mention the switch.

The browser flag it leaves behind is ignored once the code is gone and can be cleared
with `localStorage.removeItem("c7_ui_redesign")`.

## If the app breaks

1. **Is it the screens?** `localStorage.setItem("c7_ui_redesign", "0"); location.reload()`.
   If the layout returns to the classic one and the problem goes, it is this change.
2. **A tab shows the wrong panel, or a panel will not load.** Check `activeTab` in the
   React devtools: it must be one of the twelve original ids. A group whose `tabs`
   array holds a typo'd id would leave the panel guards unmatched and the strip
   showing the group — `TICKET_TAB_GROUPS` is the only place that can be wrong, and
   every id in it is checked against `TICKET_DETAIL_TABS` by eye at review time.
3. **The strip does not stay pinned.** A sticky element stops working if an ancestor
   gains a transform, filter or `overflow: hidden`. `Layout.tsx`'s `<main>` is the
   scroll container; if the strip scrolls away, something between the two has changed.
4. **The layout is cramped, not broken.** That is the classic pane at 256px with a
   classic page's fixed measure. Widen the window or switch the pane; the redesign
   does not reserve width.
5. **Everything looks classic on a build that should not have it.** `VITE_UI_REDESIGN`
   is set to a falsey value. It is a build flag, so it needs the web server
   restarted, and it deliberately cannot be overridden from the browser.
