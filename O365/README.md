# O365 — provisioning the Microsoft 365 app registration

Everything the C7NTAX Microsoft 365 email connector needs from a tenant, as a script instead of a
list of portal clicks.

Two things live in this folder:

| File | What it is |
|---|---|
| `New-C7NTAXMailboxApp.ps1` | Creates the Entra ID app registration, requests the Graph permissions, grants admin consent, creates the client secret, and prints the Exchange Online commands that scope the app to one mailbox. |
| `out/c7ntax-m365-app.json` | Written by the script: tenant id, client id, client secret, expiry. **Git-ignored, and contains a secret in clear text.** Delete it once the connector is configured. |

The reasoning behind all of it is [PLAN-017](../PlanDocs/PLAN-017-Microsoft-365-OAuth-App-Setup.md).
That document is the reference; this folder is the automation. Read §4 (app-only) or §5 (delegated)
for the why, and this README for the how.

## What the connector needs, and why

The connector is a mailbox watcher. It reads unread messages and marks them read once they have
become tickets — so it needs **`Mail.ReadWrite`**, not `Mail.Read`. `Mail.Read` is the mistake that
looks right: the app connects, reads mail, and then fails on the first message it tries to mark.

There are two shapes of identity, and they are not interchangeable:

| | App-only (Flow A) | Delegated (Flow B) |
|---|---|---|
| Who it acts as | the application, on a mailbox you name | the person who signed in |
| Credential | client secret | a refresh token, rotated on every use |
| Consent | a tenant administrator, once | the person, at sign-in (or an admin) |
| Blast radius | **every mailbox in the tenant** until §6 scoping is applied | one mailbox |
| Needs the app registration | yes | yes |
| Best for | an unattended `servicedesk@` mailbox | a person connecting their own mailbox |

App-only is what a service desk wants and is also the one that needs care: an unscoped app-only
token can read every mailbox in the tenant. PLAN-017 §6 is not optional, and the script prints the
commands for it but deliberately does not run them — they are Exchange Online cmdlets, not Graph.

## Prerequisites

| Need | Why |
|---|---|
| PowerShell 7 (`pwsh`) | the script uses `??`-free syntax but assumes 7.x behaviour; Windows PowerShell 5.1 will mostly work and is not tested |
| An account with **Application Administrator** or **Global Administrator** | creating an app registration and consenting to *application* permissions both require an admin role. A regular user cannot do either. |
| The Directory (tenant) ID, or a domain like `contoso.onmicrosoft.com` | Entra admin centre → **Overview → Directory (tenant) ID** |
| The mailbox to watch | for app-only |
| Outbound HTTPS to `login.microsoftonline.com` and `graph.microsoft.com` | no modules, no `az`, nothing to install — everything is REST |

There is **no module to install**. Authentication uses the OAuth device-code flow against
Microsoft's own Graph command-line client (`14d82eec-204b-4c2f-b7e8-296a70dab67e`), which is a
public client and is overridable with `-AuthClientId` if a tenant prefers its own.

## Running it

There is now a second way to run it: **C7NTAX → Administration → CloudConnect → Email Connectors → Deploy
OAuth app**. That wizard performs the same sequence through the API (device-code sign-in, create or
reuse the registration, consent, secret, the Exchange Online commands) and fills the connector's
form with the result, so nothing is copied out of this console. It can also take *this script's* output:
run the script, paste `out/c7ntax-m365-app.json` into the wizard, and it fills the same four fields.
Use whichever suits the tenant — the script remains the reference, and the one to read if you want to
see exactly what is being called.

Look before you leap — every Graph call is printed and nothing is called:

```powershell
pwsh -File ./New-C7NTAXMailboxApp.ps1 -TenantId contoso.onmicrosoft.com -WhatIf
```

Then, app-only, scoped to one mailbox:

```powershell
pwsh -File ./New-C7NTAXMailboxApp.ps1 -TenantId contoso.onmicrosoft.com `
  -DelegateMailbox servicedesk@contoso.com
```

Or delegated, for "Connect to Microsoft" — get the redirect URI from C7NTAX first (open the
connector and press **Connect to Microsoft**; the API answers with the exact URI):

```powershell
pwsh -File ./New-C7NTAXMailboxApp.ps1 -TenantId contoso.onmicrosoft.com -Mode Delegated `
  -RedirectUri https://psa.contoso.com/api/email-connectors/oauth/callback
```

Both flows on one registration:

```powershell
pwsh -File ./New-C7NTAXMailboxApp.ps1 -TenantId contoso.onmicrosoft.com -Mode Both `
  -RedirectUri https://psa.contoso.com/api/email-connectors/oauth/callback `
  -DelegateMailbox servicedesk@contoso.com
```

The script prints a code and a URL. Open the URL, enter the code, sign in as the administrator, and
approve. It then does the rest and prints what to paste into C7NTAX.

### Parameters worth knowing

| Parameter | Default | What it does |
|---|---|---|
| `-Mode` | `AppOnly` | `AppOnly`, `Delegated`, or `Both` |
| `-DisplayName` | `C7NTAX Email Connector` | the registration's name, and the key the script matches an existing one on. Change it and a second registration is created rather than reused. |
| `-RedirectUri` | the development URI | the Web redirect URI for the delegated flow. Must match what the API sends, exactly — Entra compares the whole string. |
| `-SecretMonths` | `12` | how long the client secret lasts. Entra allows up to 24. |
| `-PublicClient` | off | skip the secret entirely. Correct for delegated; impossible for app-only. |
| `-DelegateMailbox` | none | mailbox addresses to print Exchange Online scoping commands for. **Omitting it leaves the app able to read every mailbox in the tenant** — the script warns about this. |
| `-WhatIf` | off | print every call, make none |

It is safe to run twice. An existing registration with the same display name is reused, its
permissions are re-requested, and consent is re-asserted. The one thing it cannot do twice is show
you the same secret — a secret is only readable at the moment it is created, so a second run creates
(let `-SecretMonths` decide when) a further secret rather than returning the first one. If you lose
a secret, create a new one and remove the old one from **Certificates & secrets** afterwards.

## After it runs

1. **Paste the four values into C7NTAX** — Administration → CloudConnect → the Microsoft 365
   connector (PLAN-017 §7): Directory (tenant) ID, Application (client) ID, Client secret, and the
   mailbox to watch. The script prints them, and also writes them to `out/c7ntax-m365-app.json`.
2. **Scope the app to its mailbox** if you chose app-only. Run the Exchange Online commands the
   script printed (§6). Without them the app can read every mailbox in the tenant.
3. **Test connection** in the connector. For app-only expect
   `Connected to servicedesk@contoso.com — Inbox: N unread of M`.
4. **Poll now**, then send a real email to the watched mailbox and confirm a ticket appears on the
   chosen board within one poll interval.

Consent can take **30–60 minutes** to propagate to the mailbox layer. An `ErrorAccessDenied`
immediately after granting it is expected, not a misconfiguration — wait, and try again before
changing anything.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `AADSTS90002` | wrong tenant id or domain | copy the Directory (tenant) ID again; the script names this case explicitly |
| `Authorization_RequestDenied` when creating the app | the signed-in account is not an administrator | sign in as Application Administrator or Global Administrator. The script prints which account it got, because this is the usual cause. |
| `AADSTS7000222` in the connector | the client secret expired | run the script again to create a new secret, then update the connector. Diary the expiry 30 days ahead. |
| Connector says `Connected` but no tickets appear | mailbox is not the one being watched, or the folder differs | check the mailbox, and the folder, on the connector |
| `ErrorAccessDenied` right after consenting | propagation delay | wait 30–60 minutes |
| Script's device code expired | the browser step was not finished in time | run it again; nothing was changed |

## Honest status

The script's structure, its Graph endpoints, the permission GUIDs and the consent calls follow the
documented Microsoft Graph v1.0 contract and PLAN-017, and it has been **syntax-checked and run as
far as sign-in against a real tenant that does not exist** — which proves the request it builds is
well-formed (Microsoft answers `AADSTS90002: Tenant not found` rather than rejecting the call).
Everything past the device-code step — creating the registration, consenting, and creating the
secret — has **not** been executed, because doing so needs a tenant and an administrator account.
Run `-WhatIf` first, and treat the first real run as the test.
