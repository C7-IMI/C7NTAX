import type { ConnectorSetup } from "./connectorSetupTypes";

/**
 * What it takes to actually get each connector running, in the order it has to happen.
 *
 * The catalogue next door (`CONNECTOR_SPECS`) says which fields a connector has and what each one
 * means. That is enough to fill a form and not enough to finish the job: every one of these
 * integrations needs something to exist in the vendor's product first — an API member, a registered
 * application, a service account with the right role, a token minted in the right place — and the
 * order matters, because a missing prerequisite shows up as a rejected credential rather than as a
 * missing one.
 *
 * These plans are what the setup wizard walks through, and they are deliberately data rather than
 * screen code: the same plan drives the wizard's steps, the probe that checks nothing dangles, and
 * the answer to "what do I need before I start?" on the connector's page. Field keys are references —
 * they name credentials in `CONNECTOR_SPECS`, and a probe asserts that every one of them exists, so a
 * plan cannot quietly describe a field the form does not have.
 *
 * Facts, host names, permission names and menu paths were written against each vendor's own
 * documentation during the connector audit (BuildNotes 2026.10.8.013 onwards).
 */
export const CONNECTOR_SETUP: Record<string, ConnectorSetup> = {
  microsoft365: {
    overview:
      "Reads the users, groups, licences and sign-in activity of one Microsoft 365 tenant through Microsoft Graph. It is read-only against your tenant: nothing is ever written back, and no mail is read — that is what an email connector is for.",
    prerequisites: [
      { title: "An Entra ID tenant you can administer", detail: "You need to be able to create an app registration and grant it admin consent, so you will be signed in as an Application Administrator or Global Administrator." },
      { title: "Entra ID P1, for the sign-in column", detail: "Reading last sign-in activity needs Entra ID P1 and the AuditLog.Read.All permission. Without them the rest of the sync still runs and every account reports as unknown, never as dormant.", link: "https://learn.microsoft.com/en-us/graph/api/user-list-signins" },
      { title: "The wizard's other half", detail: "The mailbox connector on the Email connectors tab has its own Deploy OAuth app wizard. This one needs the read permissions below instead of Mail.ReadWrite, so use this walkthrough for tenant data." },
    ],
    credentialGroups: [
      { title: "Where the tenant is", note: "Both of these come from the same Entra screen, which is why they are collected together.", fields: ["tenantId"] },
      { title: "The application that will read it", note: "An app registration is the identity C7NTAX uses. Create it once per tenant, with the permissions below, and reuse it for both connections if you have already deployed it.", fields: ["clientId", "clientSecret"] },
    ],
    settingsNote:
      "The switches decide which collections are read. Turning one off leaves the records it brought in alone rather than deleting them, so it is safe to narrow a sync after the first run.",
    firstSync: {
      title: "Sync now reads the tenant",
      detail: "The first run walks the users, groups, licences and (if the tenant can answer) sign-in activity, and creates or matches a C7NTAX contact for each user whose mail address is already known here. A tenant of a few hundred accounts takes seconds; a large one with sign-in activity takes a minute or two.",
    },
    nextSteps: [
      "Check Contacts afterwards: a user with no email address cannot be matched to a client and is left as a tenant record rather than guessed at.",
      "Diarise the client secret's expiry — Entra shows it once when it is created, and the connector stops answering the day it lapses.",
      "If a client's accounts look wrong, the Inactive Microsoft 365 Accounts report under Reporting reads the same data with your own threshold.",
    ],
  },

  connectwise: {
    overview:
      "Reads tickets, contacts, companies and projects from one ConnectWise PSA tenant. It is a reader: nothing is written back into ConnectWise, and no time entries or configurations are changed.",
    prerequisites: [
      { title: "A ConnectWise client id", detail: "Apply for one through the ClientID Access Request Form at developer.connectwise.com — the vendor issues it after review, which can take a few days. Every call is rejected without it, even with a valid key pair.", link: "https://developer.connectwise.com/ClientID" },
      { title: "An API member with its own key pair", detail: "In ConnectWise: System → Members → API Members, create the member, then API Keys on that member to generate the public and private key. The member's security role decides what C7NTAX can read." },
      { title: "The region and codebase", detail: "api-na, api-eu or api-au for the host, and the codebase from the address you sign in to (v4_6_release, or a dated one like v2024_1). The company identifier is the one on your My Company screen." },
    ],
    credentialGroups: [
      { title: "Which tenant", note: "The codebase travels in the credential, not the hostname, which is why the base URL only names the region and release.", fields: ["baseUrl", "companyId"] },
      { title: "The key pair", note: "The API member's username is companyId + publicKey; that pair and the private key build the Basic header.", fields: ["publicKey", "privateKey"] },
      { title: "The client id", note: "Issued to you, not to the tenant. It is sent on every request and is the usual reason a first call fails with a generic 400.", fields: ["clientId"] },
    ],
    settingsNote:
      "Page size controls how many records are read per request. ConnectWise defaults to 25; 200 is a reasonable middle, and the page cap stops one sync from walking a very large collection forever.",
    firstSync: {
      title: "Sync now fetches the collections",
      detail: "The first run reads tickets, companies, contacts and projects, page by page, and stores each record against the connection. Tickets usually arrive first and companies take longest, because everything references them.",
    },
    nextSteps: [
      "Watch the sync log after the first run: a permissions problem shows up as one collection failing while the rest succeed, which the log names.",
      "The API member's role is the ceiling on what C7NTAX sees — grant it the least it needs.",
    ],
  },

  halopsa: {
    overview:
      "Reads tickets, clients, assets and contracts from one HaloPSA instance. Halo's API is driven by an API application with its own permissions, so the ceiling on what C7NTAX sees is that application's permission tab.",
    prerequisites: [
      { title: "An API application in Halo", detail: "Configuration → Integrations → Halo API → Authorise a new application → Client Credentials. Give it only the permissions you want C7NTAX to use; the scope below requests them.", link: "https://halopsa.com/apidoc/" },
      { title: "The address you sign in to", detail: "The API lives under it at /api, so the tenant URL must not include /api itself." },
      { title: "Hosted or on-premise, for the token", detail: "Hosted tenants are issued tokens by Halo's auth host; on-premise installs use the tenant's own /auth/token. C7NTAX tries both, and the override is there for the installs where neither guess is right." },
    ],
    credentialGroups: [
      { title: "Which Halo", note: "The address first, so the token request knows where to go.", fields: ["tenantUrl"] },
      { title: "The API application", note: "Both values are shown when the application is authorised in Halo.", fields: ["clientId", "clientSecret"] },
      { title: "Only if the token request needs help", note: "Leave these empty unless the connection test reports that it could not authenticate — the usual symptom of an on-premise install with a non-standard auth host.", fields: ["scope", "tokenUrl"] },
    ],
    settingsNote: "Paging in Halo is page_no/page_size; the page cap decides how far one sync walks a collection.",
    firstSync: {
      title: "Sync now reads the collections",
      detail: "Tickets, clients, assets and contracts arrive page by page. The API user's agent permissions apply, so a narrowly-scoped API application legitimately returns less than the whole instance.",
    },
    nextSteps: [
      "If a collection comes back empty while another does not, check the API application's permissions before the credentials.",
      "The token URL override is the fix for an on-premise install that authenticates somewhere Halo's hosted tenants do not.",
    ],
  },

  autotask: {
    overview:
      "Reads tickets, companies, contacts and resources from one AutoTask zone. AutoTask authenticates with an API user rather than an API key, and every request carries an integration code that names this application in their API logs.",
    prerequisites: [
      { title: "An API user", detail: "In AutoTask: Admin → Resources (API Users), create a user with the integration code and a password. The user's security level decides what C7NTAX can read.", link: "https://ww4.autotask.net/help/DeveloperHelp/Content/APIs/REST/REST_API_Home.htm" },
      { title: "The zone your tenant lives in", detail: "AutoTask tenants are served by different hosts — webservices5.autotask.net is a common one but not everybody's. Using the wrong zone fails in a way that looks like a wrong password.", link: "https://www.autotask.net/help/Content/AdminSetup/ApiIntegration/Api_Terms.htm" },
    ],
    credentialGroups: [
      { title: "The API user", note: "The username and password of the API user you created, not of a person.", fields: ["username", "password"] },
      { title: "What identifies this application", note: "The integration code is issued when the API user is created and is recorded in AutoTask's API usage reports.", fields: ["integrationCode"] },
      { title: "Where the tenant is", note: "Leave the zone empty for the North American production host.", fields: ["zone"] },
    ],
    settingsNote: "The record limit and page cap bound a sync: AutoTask's own maximum page size is subject to the tenant's API limits.",
    firstSync: {
      title: "Sync now reads the entities",
      detail: "Tickets, companies, contacts and resources are fetched with the API user's permissions. AutoTask rate-limits API users per hour, so a very large tenant benefits from the page cap rather than from a bigger page size.",
    },
    nextSteps: [
      "If the first test says the credentials are wrong, check the zone before the password: that is the usual cause.",
      "The API user's hourly quota is shared with anything else using the same user — a dedicated one per integration is worth the minute it takes.",
    ],
  },

  kantata: {
    overview:
      "Reads projects, tasks and time from one Kantata (formerly Mavenlink) workspace. Kantata issues access tokens through OAuth rather than API keys, which is why this connector holds a token rather than a key pair.",
    prerequisites: [
      { title: "A token, minted in Kantata", detail: "Kantata's API is reached with an OAuth 2.0 access token: the simplest path is a personal access token from your account's API settings, and the documented path is the OAuth authorisation flow.", link: "https://developer.kantata.com/" },
      { title: "Awareness that it expires", detail: "Tokens are short-lived. When the connection test starts failing with a 401, that is what has happened — mint a new token and run this wizard again; nothing else about the connection has changed." },
    ],
    credentialGroups: [
      { title: "The access token", note: "Pasted as-is. It is held on the server and attached to every call; it is never sent to a browser.", fields: ["accessToken"] },
    ],
    settingsNote: "The page cap decides how far a sync walks each collection.",
    firstSync: {
      title: "Sync now reads the workspace",
      detail: "Projects, tasks and time entries are fetched. Kantata returns them relative to the account the token belongs to, so a token belonging to a project manager may legitimately see less than an administrator's.",
    },
    nextSteps: [
      "Diarise the token expiry: Kantata does not warn you, and the connection simply starts failing.",
      "Keep the reference in the connector's guidance to hand — minting the replacement token is the whole repair.",
    ],
  },

  scoro: {
    overview:
      "Reads clients, projects, invoices and time entries from one Scoro site. Scoro is addressed by its site subdomain, so the connector needs both where the site is and which company account it belongs to.",
    prerequisites: [
      { title: "An API key", detail: "In Scoro: Settings → Integrations → API, generate a key for the user whose visibility you want C7NTAX to have.", link: "https://api.scoro.com/api/v2" },
      { title: "The company account id", detail: "Scoro's API is scoped by company account; the id is on the same settings screen.", link: "https://api.scoro.com/api/v2#intro" },
    ],
    credentialGroups: [
      { title: "Which site", note: "The subdomain you sign in to, without https:// and without a path.", fields: ["site"] },
      { title: "The key and its scope", note: "The key belongs to a Scoro user, and that user's permissions decide what the API returns.", fields: ["apiKey", "companyAccountId"] },
    ],
    settingsNote: "Per-page and page-cap control how much of each collection one sync reads.",
    firstSync: {
      title: "Sync now reads the site",
      detail: "Clients, projects, invoices and time entries are fetched page by page and stored against the connection.",
    },
    nextSteps: [
      "A key belonging to the wrong user is the usual reason a collection comes back empty.",
    ],
  },

  flexpoint: {
    overview:
      "Reads customers, invoices and settled payments from FlexPoint, and lets invoices this application raises be matched against the payments that settle them. FlexPoint has a service of its own here, so it does more than store records: it links customers to clients and can record payments.",
    prerequisites: [
      { title: "An API secret from FlexPoint", detail: "FlexPoint issues API credentials per account; the secret is what this connection holds.", link: "https://www.getflexpoint.com/" },
      { title: "Which environment", detail: "Production and sandbox have separate secrets and separate addresses. Test against the one you intend to keep using, because the records that arrive are kept.", },
    ],
    credentialGroups: [
      { title: "The credential", note: "Held on the server and attached to every call; it is never returned to a browser.", fields: ["apiSecret"] },
      { title: "The address, if it is not the standard one", note: "Leave it empty unless FlexPoint has told you to use a different host — a sandbox, or a private deployment.", fields: ["baseUrl"] },
    ],
    settingsNote:
      "The switches decide which of the three record types are read. Customers have to be read before invoices can be linked to a client, so turning customers off leaves invoices unlinked rather than wrong.",
    firstSync: {
      title: "Sync now reads, and links",
      detail: "Customers, invoices and deposits are read and then linked to C7NTAX clients by name and domain. Unlinked customers are kept and reported rather than being dropped, so a naming difference is visible instead of silent.",
    },
    nextSteps: [
      "Check the unlinked customers after the first sync and map them by hand: a wrong link is worse than no link.",
      "Once invoices are arriving, the normal test works end to end — approve an expense and confirm it reaches FlexPoint and comes back settled.",
    ],
  },

  quickbooks: {
    overview:
      "Reads customers and pushes approved invoices and expenses into one QuickBooks Online company. It is the one connector here that writes: the accounting system owns the invoice, and this application hands it over rather than keeping a second copy.",
    prerequisites: [
      { title: "An Intuit developer app", detail: "Create one at developer.intuit.com, add a redirect URI, and note the client id and secret. The app's environment (production or sandbox) must match the keys you were given.", link: "https://developer.intuit.com/app/developer/dashboard" },
      { title: "A refresh token for the company", detail: "Access tokens last an hour, so the refresh token is the credential that matters. The Intuit OAuth playground is the quickest way to mint one for the company you are connecting.", link: "https://developer.intuit.com/app/developer/playground" },
      { title: "The realm (company) id", detail: "Shown by the same playground, and in the company's own QuickBooks URL.", link: "https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization" },
    ],
    credentialGroups: [
      { title: "The app", note: "Both values come from the app you created, and the environment setting below has to agree with them.", fields: ["clientId", "clientSecret"] },
      { title: "The company", note: "The realm id names the company; the refresh token is exchanged for an access token at the Intuit OAuth host rather than at the API host, which is why a connection holding only an access token works once and then reports itself broken.", fields: ["refreshToken", "realmId"] },
    ],
    settingsNote:
      "The environment decides whether calls go to production or to sandbox, and the record limit bounds how much is read per sync. A production app cannot talk to sandbox data — the mismatch returns a generic authorisation error.",
    firstSync: {
      title: "Sync now reads customers",
      detail: "Customers are read and matched to C7NTAX clients. Nothing is written: invoices leave this application when a person approves one, and the sync is what brings the customer list back.",
    },
    nextSteps: [
      "Approve one invoice and watch it in QuickBooks: the round trip is the real test, not the connection light.",
      "Diarise the refresh token's own expiry — Intuit's refresh tokens last months, not hours, and expire silently when the app is left unused.",
    ],
  },

  pax8: {
    overview:
      "Reads customers, subscriptions and their usage from Pax8, so licences and recurring revenue can be seen beside the clients they belong to.",
    prerequisites: [
      { title: "Pax8 API credentials", detail: "In the Pax8 portal: Integrations → API credentials, create a client id and secret. Pax8 uses the OAuth client-credentials grant, so there is no per-user token to collect.", link: "https://docs.pax8.com/" },
      { title: "A partner account that can see the estate", detail: "The credentials are issued to a partner, not to a customer, so C7NTAX reads the whole estate the partner can see and decides what belongs to whom. A sub-account's own credentials read only that sub-account.", link: "https://docs.pax8.com/api-docs" },
      { title: "A note of the company mapping", detail: "Pax8 names companies its own way. The first sync stores what it reads; matching those names to C7NTAX clients is the step that makes the data useful, and it is easier with the list in front of you." },
    ],
    credentialGroups: [
      { title: "The API client", note: "Both values are generated together in the Pax8 portal and are shown once.", fields: ["clientId", "clientSecret"] },
    ],
    settingsNote: "Page size and the page cap decide how much of each collection one sync reads.",
    firstSync: {
      title: "Sync now reads the partner estate",
      detail: "Customers, subscriptions and usage arrive page by page and are stored against the connection, so licence counts can be reconciled against what a client is billed for.",
    },
    nextSteps: [
      "The client id and secret are not per-customer: Pax8 returns the whole partner estate, and C7NTAX decides what belongs to whom.",
    ],
  },

  avanan: {
    overview:
      "Reads the email security posture and incidents of one Check Point Harmony Email (Avanan) tenant: what was quarantined, what was allowed, and what the tenant's policy is doing.",
    prerequisites: [
      { title: "API credentials from the tenant", detail: "In the Harmony Email & Collaboration portal: Settings → API credentials, create an application id and secret.", link: "https://support.checkpoint.com/results/sk/sk180723" },
      { title: "The region the tenant lives in", detail: "US or EU. The region decides which host is called, and the wrong one answers with an authentication error rather than a wrong-region one.", },
    ],
    credentialGroups: [
      { title: "Which tenant", note: "The region and the address together: the address is only for tenants on a private or proxied deployment.", fields: ["region", "baseUrl"] },
      { title: "The API application", note: "The id and secret are combined into a signed token on every call rather than being sent as a bearer key.", fields: ["appId", "appSecret"] },
    ],
    settingsNote: "The look-back window decides how far back the first sync reads incidents; it does not affect later incremental runs.",
    firstSync: {
      title: "Sync now reads incidents",
      detail: "Incidents and policy events inside the look-back window are fetched. The first sync after the window is the largest one; later runs read what has happened since.",
    },
    nextSteps: [
      "If the connection test passes but every read is empty, check the region before the key.",
    ],
  },

  proofpoint: {
    overview:
      "Reads email security incidents and the users they concern from Proofpoint, so what was blocked or clicked is visible beside the client it affects.",
    prerequisites: [
      { title: "A service principal with API access", detail: "In the Proofpoint TAP console: Settings → Service principals, create one with API access and note the principal and its secret. Both travel as HTTP Basic, not as a bearer token.", link: "https://help.proofpoint.com/Threat_Insight_Dashboard/API_Documentation" },
      { title: "Threat Insight (TAP) on the account", detail: "The API this reads is part of TAP. An account with only the email gateway has no incidents endpoint to read, and the refusal at that endpoint is where you would find out.", link: "https://help.proofpoint.com/Threat_Insight_Dashboard" },
      { title: "A granularity that suits the volume", detail: "The look-back window decides how much arrives on the first sync: a busy tenant returns a lot of incidents, and a smaller window is the difference between a quick first run and a long one." },
    ],
    credentialGroups: [
      { title: "The service principal", note: "The principal name and the secret are the username and password of a Basic header on every call.", fields: ["principal", "secret"] },
    ],
    settingsNote: "The look-back window bounds the first read; later runs ask for what has happened since.",
    firstSync: {
      title: "Sync now reads the window",
      detail: "Incidents and their messages inside the look-back window are fetched. Proofpoint's API is strict about the query shape: a missing or malformed interval is rejected rather than defaulted.",
    },
    nextSteps: [
      "Grant the service principal only the API permissions it needs — it is the ceiling on what arrives here.",
    ],
  },

  sentinelone: {
    overview:
      "Reads agents, threats and sites from one SentinelOne console, so endpoint coverage and detections can be seen per client rather than per console.",
    prerequisites: [
      { title: "An API token", detail: "In the console: Settings → Users, create a service user with the role you want, then generate its API token. A personal token stops working when that person leaves.", link: "https://support.sentinelone.com/hc/en-us/articles/360004195374-API-Token" },
      { title: "The console's own address", detail: "SentinelOne tenants live on their own consoles (for example https://<tenant>.sentinelone.net). The managed console address is not the tenant address.", },
    ],
    credentialGroups: [
      { title: "Which console", note: "The address of your tenant's console, without a trailing path.", fields: ["consoleUrl"] },
      { title: "The token", note: "A service user's token, not an administrator's personal one.", fields: ["apiToken"] },
    ],
    settingsNote:
      "Page size, page cap and the look-back window together decide how much of the estate is read per sync. The look-back applies to threats, so a short window on a busy console reads fewer detections.",
    firstSync: {
      title: "Sync now reads the console",
      detail: "Sites, agents and threats are fetched page by page. Agent counts are what most people check first, because they reconcile against the licence count.",
    },
    nextSteps: [
      "Use a service user rather than a person's token: the connection should not break when somebody changes roles.",
    ],
  },

  itglue: {
    overview:
      "Reads organisations, configurations and documents from IT Glue, so the documentation a client already has is visible where the work happens rather than in another tab.",
    prerequisites: [
      { title: "An API key", detail: "In IT Glue: Account → Settings → API keys, generate a key and store its password — the key is used as a Basic username and the password is what authenticates.", link: "https://api.itglue.com/developer/" },
      { title: "Awareness of the rate limit", detail: "IT Glue rate-limits API keys per five minutes and per day. A large organisation with many configurations and documents will not finish in one sync, which is what the page cap is for.", link: "https://api.itglue.com/developer/#introduction" },
    ],
    credentialGroups: [
      { title: "The key", note: "Paste the key itself; its password is what has to accompany it, and the connector reads the pair from this value as IT Glue expects.", fields: ["apiKey"] },
    ],
    settingsNote:
      "Page size and page cap keep a sync inside IT Glue's rate limit; the organisation cap bounds how many organisations one run walks. Incremental limits the run to what has changed, which is what makes a large account practical.",
    firstSync: {
      title: "Sync now reads organisations",
      detail: "Organisations first, then configurations and documents. Expect this one to take longer than the others: it is the connector most likely to hit a vendor rate limit, and it resumes on the next sync rather than failing.",
    },
    nextSteps: [
      "Switch on incremental once the first full sync has completed — that is what keeps the daily runs inside the rate limit.",
      "If a sync reports a partial read, run it again; a rate limit is not a permission problem and the records already fetched are already stored.",
    ],
  },

  azure: {
    overview:
      "Reads subscriptions, resource groups and resources from one Azure tenant, so what a client is running — and what it costs, where the billing APIs are readable — sits beside the tickets about it.",
    prerequisites: [
      { title: "A service principal", detail: "Entra ID → App registrations → New registration, then Certificates & secrets → New client secret. This is the identity C7NTAX reads with.", link: "https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app" },
      { title: "Reader on the subscriptions", detail: "The service principal needs at least the Reader role on every subscription you want read — assign it on the subscription rather than at the tenant, so the blast radius is what you chose.", link: "https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-portal" },
      { title: "The subscription id", detail: "Azure portal → Subscriptions. Reading more than one means connecting each, or granting the principal access across them and connecting the top one.", },
    ],
    credentialGroups: [
      { title: "The tenant", note: "The directory the service principal lives in.", fields: ["tenantId"] },
      { title: "The service principal", note: "The secret is shown once, when it is created. Diarise its expiry: the connection stops the day it lapses.", fields: ["clientId", "clientSecret"] },
      { title: "What to read", note: "One subscription per connection. An empty result is almost always a missing role assignment rather than a wrong credential.", fields: ["subscriptionId"] },
    ],
    firstSync: {
      title: "Sync now reads the subscription",
      detail: "Resource groups and resources are fetched with their tags and locations. The Azure Resource Graph is not queried, so what arrives is the subscription's own inventory, not the tenant's whole estate.",
    },
    nextSteps: [
      "Prefer one connection per subscription you actually invoice for; a tenant-wide read is a lot of data for a question nobody asked.",
      "Diarise the client secret's expiry alongside the M365 one — they are usually created in the same sitting.",
    ],
  },

  aws: {
    overview:
      "Reads accounts, regions and resources from one AWS account, and can reach the Cost Explorer where the account's billing is readable, so consumption sits beside the client it belongs to.",
    prerequisites: [
      { title: "An IAM user with programmatic access", detail: "Create a dedicated IAM user for C7NTAX rather than using a person's access key, then generate an access key id and secret.", link: "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users_create.html" },
      { title: "A read-only policy attached to it", detail: "Attach the AWS-managed ReadOnlyAccess policy for a first run, or a narrower one listing only the services you want read. AWS denies by default, so a missing permission shows up as empty results rather than as an error.", link: "https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_managed-vs-inline.html" },
      { title: "The region to read", detail: "One region per connection. Enabling Cost Explorer is a separate, chargeable step if billing data is wanted.", link: "https://docs.aws.amazon.com/cost-management/latest/userguide/ce-what-is.html" },
    ],
    credentialGroups: [
      { title: "The IAM user", note: "Every request is signed with these, so a wrong key produces a signature error rather than an authorisation one.", fields: ["accessKeyId", "secretAccessKey"] },
      { title: "Where to read", note: "One region per connection; the session token is only needed when the keys came from a temporary credential (SSO, STS or a role assumption).", fields: ["region", "sessionToken"] },
    ],
    firstSync: {
      title: "Sync now reads the region",
      detail: "Resources in the chosen region are listed service by service, and the account's billing is read where Cost Explorer is enabled. A large account takes a while: the read is paginated per service.",
    },
    nextSteps: [
      "Check the sync log for AccessDenied mentions: they name the actions the policy is missing, which is a much faster way to write the policy than guessing.",
      "Cost Explorer is charged per request by AWS — worth knowing before pointing this at a large estate.",
    ],
  },

  azure_ad_sso: {
    overview:
      "This connection is authentication rather than data: it decides who may sign in to C7NTAX and which role they get, by federating with your identity provider. Nothing is synced from it, and it changes nothing in your tenant.",
    prerequisites: [
      { title: "An app registration for C7NTAX", detail: "Entra ID → App registrations → New registration. This one represents C7NTAX in your tenant, which is the opposite of the Azure connector's service principal.", link: "https://learn.microsoft.com/en-us/entra/identity/saas-apps/tutorial-list" },
      { title: "Decide SAML or OIDC", detail: "SAML needs the entity id and ACS URL registered; OIDC needs a redirect URI and (for a confidential client) a client secret. The two are configured differently in Entra, so choose before filling anything in.", },
      { title: "Groups, if roles are mapped", detail: "Group-to-role mapping is applied at sign-in, so the groups have to exist and be claimed by the token before a mapping can be written.", },
    ],
    credentialGroups: [
      { title: "The tenant", note: "The directory whose people will sign in.", fields: ["tenantId"] },
      { title: "The C7NTAX registration", note: "The client secret is only needed for OIDC. SAML signs with a certificate instead, which is configured in Entra, not here.", fields: ["clientId", "clientSecret"] },
      { title: "Who it applies to", note: "The verified domain narrows this connection to one email domain, which matters when several tenants sign in to the same instance.", fields: ["domain"] },
    ],
    settingsNote:
      "The protocol choice decides which of the remaining fields matter: entity id and ACS URL for SAML, redirect URI for OIDC. The group-to-role mapping is applied at sign-in, so a change here takes effect the next time somebody signs in rather than immediately.",
    firstSync: {
      title: "There is nothing to sync",
      detail: "Saving this connection makes the sign-in flow available; it does not read anything. The check that matters is a real sign-in afterwards: use a test account, confirm it lands in the right role, and keep the local administrator account until you have.",
    },
    nextSteps: [
      "Sign in with a test account immediately after enabling this, and keep a break-glass local administrator in case the mapping is wrong.",
      "Confirm the group-to-role mapping with a user from each group — an unmapped group signs in with no role rather than the wrong one.",
      "Review who may use the connection: the verified domain is the narrowed scope, and editing it is the way to include or exclude a whole domain.",
    ],
  },
};

export type { ConnectorSetup } from "./connectorSetupTypes";
