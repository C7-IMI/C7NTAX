# PLAN-017 — Microsoft 365 OAuth App: Build & Deployment Plan

**Plan ID:** PLAN-017
**Title:** Microsoft 365 OAuth App: Build & Deployment Plan (app-only + delegated sign-in)
**Source:** authored in `PlanDocs/`
**Created:** 2026-10-06
**Status:** Ready to execute (connector code shipped — see BuildNotes 2026.10.6.050)
**Related:** PLAN-009 (Monitored Mailbox Email-to-Ticket Connector), PLAN-016 (Azure Dev/Prod Split)

---

## 1. Goal

Give the C7NTAX email connector a working, least-privilege Microsoft 365 identity so that
mail sent to a watched mailbox (for example `servicedesk@cyber7group.com`) is ingested and
raised as a service ticket automatically.

Two supported arrangements, both already implemented in the connector:

| | **A — App-only (client secret)** | **B — Delegated (“Connect to Microsoft”)** |
|---|---|---|
| Watches | A shared/role mailbox, nobody signed in | The mailbox of the account that consents |
| Permission | **Application** `Mail.ReadWrite` | **Delegated** `Mail.ReadWrite` + `User.Read` + `offline_access` |
| Blast radius | Whole tenant until scoped by Exchange RBAC | One mailbox |
| Consent | Tenant admin, once | A person signs in, once (refresh token kept) |
| Setup effort | Highest (app + permission + RBAC scoping) | Lowest (app + delegated permission + redirect URI) |
| Recommended for | `servicedesk@`-style watcher mailboxes | A technician’s own mailbox / proofs of concept |

Microsoft has **disabled Basic authentication for Exchange Online in every tenant**, so
IMAP- or EWS-with-password cannot read a Microsoft 365 mailbox. OAuth is not optional.

---

## 2. What the connector needs from Microsoft (contract)

Implemented in `packages/email/src/graphFetch.ts`; the plan exists to satisfy this contract.

| Endpoint | Purpose |
|---|---|
| `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` | `client_credentials` (A) or `authorization_code` / `refresh_token` (B) |
| `GET  https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize` | Consent screen (B only) |
| `GET  /users/{mailbox}/mailFolders/{folder}` | Connection test: folder counts |
| `GET  /users/{mailbox}/mailFolders/{folder}/messages?$filter=isRead eq false` | Unread mail, oldest first |
| `GET  /users/{mailbox}/messages/{id}/attachments` | Inbound attachments |
| `PATCH /users/{mailbox}/messages/{id}` `{"isRead":true}` | Mark processed (needs **write**, hence `Mail.ReadWrite` not `Mail.Read`) |
| `GET  /me` | Record which account a delegated connector is signed in as |

Connector fields (CloudConnect → Email Connectors → *Microsoft 365 / Exchange Online*):
tenant id, client id, client secret (A) or the Connect button (B), mailbox to watch (A),
folder, poll interval. Nothing is contacted until **Test connection** succeeds, and a
connector is created **disabled** on purpose.

**Dependency order for everything below:** §3 (roles) → §4 or §5 (the app) → §6 (scope, A
only) → §7 (configure + verify) → §8 (deployment) → §9 (operations).
**Risk if skipped:** an app without consented permission returns `403 ErrorAccessDenied`; an
unscoped app-only app can read **every** mailbox in the tenant; a missing redirect URI fails
the delegated flow with `AADSTS500113`.

---

## 3. Prerequisites

| Item | Detail |
|---|---|
| Entra role | *Application Administrator* (or *Cloud Application Administrator*) to create the app and grant consent |
| Exchange role | *Exchange Administrator* for the RBAC-for-Applications scoping (flow A, §6) |
| Tenant id | Entra admin centre → **Overview → Directory (tenant) ID**, or the primary domain (`contoso.onmicrosoft.com`) |
| Mailbox | Licenced, mailbox-enabled; flow A needs a shared mailbox or a user mailbox nobody signs into |
| Tools (optional) | `az` CLI or Microsoft Graph PowerShell (`Install-Module Microsoft.Graph`), and Exchange Online PowerShell (`Connect-ExchangeOnline`) for §6 |
| Environments | **One app registration per environment** (dev, staging, prod). Never share secrets or redirect URIs across environments |

---

## 4. Flow A — App-only identity (unattended watcher mailbox)

### A1. Create the app registration
Portal: Entra admin centre → **App registrations → New registration** → name
`C7NTAX Email Connector (prod)` → *Accounts in this organizational directory only* →
**Register**. Record **Application (client) ID** and **Directory (tenant) ID**.

CLI equivalent:
```bash
az ad app create --display-name "C7NTAX Email Connector (prod)" --sign-in-audience AzureADMyOrg
az ad app list --display-name "C7NTAX Email Connector (prod)" --query "[0].{appId:appId,objectId:id}" -o table
```

### A2. Grant the application permission and consent
Portal: **API permissions → Add a permission → Microsoft Graph → Application permissions →
`Mail.ReadWrite`** → **Add** → **Grant admin consent for <tenant>** (status must show a green
*Granted*).

```bash
APP_ID=<application-client-id>
GRAPH=00000003-0000-0000-c000-000000000000
ROLE=$(az ad sp show --id $GRAPH --query "appRoles[?value=='Mail.ReadWrite'].id" -o tsv)
az ad app permission add --id $APP_ID --api $GRAPH --api-permissions $ROLE=Role
az ad app permission admin-consent --id $APP_ID
# verify: az ad app permission list --id $APP_ID
```
`Mail.Read` is deliberately **not** enough: marking a message processed needs `Mail.ReadWrite`.

### A3. Create the credential
Portal: **Certificates & secrets → Client secrets → New client secret** → note the expiry and
copy the **Value** immediately (it is never shown again). The connector stores it encrypted
(kumoCrypto) and never returns it to the browser.

**Prefer a certificate in production** where possible (no shared secret to leak, easier
rotation, no 24-month cliff). A certificate is supported by adding it to the app and using a
client assertion; the connector’s secret field is the shorter path and can be replaced later
without any UI change.

Secret hygiene:
- One secret per environment; name it with its expiry (`prod-2026-10`).
- Diary the expiry 30 days ahead. A dead secret surfaces in the connector as
  `AADSTS7000222: The provided client secret keys are expired`.
- Rotate by adding a second secret, updating the connector, then removing the old one (zero downtime).

### A4. (Optional) Restrict the app to the API surface it needs
If the tenant blocks broad Graph application permissions, request `Mail.ReadWrite` as a
specific resource-scoped permission instead (Exchange Online’s own app id
`00000002-0000-0ff1-ce00-000000000000`) — same result, narrower grant.

### A5. Scope the app to the one mailbox — **do not skip**
Without §6 the app can read every mailbox in the tenant. See §6.

---

## 5. Flow B — Delegated “Connect to Microsoft” (a person’s mailbox)

### B1. Create the app registration
As A1 (any name; it can be the same app as A if you want both flows).

### B2. Add the **delegated** permissions
**API permissions → Microsoft Graph → Delegated permissions** → add
`Mail.ReadWrite`, `User.Read`, and `offline_access` → **Grant admin consent** (consent can
also be granted by the person during sign-in if your tenant allows user consent).

### B3. Add the redirect URI — it must match exactly
In C7NTAX press **Connect to Microsoft** once; the dialog/response prints the exact URI to
paste (the API returns it in the `note` field). Format:

```
<API public URL>/api/email-connectors/oauth/callback      e.g. https://psa.example.com/api/email-connectors/oauth/callback
http://localhost:4000/api/email-connectors/oauth/callback (development)
```

Entra: **Authentication → Add a platform → Web → Redirect URIs** (a *Web* platform, not SPA —
the API exchanges the code server-side) → paste → **Configure**.
Override the derived URL with `EMAIL_OAUTH_REDIRECT_URI` when the API is behind a proxy, and
`API_PUBLIC_URL` when the public origin differs from the request host.

### B4. Client secret: optional here
- **Public client** (no secret): leave the connector’s *Client secret* field empty. The flow
  is protected by PKCE (S256 verifier + state). Nothing else is required.
- **Confidential client**: store a secret as in A3 and paste it; it is sent with the code and
  refresh grants.

### B5. Connect, and know the token lifecycle
Press the link button → sign in → consent. What happens afterwards:

- The **refresh token is stored encrypted** and **rotated on every use** (Microsoft
  invalidates the old one), together with the account UPN and the granted scopes.
- Access tokens are cached in memory and refreshed one minute early.
- A revoked/expired consent (password change, admin revocation, 90 days idle, conditional
  access change) surfaces as:
  `Microsoft sign-in has expired or was revoked — reconnect the connector.`
  → press the link button again. No other action is needed; no mail is lost (messages stay
  unread and are retried).
- The mailbox read is `user` (set to the signed-in account on connect). To watch **someone
  else’s** mailbox with a delegated token the signed-in account needs Full Access (delegate)
  on it — in practice use flow A for shared mailboxes.

---

## 6. Scope an app-only app to one mailbox (Exchange Online RBAC for Applications)

This is the successor to Application Access Policies and takes effect within ~30 minutes
(sometimes up to an hour — Microsoft’s own caveat).

```powershell
Connect-ExchangeOnline

# 1. Create the service principal object for the app inside Exchange Online (once)
#    -AppId is the Entra Application (client) ID, -ObjectId is the app's service principal object id
New-ServicePrincipal -AppId <application-client-id> -ObjectId <service-principal-object-id> `
                    -DisplayName "C7NTAX Email Connector"

# 2. Create a scope bound to the one mailbox
New-ManagementScope -Name "C7NTAX-ServiceDesk-Mailbox" `
                    -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'servicedesk@cyber7group.com'"

# 3. Assign the mailbox-role to the app, restricted to that scope
New-ManagementRoleAssignment -Name "C7NTAX-MailReadWrite-ServiceDesk" `
                             -App "C7NTAX Email Connector" -Role "Application Mail.ReadWrite" `
                             -CustomResourceScope "C7NTAX-ServiceDesk-Mailbox"
```

Verify:
```powershell
Test-ServicePrincipalAuthorization -Identity "C7NTAX Email Connector" -Resource servicedesk@cyber7group.com
Test-ServicePrincipalAuthorization -Identity "C7NTAX Email Connector" -Resource someone.else@cyber7group.com  # expect denied
```
Both lines matter: the first proves access, the second proves it is **scoped** and not
tenant-wide.

Cleanup/rollback: `Remove-ManagementRoleAssignment`, `Remove-ManagementScope`,
`Remove-ServicePrincipal`, then delete the app registration.

> On-premises Exchange (`transport = ews` or `imap`): Graph/RBAC does not apply. Enable Basic
> authentication on the EWS/IMAP virtual directory for that one account, grant it a mailbox
> (or Full Access on a shared mailbox), and set `EWS_ENDPOINT` / `EMAIL_IMAP_ALLOW_SELF_SIGNED`
> if the server is behind a self-signed certificate. This is the *only* place Basic auth is
> still used, and only on-premises.

---

## 7. Configure and verify in C7NTAX

| Field | Flow A | Flow B |
|---|---|---|
| Transport | Microsoft 365 / Exchange Online | same |
| Sign-in | App-only (client secret) | Connect to Microsoft (delegated) |
| Directory (tenant) ID | required | required |
| Application (client) ID | required | required |
| Client secret | required | optional (public client: empty) |
| Mailbox to watch | `servicedesk@cyber7group.com` | hidden — the signed-in account is used |
| Folder | `Inbox` (or a subfolder) | same |
| Poll interval | ≥ 30s (default 300) | same |

Then:
1. **Test connection** → expect
   `Connected to servicedesk@cyber7group.com — Inbox: N unread of M` (flow A) or
   `Connected to signed in as … — Inbox: N unread of M` (flow B).
2. **Poll now** (after switching the connector to *Watching*) → a ticket appears on the chosen
   board with source `email`, the body text, and any attachment.
3. Send a real email to the watched mailbox → confirm the ticket within one poll interval.
4. Reply to the ticket notification email → the reply is appended to the same ticket (the
   `[<ticketNumber>]` tag in the subject is what threads it).

### Troubleshooting matrix

| Symptom | Cause | Fix |
|---|---|---|
| `AADSTS700016: Application … not found in the directory` | Wrong tenant id, or the app belongs to another tenant | Re-copy the Directory (tenant) ID |
| `AADSTS7000215: Invalid client secret` | Secret value vs secret *id*; expired secret | Copy the **Value**; create a new secret |
| `AADSTS65001: … consent` | Admin consent never granted | Grant admin consent (§A2 / §B2) |
| `ErrorAccessDenied` (403) | Application permission missing, or RBAC scope not applied yet | §A2 + §6, then wait 30–60 min |
| `ErrorInvalidUser` / 404 on `/users/{mailbox}` | Mailbox UPN wrong or unlicensed | Check the address; `Get-Mailbox <name>` |
| `401 InvalidAuthenticationToken` | Token for the wrong resource/tenant | Verify the tenant id matches the app |
| HTTP 429 throttled | Graph fair-use limits | The connector reads `Retry-After` and backs off automatically; raise the poll interval |
| Delegated: “sign-in has expired or was revoked” | Consent revoked, password changed, 90 days idle | Press **Connect to Microsoft** again |
| `AADSTS500113: No reply address registered` | Redirect URI not on the app | Paste the exact URI the panel shows (§B3) |
| `AADSTS50011: redirect URI mismatch` | Trailing slash / http vs https / wrong environment | Make them byte-identical |

---

## 8. Deployment

| Step | Dev | Prod |
|---|---|---|
| App registration | `C7NTAX Email Connector (dev)` | `C7NTAX Email Connector (prod)` |
| Secret | dev secret (rotate freely) | prod secret, expiry diarised |
| Redirect URI | `http://localhost:4000/api/email-connectors/oauth/callback` | `https://<api-host>/api/email-connectors/oauth/callback` |
| Tenant ids | dev tenant (or same tenant, separate app) | production tenant |
| Mailbox | test mailbox | `servicedesk@…` (or the client’s monitored mailbox) |
| RBAC scope | optional in dev | mandatory, one scope per mailbox |
| Connector rows | created disabled → tested → enabled | same, in a change window |

Environment variables the API understands (all optional, all default to Microsoft’s real
endpoints):

```
GRAPH_API_BASE=https://graph.microsoft.com/v1.0     # override only for tests/stubs
GRAPH_TOKEN_BASE=https://login.microsoftonline.com   # override only for tests/stubs
EMAIL_OAUTH_REDIRECT_URI=                            # set when behind a proxy
API_PUBLIC_URL=                                      # public API origin used to build the redirect
WEB_ORIGIN=                                          # where the OAuth callback lands the browser
EMAIL_CONNECTORS_ENABLED=true                        # false disables all polling
EMAIL_CONNECTORS_CLOUD_ENABLED=true                  # false disables graph/ews pollers only
EMAIL_EWS_MAX_MESSAGES=25                            # per-poll cap
EWS_ENDPOINT=                                        # on-premises EWS URL override
EWS_ALLOW_SELF_SIGNED=true                           # on-premises self-signed certificate only
```

**Rollback** (any step): switch the connector to *Off* (mail stops being read, nothing is
deleted), then optionally remove the RBAC role assignment/scope, then delete the app
registration. Deleting the app does **not** delete tickets already created.

---

## 9. Operations

- **Health**: the connector card shows *Watching/Off*, last poll time, processed count, and the
  last error with a timestamp. `GET /api/email-connectors` returns the same for monitoring.
- **Secret expiry**: diarise; the failure is loud (`AADSTS7000222`) and lands on the card.
- **Permission drift**: if an admin removes consent, flow A fails with `ErrorAccessDenied` and
  flow B says *reconnect* — both are surfaced, never silent.
- **Scope creep check**: after any change, re-run the two `Test-ServicePrincipalAuthorization`
  lines from §6 to prove the app still cannot read anything but the watched mailbox.
- **Audit**: every connector mutation and every ingested message is in the audit trail /
  ticket history; secrets are never returned by the API.

---

## 10. Acceptance criteria

- [ ] Test connection succeeds for the watched mailbox and names it.
- [ ] An email to the mailbox raises exactly one ticket on the configured board, with body text
      and attachments, inside one poll interval.
- [ ] The message is marked read **only** after the ticket exists; a failure leaves it unread
      and the next poll retries it.
- [ ] A reply quoting the ticket number appends to the ticket instead of creating a second one.
- [ ] `Test-ServicePrincipalAuthorization` grants the watcher mailbox and denies another.
- [ ] Disabling the connector stops ingestion; deleting it leaves no state rows or files behind.
- [ ] No secret, refresh token or client secret is ever present in an API response.

---

## 11. References

- Deprecation of Basic authentication in Exchange Online — Microsoft Learn
- Role Based Access Control for Applications in Exchange Online — Microsoft Learn
- Service principals (`New-ServicePrincipal`, `Test-ServicePrincipalAuthorization`) — Exchange Online PowerShell
- Microsoft identity platform: authorization code flow + PKCE; client credentials flow — Microsoft Learn
- `user: list messages`, `message: get attachments`, `message: update`, `user: get` — Microsoft Graph v1.0
- Microsoft Graph throttling limits — Microsoft Learn
- Connector implementation: `packages/email/src/graphFetch.ts`, `packages/email/src/ewsFetch.ts`,
  `apps/api/src/services/emailConnectorRuntime.ts`, `apps/api/src/routes/email-connectors.ts`
- Prior plan: `PLAN-009-Email-to-Ticket-Connector.md`
