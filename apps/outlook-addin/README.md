# C7NTAX — Outlook add-in (PLAN-012)

Create a C7NTAX ticket from the email you are reading, or from several selected at once, without
leaving Outlook. The pane converts each message into the same shape the monitored-mailbox connector
uses and posts it to `POST /api/outlook-addin/tickets`, so the two paths produce identical tickets
(same contact and client matching, same dedup key, same numbering).

## What is here

| File | What it is |
|---|---|
| `manifest.xml` | The add-in manifest: a `MessageReadCommandSurface` ribbon button that opens the taskpane. Two placeholders must be replaced (below). |
| `taskpane.html` / `taskpane.js` | The pane: sign-in, board selector, selection summary, per-message results. |
| `commands.html` / `commands.js` | The function file Office requires. Deliberately behaviour-free — the button opens the pane rather than creating tickets blind. |
| `styles.css` | Minimal styling that reads on Outlook's light and dark themes. |
| `assets/icon-16.png`, `-32`, `-80` | Ribbon and manifest icons, derived from the app icon. |

The folder is served by the API at **`/addin`** on the same origin as `/api`, which is what lets the
pane call the API with relative URLs and no CORS. Turn it off with `OUTLOOK_ADDIN_ENABLED=false`
(the API routes are gated by the same flag).

## Before you sideload or submit

Replace two placeholders in `manifest.xml`:

| Placeholder | Value |
|---|---|
| `__ADDIN_HOST__` | The https origin serving this folder, e.g. `https://tax.cyber7group.com`. Production is the App Gateway hostname from PLAN-016. |
| `__ADDIN_GUID__` | A GUID you generate once and keep forever. Office identifies the add-in by it, so changing it later looks like a different add-in. |

A quick replace, from this folder:

```powershell
(Get-Content manifest.xml) `
  -replace '__ADDIN_HOST__', 'https://tax.cyber7group.com' `
  -replace '__ADDIN_GUID__', '11111111-2222-3333-4444-555555555555' |
  Set-Content manifest.xml
```

The icons are fetched by Office over HTTPS from the same origin, so the add-in will not load if
`/addin/assets/*.png` is not reachable from the user's machine.

## Sideload it (testing)

1. Run the API so the pane is served: `pnpm --filter @C7NTAX/api dev` (or the container).
2. Outlook on the web → **Get Add-ins → My add-ins → Add a custom add-in → Add from file** and
   choose `manifest.xml`. Desktop Outlook has the same option under **Get Add-ins → My add-ins**.
3. Open a message. The C7NTAX group appears in the ribbon; click **Create ticket**.
4. Sign in with a C7NTAX account that holds `ticket:create`. Pick the board, click **Create ticket**,
   and the pane lists the ticket it made — or says which messages already had one.

Multi-select works from the message list where the host supports it
(`getSelectedItemsAsync`, Mailbox 1.13+); on older hosts and for a single open message the pane uses
the message being read.

## What is not done yet (and why)

- **Microsoft SSO (the `POST /api/auth/office-sso` flow)** is not implemented. It needs the Entra app
  registration from PLAN-017 with the add-in's redirect URI and the `Mail.ReadWrite` scope consented;
  until then the pane uses the same credentials as the web app. Do not build the SSO path before the
  registration exists — it cannot be tested without it.
- **AppSource / Integrated Apps submission** needs a Microsoft Partner Center account and a
  verification process owned by the business, not by code. For an internal MSP deployment, the admin
  center's **Integrated Apps → Upload custom apps** path is enough and needs no review.
- **Writing back to the message** (a note saying which ticket was created) needs `ReadWriteItem`
  rather than `ReadItem`. Deliberately not requested: the add-in has no reason to modify the mailbox.
