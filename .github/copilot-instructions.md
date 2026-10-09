# Repository Change Logging

- Log every user prompt in `Retrace.md`, including questions, investigations, operational requests, and prompts that result in no code change. Append the next sequential Prompt number and preserve the user's prompt text verbatim in a blockquote. Follow the existing timestamp, status, duration, changes, and BuildNotes ID format.
- For every completed project change, add a dated, versioned entry to the root `BuildNotes.md`. Use `node scripts/next-version.mjs` to obtain the next version; do not manually guess the date or build number. Include concise `[New]`, `[Update]`, or `[Fix]` bullets and verification where relevant.
- The root `BuildNotes.md` is the source of truth for What's New. After changing it, run `node scripts/generate-buildnotes.mjs` to refresh `apps/web/public/BuildNotes.md` and `apps/api/src/BuildNotes.json`. Do not edit those generated files directly. The live What's New page reads BuildNotes through the API.
- Include the corresponding BuildNotes version in each Retrace entry for a project change. For prompts with no project change, log the prompt in Retrace and state that no BuildNotes entry applies.
- Before finishing a task, verify the new BuildNotes entry appears at the top, the generated fallbacks match it, and the prompt has been recorded in Retrace.

# The API Document Is Part Of The Change

The API has a generated specification (`docs/openapi.yaml`) and a written guide (`docs/API.md`), and both are part of the change that alters the API rather than a follow-up to it.

- Whenever a **route, its permission, its auth, or its request/response shape** changes, run `node scripts/generate-openapi.mjs`, then `node scripts/check-api-docs.mjs`. A new or changed operation that deserves prose a parser cannot invent (a summary, an example, a note about behaviour) gets its entry updated in `docs/api-operations.json`, keyed by `METHOD /path`.
- `node scripts/check-api-docs.mjs` (also `pnpm guard:api-docs`) fails when the document is behind the routes, when it documents an operation that no longer exists, and when a curated entry names a route that has been renamed or removed. Run it after any route change, alongside `check-route-guards.mjs`.
- The guide carries the maintenance rule in its §13 and is the place to explain a new capability to whoever is connecting an external system to this one — the RMM, SIEM and event-gateway recipes, the API-key model, the webhook signature. If a change alters how an integrator authenticates, pages, is rate limited or receives events, this file changes in the same commit.
- API keys and the event gateway are user-facing surfaces too: `Administration → API access` (`apps/web/src/pages/ApiAccess.tsx`) and the `api-access` Help walkthrough must stay true to the API at the same time.

# In-App Help Is Part Of The Change

The product ships its own documentation at `/help` (`apps/web/src/pages/HelpDoc.tsx`). It is written by hand, so it drifts unless updating it is treated as part of the change rather than as a follow-up.

- Whenever a feature is added, changed, or removed, decide whether the Help section needs to change, and make that change **in the same commit**. The rule in full is at the top of `HelpDoc.tsx`: update the feature's walkthrough (or add one), its rows in the `index` section, the `configuration` reference if a setting or flag is involved, and `faq` if a user would plausibly ask about it.
- A new walkthrough is reachable as soon as it is a section in `HELP_SECTIONS` — the route is `/help/walkthroughs/:slug`, so no route or menu change is needed. It must still be listed in the Index, which is where people look for something they cannot name.
- `node scripts/check-help-links.mjs` fails when a help link points at a route that does not exist or a walkthrough is missing from the Index. Run it after any Help change, and after any change that renames a route.
- A change to a feature flag, an environment variable, a default, or a user-visible limit is a Help change: the flags table in the `configuration` section is the reference users are pointed at.

# Two Interfaces, Two Designs

The application has two interfaces, and `useRedesign()` (from `hooks/useNavigationStyle`) says which one is in use. They are **two designs of the same screen, not one screen with a class toggled**: the modern interface is built from the redesign's own furniture (rails, tabs, pills you press, sheets, a status track you step along, sentences beside the control that acts), and the classic interface is a form — labelled fields in a grid, a dialog with a heading and Save/Cancel, a select where the modern screen has a segmented control.

- **Every interface change is designed for both, individually.** A new dialog, panel, detail view or control gets a modern arrangement and a classic arrangement; the shared part is the state, the API call and the words, never the layout. `components/CloseTicketDialog.tsx` and `components/PurchaseOrderDialog.tsx` are the pattern: one component, one set of handlers, two returns, with the reason for each arrangement written at the top of the file.
- The modern branch is `if (redesign) { … }` and it is not allowed to be a restyle of the classic one. If the two would come out identical, the feature is probably a shared component (`components/ui/*`) and belongs there instead — but say so in the comment rather than leaving the reader to guess.
- Verify a change in **both** interfaces before calling it done: `localStorage.setItem("c7_ui_redesign", "0")` is the classic screen, `removeItem` returns the browser to the instance's default. Take the screenshot of both.
- Anything the classic interface keeps that the modern one deliberately drops (or the other way round) belongs in the Help walkthrough, because it is a difference the user will notice.