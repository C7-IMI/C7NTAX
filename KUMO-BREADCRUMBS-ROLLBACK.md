# Kumo Breadcrumb Trail & Back Button — Rollback Guide

Feature: the header breadcrumb trail now resolves for every Kumo screen, names the
client/record/type you are looking at, and carries a back button. It is one trail,
rendered globally by [apps/web/src/components/Layout.tsx](apps/web/src/components/Layout.tsx)
from [apps/web/src/components/Breadcrumbs.tsx](apps/web/src/components/Breadcrumbs.tsx).
No screen renders its own trail — there is exactly one.

## What changed

1. **`buildBreadcrumbs` picks the deepest navigation match.** It used to walk the
   tree and accept the first child whose path was a prefix of the current URL. A
   section's own root (`/kumo`) is a prefix of every one of its children
   (`/kumo/passwords`), so *every* Kumo sub-page collapsed to "Dashboard" — and
   the same bug hit other sections (e.g. `/billing` showed "Finance Dashboard" on
   the invoices list). Everything now compares match length and keeps the longest.
2. **The trail has a back button.** It returns through history when there is
   history (React Router's `history.state.idx > 0`), and otherwise goes to the
   nearest parent in the trail, so a bookmarked deep link still has a way back.
3. **Screens contribute what the navigation tree cannot know** — the client name,
   a record name, the selected type or the active filter — through
   `useBreadcrumbTrail` + the `kumoTrail` / `kumoClientTrail` helpers. A screen's
   trail replaces the derived one and is withdrawn when it unmounts.

Resulting trails:

| Screen | Trail |
|---|---|
| `/kumo` | Home › Kumo › Dashboard |
| `/kumo/organizations` | Home › Kumo › Organizations |
| `/kumo/organizations/:id` | Home › Kumo › Organizations › *client* |
| `…?type=<templateId>` | … › *client* › *type name* |
| `…?type=locations` | … › *client* › Locations |
| `/kumo/assets` | Home › Kumo › Assets |
| `/kumo/assets/:id` | Home › Kumo › Assets › *asset name* |
| `/kumo/passwords` | Home › Kumo › Passwords |
| `/kumo/passwords?companyId=` | Home › Kumo › Organizations › *client* › Passwords |
| `/kumo/documents?filter=stale` | Home › Kumo › Documents › Stale |
| `/kumo/domains?kind=Certificate` | Home › Kumo › Organizations › *client* › Domains & Certs › Certificates |

## 1. Switch the dynamic Kumo crumbs off (instant, no rebuild)

```js
localStorage.setItem("c7_ui_kumo_crumbs", "0"); location.reload()
localStorage.removeItem("c7_ui_kumo_crumbs"); location.reload()   // back on
// or
setUiKumoBreadcrumbs(false)
```

Deployment-wide: `VITE_UI_KUMO_BREADCRUMBS=false` in `apps/web/.env.local`.

With the flag off, Kumo screens stop contributing their dynamic segments and the
trail falls back to the navigation tree (e.g. `Home › Kumo › Organizations`),
which is still correct — just less specific. The back button and the
deepest-match fix are part of the shared header trail rather than Kumo-specific
behaviour, so they stay; step 2 removes them.

## 2. Remove the code

- `apps/web/src/components/Breadcrumbs.tsx` — revert to the previous version to
  drop the back button and restore first-match breadcrumb resolution.
  Everything else in that file is self-contained.
- Remove the `BreadcrumbTrailProvider` wrapper in
  `apps/web/src/components/Layout.tsx` (and its import).
- Remove the `useBreadcrumbTrail` calls and their imports from the Kumo pages:
  `KumoOrganizationDetail.tsx`, `KumoAssetDetail.tsx`, `KumoPasswords.tsx`,
  `KumoConfigs.tsx`, `KumoDocuments.tsx`, `KumoDomains.tsx`. Each is a single
  call near the top of the component plus one import line; nothing else depends
  on them, so removing a call is safe on its own.
- `apps/web/src/lib/uiFlags.ts` — remove the `UI_KUMO_BREADCRUMBS` flag.

Nothing in this feature touches the API, the database or any stored data, so
there is no data step to reverse.

## If the trail breaks the app

1. `localStorage.setItem("c7_ui_kumo_crumbs", "0"); location.reload()` — clears
   the page-supplied segments, which is where a bad segment would come from.
2. Check the browser console for `Rendered fewer hooks than expected`: that means
   a `useBreadcrumbTrail` call was moved below an early `return` in a page. Every
   call site sits above the component's loading guards, because a hook must run
   on every render.
3. `git checkout apps/web/src/components/Breadcrumbs.tsx apps/web/src/components/Layout.tsx`
   reverts the shared component and the provider in one step.

## Notes for future changes

- Add a screen's dynamic crumbs with `useBreadcrumbTrail(...)`, never by
  rendering a second trail — the header shows exactly one.
- `useBreadcrumbTrail` must be called unconditionally, before any early return.
  Pass `null` while data is loading and the navigation tree's trail is used.
- `Breadcrumbs` renders nothing when the trail has fewer than two segments, so
  `/home` stays clean.
