# Kumo — Organizations: guide & rollback

Adds an **Organizations** view inside the Kumo module: the client list, annotated
with how much Kumo documentation each organization actually has. It is the
IT Glue "Organizations" screen rebuilt with C7NTAX's own layout, theme tokens
and table conventions.

## Where it lives

| Surface | Change |
|---|---|
| Kumo nav (`KUMO` section) | New child **Organizations** → `/kumo/organizations`, directly after *Dashboard* |
| Route | `/kumo/organizations` → `KumoOrganizationsPage` |
| Kumo dashboard | The redundant **Universal Links** card is replaced by an **Organizations** card |
| Recents | Organizations can be recorded in *Recently Viewed* and appear on the Kumo dashboard |
| API | `GET /api/kumo/organizations` (additive — nothing existing changed) |

Why the dashboard card changed: the old *Universal Links* card pointed at `/kumo`
(itself) and counted `stats.links`, a field the dashboard endpoint never returns —
so it always read "0 links" and its link was a no-op. Replacing it removes a
dead end rather than adding a sixth card.

## What the page shows

- **Recents** — initials avatars for organizations you opened recently
  (`organization` entries from `/kumo/recently-viewed`), hidden until there are none.
- **Filter** — one input, debounced, matched server-side against name, legal name,
  city and industry, with an `n of total` counter beside it.
- **Table** — sortable columns: Organization (avatar, name, location), Type,
  Contacts, Assets, Passwords, Documents, Domains, Certs and Status. Click a row
  to open the client record at `/clients/:id`; doing so records the organization
  in Recents.

The counts come from one page of companies plus five grouped `companyId` counts
(assets, passwords, documents, domains, certificates), so the page costs a fixed
number of queries instead of one lookup per row.

## Instant rollback (no rebuild, no code changes)

Browser console, then reload:

```js
localStorage.setItem("c7_ui_kumo_orgs", "0"); location.reload()  // hide the view
localStorage.removeItem("c7_ui_kumo_orgs");   location.reload()  // back to default
```

With the flag off, the nav entry and the route disappear and the Kumo dashboard
card reverts to the original *Universal Links* card — i.e. exactly the previous
behaviour. Verified in-browser both ways.

## Deployment-wide rollback

Set `VITE_UI_KUMO_ORGS=false` (e.g. in `apps/web/.env.local`) and restart the web
server. The flag is read once at module load in `apps/web/src/lib/uiFlags.ts`.

## Removing it entirely

1. `apps/web/src/pages/KumoOrganizations.tsx` — delete.
2. `apps/web/src/App.tsx` — remove the import and the
   `{UI_KUMO_ORGS && <Route path="/kumo/organizations" … />}` line.
3. `apps/web/src/components/Layout.tsx` — remove the `...(UI_KUMO_ORGS ? [...] : [])`
   spread in the `kumo` nav node, the `UI_KUMO_ORGS` import, and the
   `"/kumo/organizations"` entry in the section-description map.
4. `apps/web/src/pages/Kumo.tsx` — restore the plain *Universal Links* card in
   place of the conditional pair, drop the `orgCount` state and its fetch, and
   remove the `organization` keys from `getIcon` / `getTypeLabel` / `getTypeColor`
   / `getEntityLink`.
5. `apps/web/src/lib/uiFlags.ts` — remove `UI_KUMO_ORGS`, its storage key, the
   `setUiKumoOrgs` setter and the `c7_ui_kumo_orgs` union member.
6. `apps/api/src/routes/kumo.ts` — delete the `ORGANIZATIONS` block and drop
   `"organization"` from the `validTypes` array in `POST /recently-viewed`.
   Nothing else consumes either one, so the API can also simply be left alone.

## Notes

- The endpoint is additive and inert if unused: removing the page leaves a
  harmless extra route.
- The API is launched as `tsx src/index.ts` when run outside `pnpm dev` — that
  has **no file watching**, so a manual restart is needed for the route to appear.
  With `pnpm dev` (`tsx watch src/index.ts`) it reloads by itself.
- Typecheck baselines were unchanged by this work: `apps/web` 26 errors,
  `apps/api` 178 errors (all pre-existing; none in the files touched here).
