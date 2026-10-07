# C7NTAX — Outlook add-in (PLAN-012)

Create a C7NTAX ticket from the email you are reading, or from several selected at once, without
leaving Outlook. The pane converts each message into the same shape the monitored-mailbox connector
uses and posts it to `POST /api/outlook-addin/tickets`, so the two paths produce identical tickets
(same contact and client matching, same dedup key, same numbering).

## The flow

| Selection | What the pane does |
|---|---|
| one message | asks whether to show the preview; creates the ticket |
| several messages | asks **One ticket each** or **Bundle into one ticket**, then which message the ticket is written from |
| Bundle into one ticket | one ticket built from the chosen message, with the others saved on it as `.eml` files anyone can open later |
| the preview | every field the server would fill in — board, client, contact, subject, description, priority — shown and editable before anything is submitted |

The preview is not a client-side guess. A client is matched from the sender's domain and a contact
from the sender's address, and the pane can see neither, so `POST /api/outlook-addin/preview` asks the
server what it *would* do, read-only, and also reports which messages already have a ticket. The
pane shows that on the row rather than letting it be discovered at the end. Anything edited in the
preview is applied rather than re-derived.

Both questions can be answered **remembered** (*Remember this answer*) and are then stored on the
`User` row, not in the pane's `localStorage` — which is scoped to the add-in's origin and so shared by
every C7NTAX account used on that machine. A **Preferences** screen is reachable from the pane header
and is the one place a saved answer can be seen and undone, because every saved answer works by making
a question stop appearing. With both answers saved, a later selection files with one click and no
sheet at all. Bundling is deliberately not rememberable: which message is the ticket changes per
conversation.

## The simulator (`?demo=1`)

`GET /addin/taskpane.html?demo=1` runs **this pane** against example messages and made-up answers:
the questions, the review and the result all behave as they do in Outlook, and nothing is created,
sent or saved. It is offered as **Administration → Configuration → Client Apps & Notifications →
Add-in simulator**, which opens it in a window sized like the pane.

It is the shipped pane rather than a second copy of the interface on purpose — a separate demo screen
drifts the moment the flow changes, and a demo that shows something the add-in does not do is worse
than none. The canned answers live behind `demoAnswer()` in `taskpane.js` and mirror what
`previewEmailFields` returns, because the pane reads those fields.

## What is here

| File | What it is |
|---|---|
| `manifest.xml` | The add-in manifest: a `MessageReadCommandSurface` ribbon button that opens the taskpane. Served with its three placeholders resolved — see below, and do not edit them in place. |
| `plugin.json` | The plugin's identity, version and **payload hash** — the record that makes "if the plugin changes, the installer must be rebuilt" enforceable. Maintained by `pnpm plugin:bump`; see [Versioning](#versioning). |
| `taskpane.html` / `taskpane.js` | The pane: sign-in, selection summary, the questions, the preview, per-message results, preferences — and the simulator (`?demo=1`). |
| `commands.html` / `commands.js` | The function file Office requires. Deliberately behaviour-free — the button opens the pane rather than creating tickets blind. |
| `styles.css` | Minimal styling that reads on Outlook's light and dark themes. |
| `assets/icon-16.png`, `-32`, `-80` | Ribbon and manifest icons, derived from the app icon. |

The folder is served by the API at **`/addin`** on the same origin as `/api`, which is what lets the
pane call the API with relative URLs and no CORS. Turn it off with `OUTLOOK_ADDIN_ENABLED=false`
(the API routes are gated by the same flag).

## What is served, and what is not

`/addin/manifest.xml` is **generated, not a file**. The copy on disk holds three placeholders, and a
manifest carrying a placeholder is one Office rejects without explaining why — so asking a running
server for the manifest is the only way to get a usable one:

| Request | Answers with |
|---|---|
| `/addin/taskpane.html`, `/addin/commands.html`, `/addin/styles.css`, `/addin/assets/*` | the file on disk, as served by `express.static` |
| `/addin/manifest.xml` | the manifest with all three placeholders resolved for that server's own origin and plugin version |
| `/addin/installer` | JSON describing the installer — the current build, the payload hash, whether it is stale, and every released version |
| `/addin/installer/<name>.msi` | the installer for a version named in the history, or the versionless alias `C7NTAX-OutlookAddIn.msi` |

Because the manifest is generated, **do not edit `manifest.xml` to replace the placeholders in
place** — that would break the generation for every other deployment that shares the repository, and
the substitution would then be done twice.

| Placeholder | Resolved from | Meaning |
|---|---|---|
| `__ADDIN_HOST__` | `PUBLIC_BASE_URL`, else the request's own host | the origin serving this folder, e.g. `https://tax.cyber7group.com` |
| `__ADDIN_GUID__` | `OUTLOOK_ADDIN_GUID`, else `plugin.json` | the identity Office knows the add-in by |
| `__ADDIN_VERSION__` | `plugin.json` | the four-field version Office reports, e.g. `26.10.7034.0` |

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
4. Sign in with a C7NTAX account that holds `ticket:create`. Answer the questions (or accept the
   preview), click **Create ticket**, and the pane lists the ticket it made — or says which messages
   already had one.

Multi-select works from the message list where the host supports it
(`getSelectedItemsAsync`, Mailbox 1.13+); on older hosts and for a single open message the pane uses
the message being read.

## Versioning

The plugin has its own version, `YY.M.PPPP`, derived from the release it shipped in
(`2026.10.7.034` → `26.10.7034`). It is the version Office reports, the version in the MSI filename,
and the version shown on **C7NC → Outlook Add-in** — all read from `plugin.json`, so they cannot
disagree.

One plugin version per application release: a change to any file in the payload inside a release must
advance the release, so the version stays monotonic.

```powershell
pnpm guard:plugin     # fail if the payload changed without a version, or the installer is stale
pnpm plugin:bump      # recompute the payload hash and take the version from the current release
pnpm installer:build  # rebuild the MSI for the current plugin version
```

The payload is every file the add-in runs — `manifest.xml`, the taskpane and commands files,
`styles.css` and the icons. `plugin.json` itself is deliberately not part of it: bumping the record
must not change the hash the record holds. `guard:plugin` and `build.ps1` both **refuse** rather than
produce an installer for an unversioned plugin — see
[the installer documentation](../../installer/README.md#the-plugin-version-and-the-installers).

## Verifying it

`cd apps/api && node probe-outlook-addin.mjs` exercises the whole flow against a running API:
the pane's files and the controls it renders, ticket creation and dedup, `/options` and its 403 for
an account that cannot create tickets, `/preview` naming the client and contact it resolved without
creating anything, reviewed fields winning over deduction, the bundled ticket with its `.eml`
attachments, and preferences round-tripping per user. It removes everything it made, including the
attachment files and the contacts.

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
