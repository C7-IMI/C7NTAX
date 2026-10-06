# Kumo — Organizations: guide & rollback

Adds an **Organizations** view inside the Kumo module: the client list, annotated
with how much Kumo documentation each organization actually has, plus a
per-organization documentation dashboard behind it. It is the IT Glue
"Organizations" list and "Organization" dashboard rebuilt with C7NTAX's own
layout, theme tokens and table conventions.

## Where it lives

| Surface | Change |
|---|---|
| Kumo nav (`KUMO` section) | New child **Organizations** → `/kumo/organizations`, directly after *Dashboard* |
| Route | `/kumo/organizations` → `KumoOrganizationsPage` |
| Route | `/kumo/organizations/:id` → `KumoOrganizationDetailPage` (the organization dashboard) |
| Route | `/kumo/domains` → `KumoDomainsPage` (the expiry tracker the dashboard links into) |
| Kumo nav (`KUMO` section) | New child **Domains & Certs** → `/kumo/domains`, after *Documents* |
| Kumo dashboard | The redundant **Universal Links** card is replaced by an **Organizations** card |
| Recents | Organizations can be recorded in *Recently Viewed*; clicking one opens its organization screen |
| API | `GET /api/kumo/organizations` and `GET /api/kumo/organizations/:id` (additive) |
| Data model | `Company.parentId` + `children` self-relation, so sub-organizations are real records |
| API | `POST`/`PATCH /api/clients` also accept `parentId` (with a cycle guard) |
| Shared | `packages/shared/src/passwordStrength.ts` — one strength ladder for the vault and the dashboard |

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
  Contacts, Assets, Passwords, Documents, Domains, Certs and Status. Clicking a
  row opens that organization's screen (below) and records it in Recents; the
  header's *Client records* button is the way to the CRM list.

The counts come from one page of companies plus five grouped `companyId` counts
(assets, passwords, documents, domains, certificates), so the page costs a fixed
number of queries instead of one lookup per row.

## What the organization screen shows

`GET /api/kumo/organizations/:id` returns everything the screen needs in one
round trip, all scoped to that client:

> **The type rail** (Core Assets / Asset Types) sits beside this dashboard and
> drives it through a `?type=` param. It has its own guide and rollback —
> [KUMO-TYPES-ROLLBACK.md](KUMO-TYPES-ROLLBACK.md) — because the seeded asset
> types behind it are data that can be reversed separately from this screen.

- **Header** — name, active state, type, location, industry, service level and
  contact/ticket counts, with *New Document*, *Edit* (the client record) and a
  *Quick Add* menu (asset, password, document, configuration, contact,
  sub-organization).
- **Quick Notes** — the client record's `notes` field, editable in place and
  saved through `PATCH /api/clients/:id`.
- **Password Strength** — the vault's regular/strength ladder (length, case,
  digits, symbols) scored server-side, with credentials that cannot be decrypted
  (seed placeholders) counted as *Not evaluated*.
- **Documentation Health Summary** — ring indicators for *Stale* (a document
  untouched for 90 days), *Not Viewed* (never opened) and *Expired* (a domain or
  certificate past its expiry date).
- **Recently Viewed By You / Important Contacts / Recently Updated** — your
  recents that point at this client's items, its contacts (primary first), and
  the most recently touched records of any type.
- **Popular Passwords / Upcoming Expirations / Locations** — passwords ordered by
  vault access count, the next expiry dates across passwords, certificates and
  domains, and the client's main address.
- **Activity Feed** — created/updated events derived from the records themselves
  (the audit log records paths, not owning organizations, so filtering it here
  would miss every create), with a link to the full audit log.
- **Sub-Organizations** — child companies that report into this one, creatable
  from the header menu or the section, each opening its own organization screen.

The rail adds the per-type entries (`?type=<templateId>` in-page views, plus
`?type=locations`), and the client-scoped links to Passwords, Configurations,
Documents, Contacts, the expiry tracker and Tickets.

## Opening a specific item

Every entry in every card is a link to that record, not to a list. The URL
contract these links rely on:

| Item | Opens |
|---|---|
| Asset | `/kumo/assets/:id` (existing detail page) |
| Password | `/kumo/passwords?select=<id>` — selects it in the vault |
| Configuration | `/kumo/configs?select=<id>` — selects the server |
| Document | `/kumo/documents?doc=<id>` — opens the document |
| Domain or certificate | `/kumo/domains?select=<id>` — selects it in the tracker |
| Contact | `/clients/contacts?select=<id>` — selects it on the contacts page |
| Organization | `/kumo/organizations/:id` |

Each target page reads its query param once its list arrives, so a deep link
works on a cold load. Aggregates link to the matching filtered view instead:
strength buckets → `/kumo/passwords?strength=<level>` (scored server-side only
when asked), the Stale and Not Viewed rings → `/kumo/documents?filter=stale|unviewed`,
the Expired ring and *View All* → `/kumo/domains?filter=expired|upcoming`
(the latter also passes `companyId` to scope it to the client). Each filtered
page shows a chip that clears the filter.

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

1. `apps/web/src/pages/KumoOrganizations.tsx` and
   `apps/web/src/pages/KumoOrganizationDetail.tsx` — delete.
2. `apps/web/src/pages/KumoDomains.tsx` — delete, along with its nav entry in
   `Layout.tsx` (the same `...(UI_KUMO_ORGS ? [...] : [])` spread that adds
   Organizations), its `"/kumo/domains"` section description, its route in
   `App.tsx`, and the `DOMAINS & CERTIFICATES` block in
   `apps/api/src/routes/kumo.ts`.
3. `apps/web/src/lib/format.ts` — delete (only the Kumo organization and domain
   pages use it; the `getPageTitle` prefix fix in step 4 can stay on its own merits).
4. `apps/web/src/App.tsx` — remove the three imports and the three
   `{UI_KUMO_ORGS && <Route path="/kumo/organizations…" … />}` lines.
5. `apps/web/src/components/Layout.tsx` — remove the `...(UI_KUMO_ORGS ? [...] : [])`
   spreads in the `kumo` nav node, the `UI_KUMO_ORGS` import, and the
   `"/kumo/organizations"` and `"/kumo/domains"` section descriptions.
   `getPageTitle` can keep matching the most specific route — that change fixes
   the header title on every nested page, not just these.
6. `apps/web/src/pages/Kumo.tsx` — restore the plain *Universal Links* card in
   place of the conditional pair, drop the `orgCount` state and its fetch, and
   remove the `organization` keys from `getIcon` / `getTypeLabel` / `getTypeColor`
   / `getEntityLink`.
7. The query-param deep links in steps below can go too: the `select` / `doc` /
   `strength` / `filter` handling in `KumoPasswords.tsx`, `KumoDocuments.tsx`,
   `KumoConfigs.tsx` and `Contacts.tsx`, and the `strength` branch of
   `GET /api/kumo/passwords`.
8. `apps/web/src/lib/uiFlags.ts` — remove `UI_KUMO_ORGS`, its storage key, the
   `setUiKumoOrgs` setter and the `c7_ui_kumo_orgs` union member.
9. `apps/api/src/routes/kumo.ts` — delete the `ORGANIZATIONS` block (both routes
   and the `resolveCompanyId` helper if nothing else needs it) and drop
   `"organization"` from the `validTypes` array in `POST /recently-viewed`.
   Nothing else consumes either one, so the API can also simply be left alone.
10. Sub-organizations only: remove `parentId` / `parent` / `children` and
    `@@index([parentId])` from the `Company` model in
    `apps/api/prisma/schema.prisma`, then `npx prisma db push`, and drop `"parentId"`
    plus the two guards from `POST` and `PATCH /api/clients` in
    `apps/api/src/routes/clients.ts`.
11. `packages/shared/src/passwordStrength.ts` — the vault refactor can stay (it is
    behaviour-identical apart from a full-strength password now reading
    *Very Strong* instead of *Strong*); to unwind it, restore the local
    `passwordStrength()` helper in `apps/web/src/pages/KumoPasswords.tsx`.

## Notes

- The endpoints are additive and inert if unused: removing the pages leaves
  harmless extra routes.
- `apps/web/node_modules/.vite` caches a pre-bundled copy of `@C7NTAX/shared`
  (it is listed in `optimizeDeps.include`). After adding an export to that package
  the dev server can keep serving the stale bundle and the app fails to boot with
  *"does not provide an export named …"*. Touching `apps/web/vite.config.ts` makes
  Vite restart and re-optimize, which clears it without touching the running
  server (verified).
- The API is launched as `tsx src/index.ts` when run outside `pnpm dev` — that
  has **no file watching**, so a manual restart is needed for a new route to
  appear. With `pnpm dev` (`tsx watch src/index.ts`) it reloads by itself; the
  watcher was used while building this.
- `Company.parentId` is nullable and additive, so existing rows are untouched by
  `prisma db push`; `apps/api/src/snapshots/*.json` refresh from the poller.
- Typecheck baselines were unchanged by this work: `apps/web` 26 errors,
  `apps/api` 178 errors (all pre-existing; none in the files touched here).
