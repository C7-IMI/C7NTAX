# Application Right-Click Menus — Rollback Guide

Right-clicking inside an enabled section opens a C7NTAX menu instead of the
browser's. Two switches control it:

1. **System setting (applies to everyone)** — Administration → System Settings →
   General → *Application right-click menus*. Stored in the `app_settings`
   system config (`SystemConfig`), under `general.contextMenus`. Missing or `true`
   means on; only an explicit `false` turns the menus off.
2. **Browser flag (one browser, instant)** — the `c7_ui_context_menus` flag in
   [apps/web/src/lib/uiFlags.ts](apps/web/src/lib/uiFlags.ts). It is a local kill
   switch layered on top of the setting, for a single machine.

Text fields (input, textarea, `contenteditable`) are never intercepted in either
state, so cut/copy/paste and spell-check keep working. Sections that have not
opted in keep the browser menu untouched.

## Where the menus are (and what is in them)

| Section | Right-click target | Menu highlights |
|---|---|---|
| Tickets `/tickets` | a row / the background | status, priority and assignee submenus, *Assign to me*, note/time/email/print, *Delete ticket…*, *Export as CSV* |
| Ticket detail `/tickets/:id` | the screen background | the same ticket actions, driven by the detail screen's own handlers |
| Client List `/clients` | a row / table header | open, new ticket, tickets, contacts, a **Kumo** submenu (organization, passwords, configurations, documents), type filter, copy |
| Contacts `/clients/contacts` | a contact card / background | details, edit, create ticket, the client's tickets, company filter, *Make primary contact*, deactivate/reactivate, copy, *Export as CSV* |
| Manage Users `/users` | a row / background | details, edit, permissions tab, security tab, activate/deactivate, lock/unlock, *Reset MFA* (asks first), copy, *Export as CSV* |
| Manage Roles `/roles` | a role / background | show permissions, edit, manage members, copy name and permission list, *Delete role…* (blocked while users are assigned), *Export as CSV* |
| Calendar `/calendar` | a day cell, an event, the background | *Add event on this date…* (prefilled 9–10am), filter to a date, month navigation, today, linked ticket, copy event details |

Every entry maps to something the app can already do. Where a capability does not
exist, the entry is absent rather than decorative:

- **Contacts have no delete endpoint** (`DELETE /clients/contacts/:id` does not
  exist), so the card menu offers deactivate/reactivate instead.
- **Client deletion is a hard `prisma.company.delete`** with relations the schema
  does not cascade consistently, and no screen in the app offers it, so the menu
  does not either. Deleting a client still needs a deliberate decision about what
  should happen to its tickets, assets and invoices.
- **`DELETE /users/:id` only deactivates** (it sets `isActive: false` and returns
  "User deactivated"), so the menu says *Deactivate user* and calls the same
  `PATCH` the page's own Danger Zone uses. There is no hard delete for users.
- **Calendar entries have no delete endpoint** (`/schedule` has GET, POST and
  PATCH), so an event can be created and edited but not removed from the menu.

## What changed

1. **`apps/web/src/components/ContextMenu.tsx`** (new) — the menu itself:
   portal to `document.body`, edge-aware flip/clamp, `role="menu"` with
   `menuitem` rows, submenus, and keyboard support
   (Shift+F10 / Menu key to open, arrows, Home/End, Enter, Escape to close).
   The panel takes focus when it opens so arrow keys drive the menu rather than
   scrolling the page behind it, and focus returns to the element it came from
   when it closes.
2. **`apps/web/src/hooks/useContextMenusEnabled.ts`** (new) — reads
   `general.contextMenus` once per page load, defaults to on when the setting is
   unset or the API is unreachable, and lets the settings screen push a change to
   everything already mounted.
3. **`apps/web/src/lib/menuActions.ts`** (new) — the pieces every menu shares:
   `openInNewTab` / `openInNewWindow` / `copyText` (with its toast),
   `currentView()` and `viewMenuEntries()` for the "open this view in…" pair.
   A section should use these rather than repeating them.
4. **`apps/web/src/pages/Tickets.tsx`** — right-click on the list
   (rows get a ticket menu, empty space gets a section menu) and on the ticket
   detail screen. Adds *Assign to me*, *Delete ticket…* and *Export as CSV*,
   plus `?action=note|time|email|attach|print` deep links into the detail screen.
5. **`apps/api/src/routes/tickets/index.ts`** — `DELETE /api/tickets/:id`
   (needs `ticket:delete`, respects the ticket's client access). Comments,
   attachments and time entries cascade with the ticket; the response reports the
   counts it removed.
6. **`apps/web/src/lib/csv.ts`** (new) — `toCsv` / `downloadCsv` / `fileStamp`
   for the CSV export (UTF-8 BOM so Excel reads accents correctly).
7. **`apps/web/src/pages/Clients.tsx`, `Contacts.tsx`, `Users.tsx`,
   `Roles.tsx` and `Calendar.tsx`** — each gets an `onContextMenu` on its root
   (the section menu), one on its rows/cards/day cells (the item menu), and
   `<ContextMenu … />` rendered inside the page. `Users.tsx` also has a local
   `MenuConfirmDialog` for the one action that asks first (*Reset MFA*), and
   `Contacts.tsx` shares one edit-form builder between its Edit button and its
   menu so the two cannot drift.
6. **`apps/web/src/pages/SystemSettings.tsx`** — the toggle, in the General tab.

## 1. Switch the menus off (no rebuild)

**For everyone** — Administration → System Settings → General, untick
*Application right-click menus*, Save. Takes effect immediately, including on
screens already open.

**One browser**:

```js
localStorage.setItem("c7_ui_context_menus", "0"); location.reload()
localStorage.removeItem("c7_ui_context_menus"); location.reload()   // back on
```

Deployment-wide: `VITE_UI_CONTEXT_MENUS=false` in `apps/web/.env.local`, then
restart the web server.

Off means the browser's own menu appears; nothing else in the section changes.

## 2. Remove the code

The whole feature is opt-in per page, so a section can be reverted on its own.

- Delete `apps/web/src/components/ContextMenu.tsx`, then remove the
  `ContextMenu` / `useContextMenu` / `isTextEntryTarget` / `MenuEntry` imports,
  the `const menu = useContextMenu()` line, the menu entry builders and the
  `<ContextMenu … />` element from each page that has them: `Tickets.tsx`
  (`TicketsPage` and `TicketDetailPage`), `Clients.tsx`, `Contacts.tsx`,
  `Users.tsx`, `Roles.tsx` and `Calendar.tsx`. The `onContextMenu` /
  `onKeyDown` props on the rows and the `tabIndex={0}` that makes
  Shift+F10 work go with it.
- Delete `apps/web/src/hooks/useContextMenusEnabled.ts` and the
  `primeContextMenusSetting` import and call in
  `apps/web/src/pages/SystemSettings.tsx`, then remove the
  *Application right-click menus* field from the General tab (leave the stored
  `general.contextMenus` value in place; nothing reads it once the files are
  gone).
- Delete `apps/web/src/lib/menuActions.ts` and the imports of it in each page
  (the *open in new tab/window* and *copy* entries are built from it).
- Delete `apps/web/src/lib/csv.ts` and the *Export as CSV* entry plus `exportCsv`
  (and `csvCellValue` / `csvColumns`) in whichever page should lose it.
- Delete the `ticketsRouter.delete("/:id", …)` handler in
  `apps/api/src/routes/tickets/index.ts`, then the *Delete ticket…* item,
  `DeleteTicketDialog`, the `deleteTarget` / `deleteOpen` / `deleting` state and
  `confirmDeleteTicket` in `Tickets.tsx`.
- `Users.tsx` — remove `MenuConfirmDialog`, `menuConfirm` / `menuConfirmBusy`
  and `runMenuConfirm` if *Reset MFA* goes; the page's own Danger Zone dialog is
  separate and stays.
- `apps/web/src/lib/uiFlags.ts` — remove the `UI_CONTEXT_MENUS` flag.
- `git checkout apps/web/src/pages/Tickets.tsx apps/web/src/pages/Clients.tsx apps/web/src/pages/Contacts.tsx apps/web/src/pages/Users.tsx apps/web/src/pages/Roles.tsx apps/web/src/pages/Calendar.tsx apps/api/src/routes/tickets/index.ts`
  reverts every modified file in one step; the new files are untracked, so
  deleting them is the whole rollback.

No database or schema change is involved. The only stored value is the
`app_settings` config row, which is what the settings screen writes for every
other General setting too.

## If the menus break the app

1. Administration → System Settings → General, untick *Application right-click
   menus*, Save — or run the `localStorage` line above. The menus are the only
   thing this code does; with them off the section behaves exactly as before.
2. Right-click doing nothing anywhere means `useContextMenusEnabled` resolved to
   false: check `GET /api/system/config/app_settings` for a `general.contextMenus`
   of `false`. A missing value is treated as on, and an unreachable API falls back
   to on, so a broken API cannot disable right-clicking.
3. Deleting a ticket is permanent. If the confirmation dialog is the problem,
   remove the *Delete ticket…* entry (see above) — nothing else depends on the
   endpoint.

## Notes for future changes

- Opt a section in by adding `onContextMenu` to its root element and rendering
  `<ContextMenu state={menu.menuState} onClose={menu.close} />`; keep the
  `isTextEntryTarget` guard so text fields keep the browser menu. Give the item
  elements their own `onContextMenu` plus `onKeyDown={(e) =>
  menu.onKeyDown(e, e.currentTarget, …)}` and a `tabIndex={0}` so Shift+F10 and
  the Menu key work from a row.
- Build the shared entries from `menuActions.ts` (`viewMenuEntries()`,
  `openInNewTab`, `openInNewWindow`, `copyText`) rather than repeating them.
- A section menu is built fresh on every right-click, so it can read current
  state (row counts, whether a filter is active, whether the item is already
  assigned to you). Keep that — a menu built once at render time goes stale.
- List actions swap their label with the item's state (*Activate*/*Deactivate*,
  *Lock*/*Unlock*, *Make primary*) and disable themselves when they would be a
  no-op. The menu is re-built per open, so the flip is visible immediately.
- Where a capability does not exist, leave the entry out and add the endpoint
  first if the action is wanted (`DELETE /tickets/:id` was added that way for
  *Delete ticket…*). The four known gaps are listed at the top of this document.
- Keep `open()`'s `preventDefault` inside the section that opts in. A global
  handler would take the browser menu away from every other module.
- Menu entries must map to something the app can actually do. Every entry calls an
  existing API or a handler on the screen; adding an entry that has no endpoint
  behind it means adding that endpoint first (as `DELETE /tickets/:id` was added
  for *Delete ticket…*).
