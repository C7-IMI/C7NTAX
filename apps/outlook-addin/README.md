# C7NTAX — Outlook add-in (PLAN-012)

Create a C7NTAX ticket from the email you are reading, or from several selected at once, without
leaving Outlook. The pane converts each message into the same shape the monitored-mailbox connector
uses and posts it to `POST /api/outlook-addin/tickets`, so the two paths produce identical tickets
(same contact and client matching, same dedup key, same numbering).

## What is here

| File | What it is |
|---|---|
| `manifest.xml` | The add-in manifest: a `MessageReadCommandSurface` ribbon button that opens the taskpane. Served with its two placeholders resolved — see below, and do not edit them in place. |
| `taskpane.html` / `taskpane.js` | The pane: sign-in, board selector, selection summary, per-message results. |
| `commands.html` / `commands.js` | The function file Office requires. Deliberately behaviour-free — the button opens the pane rather than creating tickets blind. |
| `styles.css` | Minimal styling that reads on Outlook's light and dark themes. |
| `assets/icon-16.png`, `-32`, `-80` | Ribbon and manifest icons, derived from the app icon. |

The folder is served by the API at **`/addin`** on the same origin as `/api`, which is what lets the
pane call the API with relative URLs and no CORS. Turn it off with `OUTLOOK_ADDIN_ENABLED=false`
(the API routes are gated by the same flag).

## What is served, and what is not

`/addin/manifest.xml` is **generated, not a file**. The copy on disk holds two placeholders, and a
manifest carrying a placeholder is one Office rejects without explaining why — so asking a running
server for the manifest is the only way to get a usable one:

| Request | Answers with |
|---|---|
| `/addin/taskpane.html`, `/addin/commands.html`, `/addin/styles.css`, `/addin/assets/*` | the file on disk, as served by `express.static` |
| `/addin/manifest.xml` | the manifest with both placeholders resolved for that server's own origin |
| `/addin/installer` | JSON describing the Windows installer, if one has been built |
| `/addin/installer/<name>.msi` | the installer, or the versionless alias `C7NTAX-OutlookAddIn.msi` |

Because the manifest is generated, **do not edit `manifest.xml` to replace the placeholders in
place** — that would break the generation for every other deployment that shares the repository, and
the substitution would then be done twice.

| Placeholder | Resolved from | Meaning |
|---|---|---|
| `__ADDIN_HOST__` | `PUBLIC_BASE_URL`, else the request's own host | the origin serving this folder, e.g. `https://tax.cyber7group.com` |
| `__ADDIN_GUID__` | `OUTLOOK_ADDIN_GUID`, else a fixed default | the identity Office knows the add-in by |

The GUID is **fixed rather than generated**: Office treats a new GUID as a different add-in, so a
deployment that regenerated it would strand every mailbox that had already sideloaded the previous
one. Set `OUTLOOK_ADDIN_GUID` only to give a deployment its own identity deliberately.

Check the generated result at any time:

```powershell
(Invoke-WebRequest http://localhost:4000/addin/manifest.xml -UseBasicParsing).Content
```

The icons are fetched by Office over HTTPS from the same origin, so the add-in will not load if
`/addin/assets/*.png` is not reachable from the user's machine.

## Installing it

There are three routes, described in full in [the installer documentation](../../installer/README.md):
a per-user **Windows installer** (built from `installer/`), a **manual sideload**, and a
**centralized deployment** through the Microsoft 365 admin center. All three are offered, with the
downloads, from **C7NC → Outlook Add-in** in the application itself.

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
