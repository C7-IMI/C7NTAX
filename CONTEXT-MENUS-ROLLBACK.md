# Application Right-Click Menus (Tickets) — Rollback Guide

Right-clicking inside the Tickets section opens a C7NTAX menu instead of the
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
opted in (everything except Tickets) keep the browser menu untouched.

## What changed

1. **`apps/web/src/components/ContextMenu.tsx`** (new) — the menu itself:
   portal to `document.body`, edge-aware flip/clamp, `role="menu"` with
   `menuitem` rows, submenus (status, priority, assignee), and keyboard support
   (Shift+F10 / Menu key to open, arrows, Home/End, Enter, Escape, Tab to close).
   The panel takes focus when it opens so arrow keys drive the menu rather than
   scrolling the page behind it, and focus returns to the element it came from
   when it closes.
2. **`apps/web/src/hooks/useContextMenusEnabled.ts`** (new) — reads
   `general.contextMenus` once per page load, defaults to on when the setting is
   unset or the API is unreachable, and lets the settings screen push a change to
   everything already mounted.
3. **`apps/web/src/pages/Tickets.tsx`** — right-click on the list
   (rows get a ticket menu, empty space gets a section menu) and on the ticket
   detail screen. Adds *Assign to me*, *Delete ticket…* and *Export as CSV*,
   plus `?action=note|time|email|attach|print` deep links into the detail screen.
4. **`apps/api/src/routes/tickets/index.ts`** — `DELETE /api/tickets/:id`
   (needs `ticket:delete`, respects the ticket's client access). Comments,
   attachments and time entries cascade with the ticket; the response reports the
   counts it removed.
5. **`apps/web/src/lib/csv.ts`** (new) — `toCsv` / `downloadCsv` / `fileStamp`
   for the CSV export (UTF-8 BOM so Excel reads accents correctly).
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

- Delete `apps/web/src/components/ContextMenu.tsx`, then remove the
  `ContextMenu` / `useContextMenu` / `isTextEntryTarget` / `MenuEntry` import and
  the menu state, entry builders and `<ContextMenu … />` line from
  `apps/web/src/pages/Tickets.tsx` (both `TicketsPage` and `TicketDetailPage`).
  The `onContextMenu` props go with it.
- Delete `apps/web/src/hooks/useContextMenusEnabled.ts` and the
  `primeContextMenusSetting` import and call in
  `apps/web/src/pages/SystemSettings.tsx`, then remove the
  *Application right-click menus* field from the General tab (leave the stored
  `general.contextMenus` value in place; nothing reads it once the files are
  gone).
- Delete `apps/web/src/lib/csv.ts` and the *Export as CSV* entry plus `exportCsv`
  / `csvCellValue` in `Tickets.tsx`, if the export should go too.
- Delete the `ticketsRouter.delete("/:id", …)` handler in
  `apps/api/src/routes/tickets/index.ts`, then the *Delete ticket…* item,
  `DeleteTicketDialog`, the `deleteTarget` / `deleteOpen` / `deleting` state and
  `confirmDeleteTicket` in `Tickets.tsx`.
- `apps/web/src/lib/uiFlags.ts` — remove the `UI_CONTEXT_MENUS` flag.
- `git checkout apps/web/src/pages/Tickets.tsx apps/api/src/routes/tickets/index.ts`
  reverts the two modified files in one step; the new files are untracked, so
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
  `isTextEntryTarget` guard so text fields keep the browser menu.
- Keep `open()`'s `preventDefault` inside the section that opts in. A global
  handler would take the browser menu away from every other module.
- Menu entries must map to something the app can actually do. Every entry calls an
  existing API or a handler on the screen; adding an entry that has no endpoint
  behind it means adding that endpoint first (as `DELETE /tickets/:id` was added
  for *Delete ticket…*).
