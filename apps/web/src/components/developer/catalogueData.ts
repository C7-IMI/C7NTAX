/**
 * The Developer section's catalogue — the proposal made real.
 *
 * A section that offers changes not normally available is only defensible if every control can answer
 * three questions on its own line: **what it does**, **what it can destroy**, and **the safeguard that
 * makes it acceptable to ship**. So each entry is those three answers in that order, and the grouping is
 * by *what the entry is about* rather than by the script that happens to implement it — the question a
 * person arrives with is "which of these is it", not "which command was it".
 *
 * Every entry carries **where it lives today**, so the page reads as a map of what already exists rather
 * than a wish list, and the ones that are only a command say so in the same words the mockup uses. No
 * figure is written here: a count that lives in prose goes stale, so the entries that have a count point
 * at the page that reads it.
 */

export type CatalogueGroupId = "data" | "env" | "int" | "id" | "diag" | "kill";

/** How an entry exists today. The chip the catalogue draws, and the promise it is allowed to make. */
export type EntryState =
  | "exists" // a screen serves it now — this page, or the product
  | "read-only" // a read, with or without a panel
  | "cli-only" // the capability exists, as a command somebody has to remember
  | "proposed"; // no build at all

export interface CatalogueGroup {
  id: CatalogueGroupId;
  label: string;
  /** The one-line answer to "what is in this group". */
  say: string;
}

export interface CatalogueEntry {
  group: CatalogueGroupId;
  name: string;
  /** Where the capability lives today — the command, the file, the endpoint. */
  where: string;
  does: string;
  canDestroy: string;
  safeguard: string;
  state: EntryState;
  /** The route that exists, where one does. Absent means "no screen yet". */
  to?: string;
  toLabel?: string;
  /** Said plainly where a capability has no surface yet, rather than pretending it has one. */
  note?: string;
}

export const CATALOGUE_GROUPS: CatalogueGroup[] = [
  { id: "data", label: "Data & database", say: "What the instance contains, and what it would take to change that." },
  { id: "env", label: "Environment & configuration", say: "What is set, what is defaulting, and which instance this is." },
  { id: "int", label: "Integrations & outbound", say: "Everything that leaves the building, and how to test it without mailing a client." },
  { id: "id", label: "Identity & access", say: "Sessions, lockouts, second factors and the ways in that exist on purpose." },
  { id: "diag", label: "Diagnostics & repo health", say: "The logs, the probes, the caches, and the checks that guard the branch." },
  { id: "kill", label: "Danger zone", say: "Nothing here has a way back. It is given its own screen, not a section of this one." },
];

export const CATALOGUE: CatalogueEntry[] = [
  // ── Data & database ───────────────────────────────────────────────────────────────────────────
  {
    group: "data",
    name: "Sample-data state and purge",
    where: "pnpm db:sample-off · db:sample-on",
    does: "Reports whether the marker file apps/api/.sample-data-disabled exists and what it is doing to snapshot capture and the automatic reseed, and offers the two operations the CLI performs.",
    canDestroy: "Every business row — every delegate in WIPE_MODELS, children before parents, including the auditLog the section's own trail is written to.",
    safeguard: "A snapshot captured first and shown locked, a dry run with per-model counts, a typed phrase, and KEEP_MODELS — identity and platform configuration — preserved so sign-in, roles and locale survive.",
    state: "exists",
    to: "/developer/purge",
    toLabel: "Open Purge Data",
  },
  {
    group: "data",
    name: "Reseed a fixture pack",
    where: "db:seed-full · db:seed-auto · db:seed-coverage · db:reseed",
    does: "Runs one of the packs in apps/api/src/seed-*.ts: seed-ticket-samples, seed-service-alerts, seed-contacts, seed-product-catalog, seed-role-permissions, seed-ticket-tabs, seed-automation, seed-backlog, seed-coverage, seed-sample-coverage.",
    canDestroy: "Anything you changed since the fixture was captured. db:seed-from-snapshots overwrites, so re-seeding rolls business data back to whenever the snapshot was taken.",
    safeguard: "A dry run that names the models the pack writes and how many rows each takes — seed-role-permissions --dry-run is the precedent — and it merges additively, so its worst case is a role that can do more, never one that cannot work.",
    state: "cli-only",
    note: "no screen yet — this lives in pnpm db:seed-coverage and its siblings",
  },
  {
    group: "data",
    name: "Snapshot capture, restore and lock status",
    where: "db:capture · services/autoSnapshot.ts · services/snapshotPoller.ts",
    does: "Shows the fixture files under apps/api/src/snapshots/, when each was last written, and whether the lock is set; captures on demand.",
    canDestroy: "A capture overwrites the files a restore reads from. Success is the destructive case: the state you might have wanted back is the state that was just written over.",
    safeguard: "The lock is one switch read in three places — snapshot-capture.ts, services/autoSnapshot.ts and services/snapshotPoller.ts all return early while it is set — and the panel shows which of the three is suppressed.",
    state: "cli-only",
    note: "no screen yet — this lives in pnpm db:capture and the snapshot services",
  },
  {
    group: "data",
    name: "Migration status",
    where: "db:migrate:status · db:migrate:deploy",
    does: "Applied against pending for the migrations in apps/api/prisma/migrations, and states any drift between the schema and the database.",
    canDestroy: "Applying a migration rewrites tables, and a destructive one is indistinguishable from a safe one by its file name — board_close_notifies_customer and agreement_time_rules look identical in a list.",
    safeguard: "Read-only by default. Applying requires the migration's own SQL shown in full, a snapshot taken, and the environment badge reading development — a production instance offers the command and refuses it.",
    state: "cli-only",
    note: "no screen yet — this lives in pnpm db:migrate:status",
  },
  {
    group: "data",
    name: "Per-model row counts and orphans",
    where: "read-only · the purge dry run",
    does: "The same count per delegate the purge iterates, plus rows whose parent is gone — a ticketComment with no ticket, a kumoAssetFieldValue with no kumoAsset, an invoiceLineItem with no invoice.",
    canDestroy: "Nothing. Every query is a count or a join on a nullable foreign key.",
    safeguard: "None needed — and that is the point of listing it: it is the dry run's own data source, and it is deliberately cheap enough to run on every load.",
    state: "read-only",
    to: "/developer/purge",
    toLabel: "Counted on Purge Data",
  },
  {
    group: "data",
    name: "Integrity check",
    where: "read-only",
    does: "Foreign-key orphans, duplicate uniques, counts that cannot go negative, tickets whose board or client no longer exists, and snapshots that no longer match the schema they were written from.",
    canDestroy: "Nothing.",
    safeguard: "Read-only, and it names the offending ids rather than offering a repair — a repair button on an integrity screen is a second destructive operation hiding behind a harmless one.",
    state: "proposed",
  },

  // ── Environment & configuration ───────────────────────────────────────────────────────────────
  {
    group: "env",
    name: "Environment variables: set, or defaulting",
    where: "apps/api/.env · the registry's env: declarations",
    does: "For every name the configuration registry declares, whether it is set in the instance's own .env or falling back to the registry default, and what the effective value is.",
    canDestroy: "Nothing on this screen — a change needs a restart, so it is the one panel here that is purely a read.",
    safeguard: "No secret is ever printed. A value that looks like one is shown as set, with a hint, the copy control is off for those rows, and the reserved-name rule in routes/system.ts refuses them over HTTP to everyone, administrator included.",
    state: "read-only",
  },
  {
    group: "env",
    name: "The effective value of every app_settings section",
    where: "GET /api/configuration · the declared sections",
    does: "Each section the registry declares — Workspace, Sessions & Security, Customer Portal, Service Alerts & Monitoring, Knowledge Base & AI, C7NC & Email, Billing & Invoicing, Client Apps & Notifications — with its stored value, its default and whether an environment variable is overriding it.",
    canDestroy: "A change alters every user's screen at once, and the person changing it is usually one of the few who will not notice.",
    safeguard: "Each section already declares a readPermission and a writePermission, and this catalogue links to the screen that owns a field rather than editing it here; guard:config proves every read names a declared field, so this panel cannot invent a setting.",
    state: "exists",
    to: "/admin/configuration",
    toLabel: "Open Configuration",
  },
  {
    group: "env",
    name: "Feature-flag registry",
    where: "apps/web/src/lib/uiFlags.ts · packages/shared/src/features/*",
    does: "One table of every kill switch with its owner, its default and which layer has overridden it: c7_ui_p1, c7_ui_p2, c7_ui_palette, c7_ui_kumo_orgs, c7_ui_kumo_types, c7_ui_kumo_crumbs, c7_ui_context_menus, c7_ui_console, c7_ui_nav, c7_ui_redesign, each with its VITE_UI_* deployment counterpart.",
    canDestroy: "A flag off hides a shipped capability for everyone on the deployment, and the person who switched it off is usually standing on the screen it just disappeared from.",
    safeguard: "The three layers are shown separately — a per-browser localStorage override, the system setting that decides the default, and the VITE_* build switch that needs a restart — so the switch says which one is winning before it is pressed.",
    state: "exists",
    to: "/admin/configuration",
    toLabel: "Open Configuration",
  },
  {
    group: "env",
    name: "Environment badge and the non-production banner",
    where: "NODE_ENV",
    does: "Says which instance this is — development, staging or production — from NODE_ENV, and draws the banner across the whole section when the answer is not production.",
    canDestroy: "Nothing itself — it exists so that nothing else is done by mistake, which is the cheapest safeguard in the section and the one people remove first.",
    safeguard: "The banner is not dismissible, and the destructive controls refuse to arm at all when the badge and the instance the request reached disagree.",
    state: "exists",
  },

  // ── Integrations & outbound ───────────────────────────────────────────────────────────────────
  {
    group: "int",
    name: "Outbound-email sandbox",
    where: "proposed — nothing here today",
    does: "Redirects every outbound message to one address, keeps them in a log with the rendered body and the real recipient in the headers. Ticket notifications, portal sign-in codes and connector error mail all leave through the same relay, so one switch covers all three.",
    canDestroy: "With the sandbox off, a test button mails real clients — and a portal sign-in code reaches a real customer, which is not a message you can recall.",
    safeguard: "A banner while it is on, an expiry that turns it off rather than on, and the count of messages it has swallowed on the control itself.",
    state: "proposed",
  },
  {
    group: "int",
    name: "SMTP and Graph test send",
    where: "EMAIL_GRAPH_ENABLED · SMTP_HOST · SMTP_FROM",
    does: "Sends one message through the relay the application itself uses — or through Microsoft Graph when EMAIL_GRAPH_ENABLED says so — and reports the server's own reply rather than a client's guess.",
    canDestroy: "One real message to one real person if the sandbox is off, from the instance's own address, which the recipient will read as the product talking to them.",
    safeguard: "The exact recipient is printed before the send, a customer address is refused while the sandbox is on, and every attempt is recorded with the server's response.",
    state: "cli-only",
    note: "no screen yet — the relay is configured in the C7NC & Email section",
  },
  {
    group: "int",
    name: "Webhook signature tester and delivery replay",
    where: "alertWebhookDelivery · webhookConfig",
    does: "Signs a payload with the configured secret so an endpoint's own verification can be checked, then replays one recorded delivery, against the configured webhook endpoints.",
    canDestroy: "A replay delivers a second time to a live endpoint. For a ticket or invoice event that is a duplicate somebody downstream has to unpick, and the endpoint cannot tell it from the first.",
    safeguard: "The target URL and the event are printed before the send, a failed delivery is the one offered first because a replay of a failure usually fixes something, and the delivery id is written to the audit log.",
    state: "exists",
    to: "/admin/webhooks",
    toLabel: "Open Webhooks",
  },
  {
    group: "int",
    name: "Microsoft 365 sync, run now",
    where: "m365User · m365Group · m365Subscription · syncLog",
    does: "Runs the directory sync on demand instead of waiting for its schedule, and shows the last runs from syncLog.",
    canDestroy: "A sync overwrites the local copy of everything it reads — including the fields somebody edited here that the directory does not have.",
    safeguard: "The delta is shown first: what will be added, changed and removed, with the local values that will lose. It refuses to start while a scheduled sync is in flight.",
    state: "cli-only",
    note: "no screen yet — this lives in the sync worker and its schedule",
  },
  {
    group: "int",
    name: "Email connector test",
    where: "emailConnector · EMAIL_CONNECTORS_ENABLED",
    does: "Tests an IMAP or Exchange connector — connects, lists the folder, reads one message without filing it — and reports lastPollAt and the poll interval, so a connector that has silently stopped is visible.",
    canDestroy: "A poll that goes wrong files mail into the wrong board, and the tickets it creates are tedious to unpick — a wrong defaultCompanyId is one setting away from that.",
    safeguard: "The test is read-only and names the folder and the board it would file into before anything is fetched; the connector's own enabled switch is the second gate, and the panel says when the runtime is off.",
    state: "exists",
    to: "/admin/boards",
    toLabel: "Open Boards & connectors",
  },
  {
    group: "int",
    name: "API keys: issue, rotate, revoke",
    where: "apps/web/src/pages/ApiAccess.tsx",
    does: "The same surface as Administration → API access, with the operations an administrator only needs while developing — issuing a key, rotating one in place, revoking by prefix.",
    canDestroy: "Revoking stops whatever machine holds the key. A rotation with no grace window breaks it at the same instant, and the machine is usually a script nobody is watching.",
    safeguard: "Last-used sits next to revoke so a dead key is visibly dead, a rotation keeps the old key valid for a stated window, no key value is ever shown again after creation, and each of the three is audited with its reason.",
    state: "exists",
    to: "/admin/api",
    toLabel: "Open API access",
  },

  // ── Identity & access ─────────────────────────────────────────────────────────────────────────
  {
    group: "id",
    name: "Active sessions and revoke",
    where: "GET /api/security/sessions · DELETE /api/security/sessions/:id",
    does: "The Security screen's Active sessions tab, reachable without leaving the section, with the same revoke action and who, from where, on what device.",
    canDestroy: "Ends somebody's session mid-task; whatever they had typed and not saved goes with it.",
    safeguard: "Shows who, from where, on what device and how long is left; refuses to revoke the session making the request; and offers \"end every session this person has\" only with the reason filled in. This screen already exists — the section links to it rather than replacing it.",
    state: "exists",
    to: "/admin/security",
    toLabel: "Open Security",
  },
  {
    group: "id",
    name: "Unlock a locked-out account",
    where: "proposed",
    does: "Clears failed sign-in attempts for one account so a lockout can be undone without waiting for it to expire — the thing a technician asks for at 8:55 on a Monday.",
    canDestroy: "The lockout exists because somebody guessed wrong repeatedly; unlocking re-opens exactly that door, and does it for the account most likely to be under attack.",
    safeguard: "Names the account, the attempt count and the addresses the attempts came from, so the unlock is a decision made with the evidence on the screen, and requires a reason either way.",
    state: "proposed",
  },
  {
    group: "id",
    name: "MFA and passkey reset for a user",
    where: "PASSKEY_ENABLED · WEBAUTHN_RP_ID · /api/security/devices",
    does: "Removes a second factor — a registered passkey or a push device — so an account that has lost its authenticator can sign in again.",
    canDestroy: "It takes the second factor off an account whose password may already be known to somebody else, and the removal is invisible to the person it protects until it is used against them.",
    safeguard: "The device is named with its label and last use, the user is notified, and the reset is written down twice — once by the administrator who did it and once on the account.",
    state: "exists",
    to: "/admin/security",
    toLabel: "Open Security",
  },
  {
    group: "id",
    name: "\"View as\" with a written reason",
    where: "proposed",
    does: "Opens the application as another account for the length of one session, so a permission, a screen or a client's own view can be seen as that person sees it — the honest version of \"it works for me\".",
    canDestroy: "Everything that account can do, the person looking can do — including things nobody intended while they were only looking. A client admin's account is a client's data.",
    safeguard: "A reason is mandatory before the control arms; a banner sits on every screen for the whole session; writes are refused while it is on unless separately enabled; and it ends on the reason's own timer rather than on a sign-out somebody forgets.",
    state: "proposed",
  },
  {
    group: "id",
    name: "Break-glass account state",
    where: "AUTH_TEST_BYPASS · AUTH_TEST_BYPASS_ACCOUNT",
    does: "Shows whether the authentication test bypass is set on this instance, which account it admits and how long its token lives — the sign-in path used when single sign-on is the only door and single sign-on is what is broken.",
    canDestroy: "A bypass that is on and forgotten is a permanent way in that asks for no password and leaves no session anybody watches.",
    safeguard: "The flag's real name — declared in the Sessions & Security section of the registry — and its account are printed side by side, the countdown to expiry is on the screen, and the control will not arm without a reason and an end time.",
    state: "exists",
    to: "/admin/system",
    toLabel: "Open System settings",
  },
  {
    group: "id",
    name: "The authentication-timeout bypass",
    where: "session_timeout · \"Administrators never time out\"",
    does: "Reads and sets the idle timeout and the \"Administrators never time out\" override from Sessions & Security, and says which session length is actually in force.",
    canDestroy: "An administrator who never times out is a signed-in session on an unlocked laptop that never ends — and that account can do everything in this section.",
    safeguard: "The override is shown with the number of accounts it currently applies to, the change is attributed in the audit log, and the copy states the effective value rather than repeating what was typed — the trap the configuration screen avoids by declaring a default for every field.",
    state: "exists",
    to: "/admin/security",
    toLabel: "Open Sessions & Security",
  },

  // ── Diagnostics & repo health ─────────────────────────────────────────────────────────────────
  {
    group: "diag",
    name: "Request and error log tail",
    where: "dev-errors.log",
    does: "Tails the instance's error log in the shape it already writes: timestamp, level, context, git revision, memory, message, stack.",
    canDestroy: "Nothing — it is a tail over the file the process already writes.",
    safeguard: "Read-only, and the tail deliberately excludes request bodies, so a token or a password in a body is never on this screen.",
    state: "read-only",
    note: "no screen yet — this lives in the API's dev-errors.log",
  },
  {
    group: "diag",
    name: "Readiness",
    where: "GET /api/ready · GET /api/health",
    does: "The two probes an orchestrator uses, on the screen a person uses: /api/ready and /api/health, with the database, Redis and the worker shown separately, so \"ready\" can be explained when the answer is not.",
    canDestroy: "Nothing.",
    safeguard: "Read-only, and it is the one entry in the catalogue whose failure the section cannot hide: a red row here keeps the banner up.",
    state: "read-only",
  },
  {
    group: "diag",
    name: "Slow queries",
    where: "proposed",
    does: "The slowest statements in the window, with their duration, the route that issued them, and whether the index schema.prisma declares for that table was used.",
    canDestroy: "Nothing.",
    safeguard: "Read-only, and parameters are stripped from the statements before they are shown — a slow query's parameters are somebody's data.",
    state: "proposed",
  },
  {
    group: "diag",
    name: "The guard runner",
    where: "guard:routes · guard:api-docs · guard:config · guard:console · guard:plugin · guard:deps · guard:encoding · check-help-links",
    does: "Runs the repository's own checks against this working copy and prints each one's own line — routes and their permission guards, the API document against the routes, config reads against declared fields, the console catalogue, the plugin payload, the dependency baseline, encoding, and the help links.",
    canDestroy: "Nothing — it is the opposite. It is what stands between a change and the branch, which is why it is the first panel on the hub.",
    safeguard: "None needed, so it is instead honest: it is drawn with whatever the checks really printed, including a failure and a check that could not run.",
    state: "read-only",
    note: "read on this page — see Repo health",
  },
  {
    group: "diag",
    name: "Cache and queue inspection",
    where: "inferenceCache · ticketSimilarity · detectedPattern · Redis",
    does: "What is cached, how large it is and how often it is hit, with flush and rebuild, and a view of the Redis keys the worker uses.",
    canDestroy: "Flushing throws away responses that were paid for by the token; rebuilding the similarity table drops computed rows and recomputes them, and each recompute is a provider call.",
    safeguard: "Each action states how many rows it removes and whether it costs money, the rebuild is queued rather than run inside the request, and both are audited with the reason.",
    state: "cli-only",
    note: "no screen yet — the cache and queue live in the worker",
  },
  {
    group: "diag",
    name: "AI provider configuration, with a test",
    where: "aiProviderConfig · InferenceManage",
    does: "The live provider list, plus a one-token test call and the counters the cache already records: tokensUsed, costEstimate, latencyMs, hitCount.",
    canDestroy: "A test call costs money, and making a provider the default changes what every AI action in the application uses — including the ones running unattended.",
    safeguard: "The test names the provider, the model and the account it will bill before it sends; the key stays masked; and changing the default is a two-step change that names the provider it is replacing.",
    state: "exists",
    to: "/settings/ai",
    toLabel: "Open Inference settings",
  },
  {
    group: "diag",
    name: "Support bundle export",
    where: "proposed",
    does: "Writes one file holding the version, the configuration the instance declares, the readiness of each dependency, the guard output, the last errors and the feature-flag table — the thing to attach to a support request instead of eleven screenshots.",
    canDestroy: "Nothing by itself, but a bundle made carelessly is how a secret leaves a building — and it leaves by email, which is the outbound path this section already warns about.",
    safeguard: "The bundle declares what it will contain before it is written, secrets are fingerprinted rather than included, and the download is audited with the reason.",
    state: "proposed",
  },
  {
    group: "diag",
    name: "Maintenance and read-only mode",
    where: "proposed",
    does: "Serves every screen but refuses every write, with a line on each page saying so — so a restore, a migration or a purge can happen without users typing into a moving target.",
    canDestroy: "Writes made during the window are lost. A reply typed and refused is a reply not sent, and the person who typed it usually does not know why.",
    safeguard: "The window carries an end time, the message users will see is written in advance rather than invented at the time, and the mode cannot be turned on while any other operation in this section is in flight.",
    state: "proposed",
  },

  // ── Danger zone ───────────────────────────────────────────────────────────────────────────────
  {
    group: "kill",
    name: "Purge all business data",
    where: "the Purge data screen, with two safeguards removed",
    does: "The same deletion as Purge data, as a single act rather than a return to a sample state: no snapshot kept, no flag, no way back.",
    canDestroy: "Every business row, with the preserved list published rather than assumed — the difference from the purge screen is exactly which safeguards are missing.",
    safeguard: "Drawn next door with the difference spelled out, and the typed phrase is the instance's own name rather than a policy word.",
    state: "proposed",
    to: "/developer/danger",
    toLabel: "Open Danger Zone",
  },
  {
    group: "kill",
    name: "Reset the database to the empty schema",
    where: "proposed",
    does: "Drops and recreates the schema from the migrations in apps/api/prisma/migrations, leaving nothing — not even the tables the purge keeps.",
    canDestroy: "Identity and configuration too: every user, role, session, locale, currency and retention policy. The login being used to run it stops existing mid-operation.",
    safeguard: "Refuses while any account other than the one acting is signed in, takes a full dump first, and requires the instance name typed.",
    state: "proposed",
    to: "/developer/danger",
    toLabel: "Open Danger Zone",
  },
  {
    group: "kill",
    name: "Rotate every API key and disable every integration",
    where: "proposed",
    does: "One press for the exit case — new keys for every row in apiKey, and every integration switched off.",
    canDestroy: "Every machine talking to this instance stops at once, including the ones nobody remembered were talking to it.",
    safeguard: "Shows each caller's last-seen time before it acts, and reports afterwards what has not been heard from — which is the only way to find the machine nobody remembered.",
    state: "proposed",
    to: "/developer/danger",
    toLabel: "Open Danger Zone",
  },
  {
    group: "kill",
    name: "The audit record every developer action leaves",
    where: "auditLog",
    does: "The section's own log, filtered to developer actions only, with actor, IP, operation, the reason and the blast radius the dry run reported — readable after the fact and exportable.",
    canDestroy: "Nothing, but note the order: auditLog is itself in WIPE_MODELS, so a purge takes its own read-out with it. The receipt is written outside the wiped set.",
    safeguard: "Written by the service that performs the work, never by the screen; the destructive operations additionally write a copy outside the wiped set; and the purge's receipt names where that copy is.",
    state: "read-only",
    to: "/developer/danger",
    toLabel: "Open Danger Zone",
  },
];
