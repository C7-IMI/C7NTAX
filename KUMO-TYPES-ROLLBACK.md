# Kumo Asset Types & Organization Rail — Rollback Guide

Feature: the organization screen's **type rail** (Core Assets / Asset Types), its in-page
type views, and the **standard asset types** seeded as Kumo templates.

Ships in three independently reversible parts. Part 3 is data, parts 1–2 are UI.

| # | Part | Reversible by | Effect |
|---|------|---------------|--------|
| 1 | The rail and its type views | `UI_KUMO_TYPES` flag | Organization screen returns to exactly its previous layout |
| 2 | Client-scoped deep links (`?companyId=`, `?kind=`, `?companyType=`) | Removing the params | Existing screens behave as before when no param is present |
| 3 | The 19 standard asset types | `db:types-off` | Seeded templates removed or deactivated |

Nothing in this feature is destructive on its own: no schema change, no migration, and the
organization payload only gained fields.

---

## 1. Switch the rail off (instant, no rebuild)

Browser console, then reload:

```js
localStorage.setItem("c7_ui_kumo_types", "0"); location.reload()
localStorage.removeItem("c7_ui_kumo_types"); location.reload()   // back on
// or the helper
setUiKumoTypes(false)
```

Deployment-wide: add `VITE_UI_KUMO_TYPES=false` to `apps/web/.env.local` and restart the
web server. Default is **on**.

With the flag off the organization screen renders its original single-column dashboard.
`?type=` values are ignored, so stale links are harmless.

## 2. Remove the code

Delete or revert these files (part 1):

- `apps/web/src/components/OrganizationTypeRail.tsx` (new)
- `apps/web/src/components/OrganizationTypePanel.tsx` (new)
- `apps/web/src/lib/kumoIcons.ts` (new — only used by the two above and by KumoAssets)

Revert the edits in:

- `apps/web/src/pages/KumoOrganizationDetail.tsx` — the two-column wrapper, the `?type=`
  panel branch, the rail render and the `LocationsPanel` helper
- `apps/web/src/pages/KumoAssets.tsx` — the `?new=1&templateId=&companyId=` preset and the
  shared icon map
- `apps/web/src/lib/uiFlags.ts` — the `UI_KUMO_TYPES` flag
- `apps/api/src/routes/kumo.ts` — the `assetTypes`/`changeBoard`/`counts.configs` additions
  to `GET /organizations/:id`

Client scoping (part 2) is additive and safe to leave in place. To remove it, drop the
`companyId`/`kind`/`companyType` params from the rails' links and the `searchParams.get`
lines in `KumoPasswords.tsx`, `KumoConfigs.tsx`, `KumoDocuments.tsx`, `Contacts.tsx`,
`KumoDomains.tsx` and `KumoOrganizations.tsx`. The API-side filters (`companyId` on
`GET /assets`, `companyType` on `GET /organizations`) are inert without the params.

## 3. Remove the seeded types

```bash
pnpm --filter api db:types-off            # remove or deactivate the standard types
pnpm --filter api db:types-off -- --dry-run   # see the plan first
```

Behaviour, and why it is safe:

- Only the 19 names listed in `apps/api/src/kumo-types-toggle.ts` (`STANDARD_TYPES`) are
  touched. Types you created or renamed are never affected.
- A type nothing uses is **deleted**, along with its field definitions.
- A type that holds assets is **deactivated**, never deleted, so the assets stay readable
  and nothing breaks. It keeps its fields.
- `pnpm --filter api db:types-on` recreates whatever was removed and reactivates whatever
  was deactivated (idempotent — it reports and skips types that already exist with fields).

If you would rather remove one type by hand: **Kumo → Assets** lists active templates with a
delete action, and `DELETE /api/kumo/templates/:id` refuses to delete a template that any
asset still uses (it tells you the count). Deactivating instead (`PATCH` with
`{"isActive": false}`) takes it out of the rail immediately.

The service board behind the rail's **Change Control** entry is not part of this feature:
create or remove it in **Administration → Service Boards**. The rail looks for a board whose
name contains "change" and links to the client's tickets filtered by it; with no such board
it links to the client's tickets unfiltered. `db:types-off` never touches boards.

## 4. If the app breaks after a rollback

1. `pnpm --filter api db:types-off` (if the database is suspected)
2. `localStorage.setItem("c7_ui_kumo_types", "0"); location.reload()`
3. Restart the API (`apps/api`: `pnpm dev`) and the web server.
4. `git checkout apps/web/src/pages/KumoOrganizationDetail.tsx apps/web/src/pages/KumoAssets.tsx`
   for a file-level revert of the UI.
5. Check the API is healthy: `curl -s http://localhost:4000/api/health`

## Notes for future changes

- The rail lists **every active template** (`isActive: true`), whether global or owned by
  the client, so adding a type in the database is enough for it to appear.
- `?type=<templateId>` is the rail's view contract; `?type=locations` is the address panel.
  Unknown values fall back to the dashboard rather than erroring.
- Empty types are hidden behind "Show N empty types" (persisted in
  `localStorage.c7_kumo_types_show_empty`). Set that key to `1` to always list them.
