# Navigation Pane — Rollback Guide

The left pane comes in two shapes, generated from the **same** navigation tree
(`NAV_TREE` in [apps/web/src/components/Layout.tsx](apps/web/src/components/Layout.tsx)):

1. **Modern** (default) — a rail of domains that stays the same length as the
   product grows. Choosing one **flies its destinations out over the content**,
   anchored to the rail, and the panel closes the moment you pick something,
   click away or press `Esc`. Built by
   [apps/web/src/components/NavPaneModern.tsx](apps/web/src/components/NavPaneModern.tsx),
   grouped by [apps/web/src/lib/navModel.ts](apps/web/src/lib/navModel.ts).
2. **Classic** — the single collapsible tree: every section and every nested row
   in one list, exactly as it was before this arrived.

Three switches, narrowest first:

| # | Switch | Scope | How |
|---|---|---|---|
| 1 | **System setting** | everyone | Administration → Configuration → Workspace → **Navigation pane** → *Single tree (classic)*. Stored in `app_settings` under `appearance.navigationStyle`. |
| 2 | **Browser flag** | one browser | `localStorage.setItem("c7_ui_nav", "0"); location.reload()` — and `"1"` forces modern on an instance that is set to classic. |
| 3 | **Build flag** | a deployment | `VITE_UI_NAV=false` in `apps/web/.env.local`, then restart the web server. Beats the setting. |

Nothing else changes when the pane changes: the routes, the permissions, the
icons and the pages are the tree's, not the pane's. Switching is therefore safe in
both directions and needs no data migration.

## What the modern pane does that could surprise you

- **It orders rows by what you open.** Frequency weighted by recency, per browser
  (`c7_nav_use`). The A–Z toggle in the column header turns it off and keeps the
  column still.
- **It folds rows you have never opened** — but *only* in a domain with more than
  eight rows, and *only* once you have opened something in that domain. With no
  usage recorded, nothing is folded, so a first run is never worse than the tree it
  replaced. Folded rows sit under **Everything else**, counted, one click away.
- **The rail cannot be reordered.** The classic pane lets you drag sections into
  your own order; the rail is deliberately fixed, because its stability is the
  point. Row order inside a domain is the part that adapts.
- **Favourites still work.** Pinned sections appear as a **Pinned** group at the
  top of the domain that owns them, and right-clicking a row pins or unpins it
  exactly as before. They are the same server-side list (`/nav/favorites`).
- **The pane is narrower than the one it replaces.** The rail is 200px against
  the classic tree's 256px, and the destinations fly out over the content, so the
  page keeps its width and nothing has to lay out around a second column. An
  earlier version reserved 432px for two permanent columns; on a 1280px window
  that took a third of the screen and squeezed every page in the application,
  which is why the panel overlays instead.
- **The panel opens on a click, not on hover** — a panel that appears whenever the
  pointer crosses the rail is one that flashes open on the way to somewhere else.
  Once it is open, moving along the rail switches it immediately. `Esc`, a click
  outside, or choosing a destination closes it.
- **It never hides a destination.** A section that the pane has not been told
  where to put appears under **Other**, on its own rail row — a visible prompt that
  the pane needs updating, rather than a row that is simply missing.

## Files

| File | What it is |
|---|---|
| `apps/web/src/lib/navModel.ts` | The domains, and the read-back of labels, routes, icons and permissions from `NAV_TREE`. Frecency and the fold rule. |
| `apps/web/src/components/NavPaneModern.tsx` | The rail and the column. |
| `apps/web/src/hooks/useNavigationStyle.ts` | Resolves the three switches. |
| `apps/web/src/lib/uiFlags.ts` | `UI_NAV_MODERN`, `navModernOverride()`, `setUiNavModern()`. |
| `packages/shared/src/appConfiguration.ts` | The `navigationStyle` and `assistantInRail` fields. |
| `apps/web/src/components/Layout.tsx` | Renders one pane or the other; the classic branch is unchanged. |

## Reverting the change in code

Nothing here is load-bearing for any other feature, so a full revert is
subtraction:

1. `Layout.tsx` — render the classic branch unconditionally (delete the
   `modernNav` conditional and the `NavPaneModern` import), and restore the
   header description.
2. Delete `NavPaneModern.tsx`, `navModel.ts`, `useNavigationStyle.ts` and this file.
3. `uiFlags.ts` — remove `UI_NAV_MODERN`, `navModernOverride`, `setUiNavModern` and
   the `c7_ui_nav` storage key.
4. `appConfiguration.ts` — remove the `navigationStyle` and `assistantInRail`
   fields from the Workspace section.
5. `Configuration.tsx` — remove the two `refreshNavigationSettings()` calls and the
   import.
6. `HelpDoc.tsx` — remove the walkthrough, its Index rows and the FAQ answers.

Local storage keys it leaves behind — `c7_nav_use`, `c7_nav_roworder`,
`c7_nav_quiet_open` — are ignored once the code is gone and can be cleared with
`Object.keys(localStorage).filter(k => k.startsWith("c7_nav_")).forEach(k => localStorage.removeItem(k))`.

## If the app breaks

1. **Is it the pane?** `localStorage.setItem("c7_ui_nav", "0"); location.reload()`.
   If the pane returns to the tree and the problem goes, it is this change.
2. **A domain is empty or a row is missing.** Check the account's permissions
   first — `filterNavByPermission` runs before the pane sees the tree, and a
   permission can empty a whole domain, which removes the rail row rather than
   showing it empty. Then check **Other** on the rail: a row there means
   `navModel.ts` has not been told where a section belongs.
3. **The wrong domain is open.** The rail follows the route. A domain selected by
   hand stays until something is opened, which is intended; if it disagrees with
   the page, it is the longest-match rule in `NavPaneModern.tsx`.
4. **A row is ordered oddly.** That is the learned order. The A–Z toggle proves it:
   if A–Z is correct and learned is not, the usage data is the cause, and
   `localStorage.removeItem("c7_nav_use")` resets it.
5. **Everything vanishes.** The pane renders from `buildNavPane`, which returns the
   unsorted remainder rather than throwing, so a domain list that is wrong shows
   rows under **Other** rather than a blank rail. A blank rail means `tree` arrived
   empty — check `permissions`, not the pane.
