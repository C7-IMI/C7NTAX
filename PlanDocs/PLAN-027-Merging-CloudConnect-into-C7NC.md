# PLAN-027 — Merging CloudConnect into C7NC

> **Sequence:** filed 2026-10-08, at the operator's request. **Not scheduled**, and it blocks nothing:
> it touches the front door of one section, not the API, the schema or the connectors behind it.
> **Requested:** "merge CloudConnect into C7NC. The CloudConnect name and references would be renamed
> C7NC. Do a mockup of what that would look like with proper landing pages, subsections, tab style
> pages, etc." — and: mockup only, no changes yet.
> **Built so far (BuildNotes 2026.10.8.026):** the mockup
> ([`docs/mockups/c7nc-merged-hub.html`](../docs/mockups/c7nc-merged-hub.html), seven screens drawn with
> the application's own stylesheet, §8); **Phases 0–5** — the section `/c7nc` with its five tabs and a
> route per tab, the hub, Services (with add and configure as modes), AI models, Email and Companion
> apps; the nav reorganised and its permission corrected; the redirects; and the visible half of the
> rename. **Left:** the service-detail page, the `/api/c7nc` alias, the non-UI rename and the guard (§9).
> **Decided (recommended):** C7NC survives as the name and CloudConnect retires; a hub landing page that
> answers "is anything broken?" before "which connectors exist"; four subsections — **Services, AI models,
> Email, Companion apps** — each a tab-style page; a service gets a page of its own, which is what finally
> puts FlexPoint's connection and its ledger in one place; every old route redirects, including the API
> path as an alias; no new permissions, and the hub asks for less than the nav does today.
> **Cost when taken:** ~4–6 days — one new hub page, four subsection pages and one service-detail page
> (mostly re-hosting components that exist), a redirect table, and a 230-occurrence rename across 41
> files in code, docs, probes and two scripts. Phased in §9.
> **Cost to revert:** the nav tree entry and the route table are two blocks; putting CloudConnect back is
> restoring those two and deleting the redirects. Nothing behind them changes in either direction, because
> no API path, permission, database column or stored setting is renamed destructively (§7).
> **Depends on:** nothing. It gets better if done **before** PLAN-026's Agent access lands, because that
> policy screen has to go on the AI models page, and it is cheaper to move a page than to move a page and
> a new policy editor.
> **Next action:** freeze §11 (D1–D9) and, if it is a yes, build Phase 0 — routes, redirects and nav,
> which is reversible on its own.

---

## 1. What exists today, and the three problems

Nothing here is broken. It is filed under three different ideas of what it is.

| Piece | Where it is | Size / shape |
|---|---|---|
| **CloudConnect** — the connector catalogue, the connected list, the setup wizards, the M365 inactivity panel, the email connectors | `Administration → CloudConnect`, one page of **five tabs** ([CloudConnect.tsx](../apps/web/src/pages/CloudConnect.tsx), 79,301 bytes; tabs at line 543: Connected · Add a connector · Configuration · AI models · Email connectors) | One page behind one permission |
| **C7NC** — the companion clients | A two-item nav group ([Layout.tsx](../apps/web/src/components/Layout.tsx) line 129) with **Outlook Add-in** and **FlexPoint Payment Solutions**; no page of its own — `/section/c7nc` lands on a generic section page | Two pages |
| **FlexPoint's business view** — customers, what they owe, invoice push, the options that decide what a sync does | `C7NC → FlexPoint Payment Solutions` ([C7NCFlexpoint.tsx](../apps/web/src/pages/C7NCFlexpoint.tsx)) | A 26 KB page whose first button is `Connection settings` → **`/cloudconnect`** (lines 207–209) |

**Problem 1 — a service is split across two sections, two clicks apart.** FlexPoint's *connection* is
configured in CloudConnect; FlexPoint's *options, customers and invoices* are in C7NC; the C7NC page's
header links back to CloudConnect, and its empty state tells you to go and add the connection "in
CloudConnect". One service, two mental models. This is the problem the merge actually solves, and it is
the reason the mockup's third screen exists.

**Problem 2 — the front door asks the wrong question.** The page opens on whatever tab you left, but the
question people arrive with is "is anything broken?", and the answer is currently spread across the
Connected tab's status chips, a health tooltip per row, and an amber count in the subtitle. "Which
connectors exist" is a different question and it is the second tab.

**Problem 3 — the nav asks for more permission than the page needs.** The nav entry requires
`IntegrationManage` ([Layout.tsx](../apps/web/src/components/Layout.tsx) line 58), while the API answers
everything the page *reads* with `IntegrationView` — fifteen endpoints in
[routes/cloudconnect.ts](../apps/api/src/routes/cloudconnect.ts), of which just four need
`IntegrationManage`. A technician who may look at connection health and press **Test** and **Sync**
cannot reach the page at all. The merge is a chance to fix that by accident, which is the best way.

---

## 2. The proposed architecture

```
C7NC                          /c7nc                     no permission — the hub
├─ Overview                   /c7nc                     IntegrationView
├─ Services                   /c7nc/services            IntegrationView
│    └─ a service             /c7nc/services/:kind      + IntegrationManage to change anything
├─ AI models                  /c7nc/models              InferenceView
├─ Email                      /c7nc/email               IntegrationView
└─ Companion apps             /c7nc/apps                none — a download anyone signed in may take
     ├─ Outlook add-in        /c7nc/apps/outlook-addin
     ├─ Desktop client        /c7nc/apps/desktop
     └─ Versions              /c7nc/apps/versions
```

| Node | What it holds | Today |
|---|---|---|
| **Overview** | The hub: health summary, "needs attention", four subsection cards, and quiet links to API Access / webhooks / MCP | does not exist |
| **Services** | Tabs *Connected · Available · Needs attention · Activity*; the connector catalogue with both wizard buttons; the same six row actions; **Open** → the service's own page | CloudConnect tabs *Connected*, *Add a connector*, *Activity*(new) |
| **AI models** | Tabs *Connected · Available · Assistant*; the model catalogue and wizards; the connected model's test/models/agent-access actions | CloudConnect tab *AI models* (`AiModelsPanel.tsx`) |
| **Email** | Tabs *Mailboxes · Routing · Activity* | CloudConnect tab *Email connectors* (`EmailConnectorsPanel.tsx`) |
| **Companion apps** | Tabs *Outlook add-in · Desktop · Versions* | `C7NC → Outlook Add-in` |
| **A service page** | Tabs *Overview · Configuration · …service tabs… · Activity* — for FlexPoint: *Ledger* and *Invoices* | half in CloudConnect (*Configuration*), half in `C7NC → FlexPoint` |
| **Administration** | loses its CloudConnect entry; keeps API Access, webhooks and everything else | — |

The **three Environment / administration-ish things** that belong to "connecting" but not to this section
— API Access (`UserManage`), Alert Webhooks (`ServiceAlertManage`), and PLAN-025's MCP server — stay where
they are and are **linked from the hub**, with the reason written on the screen. Moving a screen without
moving its permission is how a hub ends up half empty for the people who need it most; the plan records
this as D4 rather than leaving it to whoever builds Phase 1.

---

## 3. The landing page: answer the question you arrived with

The hub's anatomy, top to bottom, and why each part is there (drawn in screen 1 of the mockup):

1. **A header that states the situation in a sentence** — "6 services · 1 model · 2 mailboxes · 1
   companion app — 2 things need attention". Not four counters: a sentence, because that is what an
   operator repeats to somebody else.
2. **Needs attention**, with the fix and the wizard beside each line ("Microsoft 365 — last sync failed 2
   hours ago; the app registration's refresh token expired → Walk me through it"). If it is empty the
   block is *absent*, not empty — a green box that always says "0 issues" trains people to stop reading
   it.
3. **The four subsections as cards**, each able to say how it is doing (counts, a health chip, what is
   available to add) — because a list of links makes you open four pages to find out which one is on fire.
4. **Quiet signposts** for the three linked-but-not-moved things, with the one-line reason.

**What the hub must not become:** a dashboard of charts (this is a door, not a report), or a place where
actions live (every action belongs on the page for the thing it acts on — the hub's only buttons are
"Connect a service" and "Fix this", both of which deep-link into a wizard).

---

## 4. Subsection and tab rules

Written down because the whole value of this plan is in the shape, and shape erodes:

- **A subsection is a question.** Services ("what is connected, and is it healthy?"), Email ("what is
  coming in, and where does it go?"), AI models ("which model answers, and what may it do?"), Companion
  apps ("what do I install?"). Four questions, four subsections. If a fifth subsection is ever proposed,
  the test is whether it is a *different question*, not a different table.
- **A tab is a facet of one question**, and tabs answer *one* question in three or four readings —
  Connected / Available / Needs attention — not four more subjects. This is the mistake the current page
  made: *Add a connector* and *Configuration* are not facets of "are we connected", they are separate
  journeys, and one of them is a mode rather than a place.
- **The tab you came for is the tab you land on**, and the interesting one is a deep link:
  `?tab=attention` and `/c7nc/services/microsoft365?tab=configuration` both work, because the hub, the
  Help documentation and the "Fix this" buttons all need to point at a specific reading.
- **Counts in the tabs, always.** Every tab that can carry a number carries it (`Connected 6`,
  `Needs attention 2`), which is what lets somebody find the problem without opening anything.
- **Five tabs is the ceiling**, and four is comfortable. Beyond that it is a subsection.
- **Use the shared `Tabs` component** (`apps/web/src/components/ui/Tabs.tsx`) — the same strip the
  customer portal, the configuration screens and the ticket boards use, with the pronounced style, the
  counts as pills and the arrow-key behaviour. One tab language in the product, not a fifth variant:
  CloudConnect hand-rolls its own strip today (`CloudConnect.tsx`, the `TABS.map` at line 571), which is
  how the product ended up with two tab styles in the first place.
- **No modal for something with a page.** Today Configuration opens a modal that asks which connection
  you meant; a service page removes the question.

---

## 5. Where every piece today ends up

| Today | After | Notes |
|---|---|---|
| CloudConnect tab *Connected* | Services → **Connected** | Rows, statuses, health tooltip, test/sync/configure/logs/enable/delete unchanged; each row gains **Open** |
| CloudConnect tab *Add a connector* | Services → **Available** (+ the primary "Connect a service" button) | The catalogue cards keep **Walk me through it** and **Fill the form**; being a mode rather than a tab, `Add a connector` also becomes the empty state of Connected |
| CloudConnect tab *Configuration* (modal picker) | **The service's own page**, tab *Configuration* | The modal and its "pick a connection" step disappear |
| CloudConnect tab *AI models* | **AI models** subsection | `AiModelsPanel` moves; PLAN-026's Agent access lands here as a third tab |
| CloudConnect tab *Email connectors* | **Email** subsection | `EmailConnectorsPanel` moves unchanged |
| M365 inactive accounts panel | Services → Microsoft 365 → a tab | It is a property of that connection; its report link and Offboard action go with it |
| FlexPoint options / ledger / invoices | Services → **FlexPoint** → *Configuration / Ledger / Invoices* | The link back to CloudConnect is deleted because the destination is now the next tab |
| C7NC → Outlook Add-in | Companion apps → **Outlook add-in** | Content unchanged; *Installer versions* becomes its own tab |
| Sync logs (per connection) | Service page → *Activity* | Same endpoint, `GET /:id/sync-logs` |
| `/section/c7nc` (generic section landing) | `/c7nc` (the hub) | The group stops needing a fallback page |

---

## 6. Permissions

**Recommendation: no new permissions, and the hub requires none.** Visibility works like this:

| Where | Needs | Why |
|---|---|---|
| The **C7NC** nav group and **Overview** | nothing | It lists what you may open and nothing else; a person with no integration permission sees the Companion apps card only, and that is correct — they can install the add-in |
| **Services** (and a service's Overview/Activity tabs) | `IntegrationView` | Exactly what the fifteen read endpoints already require |
| Changing anything on a service (credentials, options, delete, offboard) | `IntegrationManage` | Exactly what the four write endpoints already require; the buttons are hidden without it |
| **AI models** | `InferenceView` (configuring a connection or making it the application's model: `InferenceManage`) | Already the gate on `/api/inference/*` |
| **Companion apps** | nothing | The download is offered to anyone signed in today and the deployment facts behind it are gated by the API; moving the page must not add a gate |

This *widens* visibility compared with today (the nav block currently demands `IntegrationManage` for a
page whose reads only need `IntegrationView`) and widens nothing else. The rule it follows is the one the
API already applies: **a screen is reachable by whoever may read it, and its controls are gated
individually.** The hub's own filter — "show what you can open" — is the same idea one level up, and it is
worth a document because the alternative (four cards, two of which 403) is what happens by default.

---

## 7. The rename

Measured, not estimated: **230 occurrences of `CloudConnect` / `cloudconnect` across 41 files** in code,
live documentation and probes — excluding history, which must not be rewritten.

| Area | Occurrences | What happens |
|---|---|---|
| `apps/web/src` | **99** | Nav label, page titles, descriptions, empty states, tooltips, Help |
| `docs/` (API.md 12, openapi.yaml 38, api-operations.json 7, SESSION_AUTH_PLAN.md 8) | **65** | API.md and the generated files are renamed (openapi is regenerated, which is where its 38 come from); `SESSION_AUTH_PLAN.md` is a historical plan copy and is left alone |
| `apps/api/probe-*` | **31** | Renamed, because a probe that names a thing should use its name — and one of them (`probe-cloudconnect-status.mjs`, 17) is renamed as a file |
| `apps/api/src` | **25** | The route file, log prefixes, user-facing error strings |
| `packages/shared` | **8** | The landing-page option and the configuration section label |
| `infra/`, `O365/` | **2** | An env example and a comment |

**Renamed:**

- The **nav label and every user-facing string** — the product name becomes C7NC.
- **The page and component names**: `CloudConnect.tsx` → `pages/c7nc/*` (split into the hub and four
  subsection pages as they are built, not renamed blindly).
- **The API mount** `/api/cloudconnect` → `/api/c7nc`, with the old path kept as a **documented alias**
  (see below). Regenerating openapi.yaml and `docs/api-operations.json` follows automatically, because
  the generator derives paths from the mount point in `index.ts`.
- **The route file** `routes/cloudconnect.ts` → `routes/c7nc.ts`, and the exported router name.

**Deliberately not renamed, with reasons that matter more than tidiness:**

| Left alone | Why |
|---|---|
| `BuildNotes.md`, `Retrace.md`, `PlanDocs/**`, `apps/api/src/snapshots/**` | History records what happened under the name it happened under. Rewriting it would make every past entry — and 369 lines of captured audit-log text — untrue, and would put this rename inside the record of ten unrelated changes |
| **`/api/cloudconnect`** | It stays, answering exactly as it does now, as an alias. Integrations and probes call it; an internal rename is not a reason to break somebody's configuration. Documented as deprecated, removed only if a future version says so |
| **`CLOUDCONNECT_LIVE_STATUS_ENABLED`** | An environment/config key. Renaming it silently disables connector verification for every deployment whose `.env` still has the old name — a rename that breaks production config is not a rename, it is an outage (D6) |
| **A stored landing-page value** | `LANDING_PAGES` ([appConfiguration.ts](../packages/shared/src/appConfiguration.ts) line 161) offers `/cloudconnect` as a *saved user preference*, and [Settings.tsx](../apps/web/src/pages/Settings.tsx) line 20 offers the same path. Anybody who chose it keeps a value the new list may not contain, so the redirect has to catch it (it will) and the picker has to show the new label. **Verify during Phase 6** whether the preference is validated against the list on load — if it is, an old value must map rather than fall back silently (D7) |
| **Help's walkthrough anchor** `/help/walkthroughs/cloudconnect` ([HelpDoc.tsx](../apps/web/src/pages/HelpDoc.tsx) line 791, `id: "cloudconnect"`) | A published URL. Keep the id and the path, change the title inside; the Help screen's own links (lines 168, 262, 400, 604) move to the new routes |
| **`docs/SESSION_AUTH_PLAN.md`** | A historical plan copy inside `docs/`; it documents a decision, not the product |

**The guard, because a rename that is not enforced decays within a month:** extend the existing
documentation guard with a check that `CloudConnect` does not appear in `apps/web/src`, `apps/api/src` or
`packages/shared` — outside an explicit allowlist holding exactly two entries (`/api/cloudconnect` alias
and the config key). The repository already has this shape of check (`guard:api-docs`, `guard:routes`,
`guard:config`), so it is a script of twenty lines and a workflow line, not a new discipline.

---

## 8. The mockup

[`docs/mockups/c7nc-merged-hub.html`](../docs/mockups/c7nc-merged-hub.html) — open it in a browser. Seven
screens behind the buttons under the title, drawn inside a real app frame (nav pane beside content):

| Screen | What it settles |
|---|---|
| 1 · Overview | The hub's anatomy (§3), and what "needs attention" reads like as a sentence with a fix beside it |
| 2 · Services | The tab strip, the row anatomy kept exactly, and where **Open** goes |
| 3 · Service detail — FlexPoint | The argument for the merge: connection, options, ledger and invoices as four tabs of one page, with the link back to CloudConnect deleted |
| 4 · AI models | The connected model's actions, and where PLAN-026's *Agent access* lands |
| 5 · Email | Why mailboxes earn a subsection instead of a tab |
| 6 · Companion apps | The installer, the versions table, and the desktop client's honest "Windows only so far" |
| 7 · Navigation, routes & rename | The before/after tree, the full redirect table, what the rename touches and what it must not, and the eight design choices in one column |

It is a mockup of the *interface*, so it is drawn with the application's own compiled stylesheet and its
own class names — the nav items, cards, chips, buttons and tab strip are the product's, not an impression
of them. It was opened in a browser and checked: seven screens switch, one is visible at a time, no
console errors, and the tab strip computes to the same colours as the shipped `Tabs` component.

**What the mockup decided, so the plan does not have to argue it twice:** status before catalogue; four
subsections and not five; a service gets a page; API Access and webhooks stay put and are linked; the
`Open` action on a services row; the fix-beside-the-problem layout in the attention block; counts in
every tab that can carry one.

---

## 9. Phases

Each phase is a commit with a probe, and each is independently revertible.

> **Built so far (2026.10.8.026): Phases 0–5** — phases 0–2 were done in one pass because the section,
> its hub and Services are the same component, and phase 5's Companion apps arrived with it. **Phases 6
> and 7 are outstanding**: the non-UI half of the rename (with its guard) and deleting the last of the
> old page. The service-detail page in Phase 2 is the one piece of a built phase still owed — the
> FlexPoint rows currently lead to `/c7nc/flexpoint`, which is now inside the same section.

**Phase 0 — routes, redirects, nav (≈½ day).** Add `/c7nc` and the four subsection paths; redirect
`/cloudconnect`, `/c7nc/flexpoint`, `/c7nc/outlook-addin`, `/section/c7nc`; move the nav entry out of
Administration into the C7NC group and set its permission to `IntegrationView`; point the redirect's
`?tab=` values at the right subsection. **Acceptance:** every old URL lands somewhere sensible, the nav
shows C7NC to a persona holding only `IntegrationView`, and Administration no longer lists CloudConnect.
**Probe** (`apps/api/probe-c7nc-routes.mjs`): the redirect table asserted row by row from the built SPA's
route list, plus an API check that the old `/api/cloudconnect` path and the new one answer identically.

**Phase 1 — the hub (≈1 day).** Overview: sentence header, needs-attention block fed by the existing
`GET /api/cloudconnect/status`, four subsection cards, signposts. **Acceptance:** an operator with a
broken connection can see it and reach its fix in one click; a persona without integration permissions
sees only Companion apps. **Probe:** the hub's card list for three personas; the attention block's
contents against a seeded failure (a connection with `errorMessage` set).

**Phase 2 — Services and the service page (≈1–2 days).** The tabs, the rows, the catalogue with both
wizards, **Open** → `/c7nc/services/:kind`, and the service page with *Overview · Configuration ·
Activity* built from the existing endpoints (`GET /:id/synced-entities`, `/:id/entity-types`,
`/:id/sync-logs`, `POST /:id/test`, `POST /:id/sync`). FlexPoint's tabs come with it (from Phase 5's
content, which already exists at `/c7nc/flexpoint`). **Acceptance:** test, sync, configure, enable and
delete all still work from the new page, and the configuration modal is gone. **Probe:** the six row
actions still call the same endpoints; a persona without `IntegrationManage` sees the read tabs and none of
the write buttons.

**Phase 3 — AI models (≈½ day).** `AiModelsPanel` onto its own page with *Connected · Available ·
Assistant*. **Acceptance:** model connect/test/activate still work; the Assistant link lands on
`/assistant`. **Probe:** the existing AI probes still pass unchanged (they are API-level, which is the
point), plus a UI check that the panel is reachable by `InferenceView`.

**Phase 4 — Email (≈½ day).** `EmailConnectorsPanel` onto its own page with *Mailboxes · Routing ·
Activity* (Routing and Activity are thin; if Activity has nothing to show yet it is not built — a tab
that says "coming soon" is worse than four tabs).

**Phase 5 — Companion apps (≈½ day).** The add-in installer and its versions table onto the Apps page;
the desktop client's honest state; FlexPoint's business content onto its service page. **Acceptance:** the
installer downloads from the same endpoints, the versions table still reports the running build, and
`C7NCFlexpoint`'s functionality is reachable in the new place with nothing lost.

**Phase 6 — the rename (≈1 day).** The 230 occurrences in code, live docs and probes; the alias on
`/api/cloudconnect`; openapi and `api-operations.json` regenerated; the landing-page option and the
configuration section label; the Help walkthrough retitled with its id and path kept. Then the guard.
**Acceptance:** the guard passes; `grep` finds `CloudConnect` in `apps/**` only inside the allowlist.
**Probe:** the alias and the new path answer identically; `guard:api-docs`, `guard:routes` and the Help
link check all pass.

**Phase 7 — delete the old page and the second name (≈½ day).** Remove `CloudConnect.tsx` and its tab
machinery, remove the redirect for `/c7nc/flexpoint` once it has a home (§7 keeps `/cloudconnect`
permanently as the alias, but the interim in-section redirects can go), and update the Help index and
`docs/API.md` §9. **Acceptance:** no orphan imports, the build and typecheck are clean, and the Help link
check passes.

---

## 10. Costs and risks

- **The rename is the bulk of the risk, not the layout.** A missed string is a cosmetic bug; a missed
  *route*, *stored value* or *config key* is a broken bookmark, a lost landing page or a silently disabled
  feature. §7 names all three, and the guard is what keeps them named.
- **Two names for a while.** Phases 0–5 ship with "CloudConnect" still in Help text and API docs; that is
  deliberate (one page moving at a time) but it has a deadline, and Phase 6 is it.
- **Redirects are the part people notice.** They are tested by a probe over the built route table rather
  than by clicking, because the failure mode is "the one URL nobody clicked".
- **Component moves are not rewrites.** If moving `AiModelsPanel` or `EmailConnectorsPanel` turns into
  editing them, the phase has gone wrong: those panels work, and this plan is a filing change.
- **The eye is the acceptance test for a layout**, which is why the mockup exists before the code and why
  the plan asks for a live walkthrough (§12) rather than only probes.

---

## 11. Decisions to freeze

| # | Decision | Recommendation | If taken the other way |
|---|---|---|---|
| **D1** | Does C7NC survive as the name? | **Yes** — one name, CloudConnect retires | Keeping "CloudConnect" as the *label* of the Services subsection is defensible for continuity, and would make the rename half as large; but two names for one place is what produced this request |
| **D2** | A hub, or Services as the landing page? | **A hub** (§3) | Landing on Services is simpler and loses the "is anything broken?" answer; the mockup's screen 1 is the argument |
| **D3** | How many subsections? | **Four** + Companion apps; five tabs maximum inside any of them | Email could stay a tab of Services. It moves because the question is different in kind, and mailboxes are looked after by different people |
| **D4** | API Access and webhooks | **Stay in Administration, linked from the hub** | Moving them into C7NC would make the section the honest home for "everything that connects", at the cost of moving two permissions' worth of screen |
| **D5** | A page per service? | **Yes** — `/c7nc/services/:kind` | Keeping the Configuration modal is less work now and leaves the FlexPoint split half-fixed |
| **D6** | Environment/config keys | **Not renamed** (`CLOUDCONNECT_LIVE_STATUS_ENABLED` stays) | Renaming is tidy and risks disabling connector verification on deployments whose `.env` was not updated |
| **D7** | A stored landing-page value of `/cloudconnect` | **Redirect catches it; the picker shows the new label**; verify whether the value is validated on load, and map rather than fall back if it is | If validation silently falls back to the Dashboard, somebody's preference disappears without a message — which is the one outcome worth spending an hour avoiding |
| **D8** | The API path | **`/api/c7nc` canonical, `/api/cloudconnect` kept as a documented alias** | Renaming outright is a breaking change for integrations and probes for no functional gain |
| **D9** | Historical records | **Not rewritten** (BuildNotes, Retrace, PlanDocs, snapshots) | Rewriting them would make past entries untrue and would put this rename into the history of unrelated changes |

---

## 12. Verification

1. **The redirect probe**, over the built route table and the API alias — the failure mode is the URL
   nobody clicked, so it is asserted rather than sampled.
2. **Persona checks** for the hub, Services and a service page: a reader (`IntegrationView`), a
   configurator (`IntegrationManage`), and someone with neither — each sees the right cards, tabs and
   buttons.
3. **The existing probes untouched**: the connector-status, catalogue, setup and M365 probes must pass
   without editing their assertions (the API is not changing), which is the check that this stayed a
   filing change.
4. **The guards**: `guard:api-docs`, `guard:routes`, `guard:config`, the Help link check, and the new
   no-CloudConnect-in-code check.
5. **A live walkthrough** in the running application: break a connection and fix it from the hub; open
   FlexPoint and complete a sync without leaving its page; install the add-in from Companion apps; set a
   landing page to `/cloudconnect` first and confirm you still arrive somewhere sensible.
6. **The eye**: the mockup's seven screens beside the seven built ones.

---

## 13. What this plan is not

- **Not an API change.** Not a path, a permission, a payload or a table — beyond the alias and the
  regenerated documentation.
- **Not a reorganisation of Administration.** Everything else stays where it is; this plan removes exactly
  one entry from it.
- **Not a design-system change.** It uses the `Tabs` component, the card, the chip and the button the
  product already has, which is why the mockup could be drawn with the shipped stylesheet.
- **Not a rewrite of the connector work.** The catalogue, the wizards, the setup plans, the health model
  and the sync history are the parts that were expensive to build and they are moved, not revisited.
- **Not the place for PLAN-026's policy editor.** It lands on the AI models page afterwards, and if both
  are scheduled the order in this plan's header is the cheaper one.
