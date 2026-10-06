# Kumo Breadcrumb Trail & Back Button — Rollback Guide

Two trails coexist by design:

1. **The global trail** in the header, from [apps/web/src/components/Breadcrumbs.tsx](apps/web/src/components/Breadcrumbs.tsx),
   built from the navigation tree. Original behaviour, unchanged: no back
   button, no page-supplied segments.
2. **Kumo's own trail**, from [apps/web/src/components/KumoTrail.tsx](apps/web/src/components/KumoTrail.tsx),
   rendered at the top of the Kumo content area. This is the one with the back
   button, the client/record names and the active filter. It appears on Kumo
   screens only.

## What changed

1. **`buildBreadcrumbs` picks the deepest navigation match.** It used to accept
   the first child whose path was a prefix of the current URL. A section's own
   root (`/kumo`) is a prefix of every one of its children (`/kumo/passwords`),
   so *every* Kumo sub-page read "Dashboard" — and the same bug hit other
   sections (the invoices list at `/billing` said "Finance Dashboard"). Match
   length is now compared and the longest wins. This is the **only** change to
   the global trail; if you want it byte-identical to before, revert that one
   function.
2. **Kumo got its own trail bar** with a back button. It returns through history
   when there is history (React Router's `history.state.idx > 0`) and otherwise
   follows the nearest parent in the trail, so a bookmarked deep link still has
   a way back. It drops the leading "Home" crumb, because the header already
   carries it.
3. **Kumo screens contribute what the navigation tree cannot know** — the client
   name, a record name, the selected type, the active filter — through
   `useBreadcrumbTrail` plus the `kumoTrail` / `kumoClientTrail` helpers. A
   screen's trail is withdrawn when it unmounts. Screens that register nothing
   (the Kumo dashboard, Organizations, Assets) fall back to the navigation
   tree's trail, so all nine Kumo screens have one.

Resulting trails:

| Screen | Header (global) | Kumo's own |
|---|---|---|
| `/kumo` | Home › Kumo › Dashboard | Kumo › Dashboard |
| `/kumo/organizations` | Home › Kumo › Organizations | Kumo › Organizations |
| `/kumo/organizations/:id` | Home › Kumo › Organizations | Kumo › Organizations › *client* |
| `…?type=<templateId>` | Home › Kumo › Organizations | … › *client* › *type name* |
| `…?type=locations` | Home › Kumo › Organizations | … › *client* › Locations |
| `/kumo/assets/:id` | Home › Kumo › Assets | Kumo › Assets › *asset name* |
| `/kumo/passwords?companyId=` | Home › Kumo › Passwords | Kumo › Organizations › *client* › Passwords |
| `/kumo/documents?filter=stale` | Home › Kumo › Documents | Kumo › Documents › Stale |
| `/kumo/domains?kind=Certificate` | Home › Kumo › Domains & Certs | Kumo › Organizations › *client* › Domains & Certs › Certificates |

## 1. Switch Kumo's trail off (instant, no rebuild)

```js
localStorage.setItem("c7_ui_kumo_crumbs", "0"); location.reload()
localStorage.removeItem("c7_ui_kumo_crumbs"); location.reload()   // back on
// or
setUiKumoBreadcrumbs(false)
```

Deployment-wide: `VITE_UI_KUMO_BREADCRUMBS=false` in `apps/web/.env.local`.

Off removes the Kumo trail bar and its back button. The global header trail is
unaffected either way.

## 2. Remove the code

- Delete `apps/web/src/components/KumoTrail.tsx` and the `<KumoTrail … />` line
  inside `<main>` in `apps/web/src/components/Layout.tsx` (plus its import).
- Remove the `BreadcrumbTrailProvider` wrapper and import in
  `apps/web/src/components/Layout.tsx`, then from
  `apps/web/src/components/Breadcrumbs.tsx` remove the trail context, the
  `useBreadcrumbTrail` / `useRegisteredTrail` hooks, the `kumoTrail` /
  `kumoClientTrail` helpers and the `TrailSegment` type.
- Remove the `useBreadcrumbTrail` calls and their imports from
  `KumoOrganizationDetail.tsx`, `KumoAssetDetail.tsx`, `KumoPasswords.tsx`,
  `KumoConfigs.tsx`, `KumoDocuments.tsx` and `KumoDomains.tsx`. Each is one call
  near the top of the component plus one import, so removing a call on its own
  is safe.
- `apps/web/src/lib/uiFlags.ts` — remove the `UI_KUMO_BREADCRUMBS` flag.
- To restore the global trail exactly as it was before any of this, revert
  `buildBreadcrumbs` in `Breadcrumbs.tsx` to first-match resolution.

Nothing here touches the API, the database or stored data, so there is no data
step to reverse.

## If the trail breaks the app

1. `localStorage.setItem("c7_ui_kumo_crumbs", "0"); location.reload()` — hides
   Kumo's trail bar, which is where a bad segment would show up.
2. Check the console for `Rendered fewer hooks than expected`: that means a
   `useBreadcrumbTrail` call was moved below an early `return` in a page. Every
   call site sits above its component's loading guards, because a hook must run
   on every render.
3. `git checkout apps/web/src/components/Breadcrumbs.tsx apps/web/src/components/KumoTrail.tsx apps/web/src/components/Layout.tsx`
   reverts both trails and the provider in one step.

## Notes for future changes

- Add a screen's dynamic crumbs with `useBreadcrumbTrail(...)`; do not render a
  third trail. The header shows the global one, Kumo shows its own.
- `useBreadcrumbTrail` must be called unconditionally, before any early return.
  Pass `null` while data is loading and the navigation tree's trail is used.
- Both trails render nothing when they have fewer than two segments, so `/home`
  and the section landing pages stay clean.
