# PLAN-028 — The C7NTAX console and CLI: running commands against the application

> **Sequence:** filed 2026-10-08, at the operator's request: *"We will be creating a console/shell that
> commands can be run to control C7NTAX."* The header icon went in place as a placeholder
> (BuildNotes 2026.10.8.029) and is live as of 2026.10.8.038 — a labelled **Console** button with the
> popup, the `/console` page, the `c7ntax` CLI and the command catalogue behind it.
> **What it is:** a **command surface for the application** — a typed grammar (`ticket show 1001`) parsed
> against the same action manifest PLAN-026 defines, executed through the same routes, under the same
> permissions, with the same audit. Not a new capability and not a second authorization model: a
> **deterministic front end to operations that already exist**, where the assistant is the natural-language
> one.
> **Three front ends, one grammar:** the in-app console (header icon → overlay, plus `/console`), an
> external `c7ntax` CLI authenticating with an API key, and — later — the MCP server of PLAN-025. One
> parser in `packages/shared`, so they cannot drift.
> **The load-bearing dependency is PLAN-026 Phase 1**, not this plan: the command catalogue is *generated
> from the action manifest*, and hand-writing it would produce exactly the second, drifting list PLAN-026
> §5 exists to prevent. Everything here is cheap once that manifest exists and fragile before it does.
> **Cost when taken:** one shared module (grammar + catalogue projection + **completion engine**), one
> web surface, one small CLI package, one read-only API endpoint, one guard script. No schema change, no
> new permission, no migration. Phased in §15; phases 0–2 (a read-only console that really works, with
> completion) are ~5 days.
> **Cost to revert:** set `CONSOLE_ENABLED=false` and the header icon disappears and the route stops
> being served — every existing screen, route, assistant function and proposal is untouched, because the
> console adds no route of its own to the write surface.
> **Depends on:** PLAN-026 (manifest, tiers, executor — **Phase 1 unbuilt**), the permission enum
> (`packages/shared/src/enums.ts`), the route enumeration in `scripts/check-route-guards.mjs`, the API-key
> route (`routes/apiKeys.ts`, already permission-scoped), and the configuration registry of PLAN-021.
> **Next action:** freeze §14 (D1–D11), then build Phase 0 (the grammar, in `packages/shared`, with its
> parser tests) — which is useful before the manifest exists and required after.
>
> **Built (2026.10.8.038) — phases 0 and 1, the in-app console.** `packages/shared/src/console/` holds
> the grammar, the catalogue, the parser, the completion engine and the request builder; the header icon
> now opens a **popup** console (the operator asked for a popup with the application's own border
> treatment rather than §10's bottom-docked drawer — the frame is the only deviation, the keys and the
> grammar are as specified); **85 read commands** across 15 of §12's groups, every one verified against
> the routes by `pnpm guard:console`, which also runs in the Security Gate; `GET /api/console/catalog`
> and `/catalog/:name` serve the same catalogue, permission-filtered, for the CLI to come; and the
> writes are refused with §7's message rather than half-built. Two things changed on contact with the
> code: the catalogue is **hand-written for reads** rather than generated (the enumeration gives paths,
> not verbs, and §7 blesses read descriptors either way — the guard is what keeps them honest), and the
> application's statuses are the enum's (`new`, `in_progress`, …), so §12's `--status open` example does
> not exist — completion now offers the real ones. Phases 2+ (writes, the CLI, the cross-links) are
> unchanged and still wait on PLAN-026's manifest.
>
> **Built (2026.10.8.043) — the permission, and the two switches that use it.** D4 and §19 said the
> console would add **no permission of its own**, on the argument that a command is already authorized by
> the route it names. The operator asked for the opposite, and they are right: *"the console icon
> shouldn't even be displayed, if they don't have permissions to it"* is a question a per-command
> permission cannot answer — it could only be answered command by command, after the surface was already
> on screen. So there is now **`console:use`**, in its own permission category, granted to Manager,
> Technician, Dispatcher and BillingManager and deliberately not to the client-facing or read-only
> roles; both catalogue routes carry `requirePermission(Permission.ConsoleUse)` and the route-guard
> exemption the two open routes needed is gone (439 routes, 388 guarded). On top of it, two switches
> withhold it: **`User.deniedPermissions`** (per person, subtractive, edited in Users & Roles) and
> **`Company.consoleEnabled`** (per client, on the client's own record, needs `system:config`). All of it
> resolves in one place — `effectivePermissions` in the auth middleware — so a client with the console
> off is indistinguishable, to every screen and route, from a person who was never granted it, and both
> take effect on the next request. `apps/api/probe-console-access.mts` exercises the four gates in order
> (22 checks). The icon also stopped being an unlabelled prompt glyph: it is a labelled `SquareTerminal`
> beside Search, because a bare glyph read as decoration beside five labelled neighbours.

> **Built (2026.10.8.045) — how the output reads, and a pop-up you can size.** The operator's words were
> *"resizeable … the output should be presented in a more readable and easier to understand format"*, and
> the screenshot behind them was a `client show` printing seventeen lines of field name followed by
> nothing. §10 specified a drawer and never said how a result is drawn; this is the answer. A **single
> record** is now a labelled list — the fields the command declares first, spelled the way a person says
> them (`companyType` → *Company type*), timestamps as dates, booleans answered — with every other field
> the route sent one click down under *"n other fields, m of them empty"*, because "we hid it" and "it is
> empty" are different answers. A **list** hides a column that holds nothing in any row, and says how many
> it left out. **Basic and Advanced**, in the header, are the two readings of one result: basic is that
> formatting, advanced is the console exactly as it printed before it learned any of it — the route's own
> field names in the route's own order, every declared column whatever it holds, raw timestamps and
> `true`/`false` — and the mode is applied when a result is *drawn* rather than when it is fetched, so
> switching it redraws the scrollback and one result can be read both ways without running it twice. The
> descriptors themselves were wrong in one place and that is fixed at the source: the
> client noun asked for `shortName`, `status` and `type`, none of which a `Company` row carries, so
> `client list` printed three em dashes per row and `client show` reported a record as mostly empty —
> it now names `name`, `clientId`, `companyType`, `isActive` and friends. The pop-up resizes by its right
> edge, its bottom edge or the corner, remembers the size in the browser, resets on a double-click and
> nudges with the arrow keys; the record card turns into two columns once the panel is wide enough, which
> is why the panel's width is measured rather than the window's.

---

## 1. What this is for, and what it is not

The operator's sentence is worth taking literally: *"a console/shell that commands can be run to control
C7NTAX."* Three things follow, and one that does not.

**It is for:**

| Purpose                                                                                                              | Why a command beats a screen                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Doing the same thing to many things** — 40 tickets reassigned, 12 users offboarded, a report run per client        | A screen is a form for one row; a command is a loop. Today this is either clicks or a one-off script against the API with a hand-rolled token                                  |
| **Doing a thing exactly** — the same operation, the same flags, the same result, next month                          | The GUI is for discovery, the console is for repetition. "How did we do that last time?" becomes a line in a text file                                                         |
| **Teaching the API without the API**                                                                                 | A command line *is* documentation you can run, and its `help` is generated from the routes rather than written beside them                                                     |
| **Checking the estate quickly** — `connection test flexpoint`, `alert list --open`, `kumo password stale --days 180` | The questions an MSP asks first thing in the morning are queries, not pages                                                                                                    |
| **Giving the model a ground truth**                                                                                  | When the assistant proposes an action, the console shows **the command it is equivalent to** — which makes the proposal readable and reviewable instead of a JSON payload (§4) |

**It is not:**

- **Not a shell.** No pipes, no redirection, no arbitrary code, no `eval`, no SQL, no file system, no
  process control, no `sudo`. Every word it understands is in the catalogue (§12) and every effect is an
  API route. This is a control surface, not a scripting language, and the distinction is what keeps it
  auditable.
- **Not a bypass.** `console:use` opens the surface; it does not widen it. Every command is authorized
  by the same `requirePermission` the screen and the API are authorized by, and if you cannot do it in
  the app you cannot do it here (§6, D4 — amended 2026.10.8.043: the surface itself carries a
  permission, see the status note above).
- **Not a replacement for any screen.** Nothing is removed as part of this, which is also why it can be
  turned off without a migration.
- **Not an MCP server, and not the assistant.** PLAN-025 exposes actions to *other* AI clients;
  PLAN-026 lets a model *choose* them; this plan lets a **person type them**. All three ride one manifest
  and, once this exists, one executor — which is the whole economic argument for doing it (§17).

---

## 2. The honest starting point

Four findings from the code, all of which shape the plan.

**Finding 1 — there is no CLI, no console, and nothing that parses a command.** No `apps/cli`, no
`packages/cli`, no console route, no command grammar anywhere in the workspace. `scripts/*.mjs` are
developer tools (`next-version`, `generate-buildnotes`, `check-route-guards`); they run with `node`, talk
to the file system, and cannot touch the API. So this is a new surface, not a surface to extend — with the
single exception of §3.

**Finding 2 — the operations it will run already exist, uniformly.** Re-measured for this plan with the
same enumeration `scripts/check-route-guards.mjs` uses: **437 route declarations across 48 files — 187
reads and 250 writes** (POST 164, PATCH 44, DELETE 37, PUT 5), every one of them behind
`requirePermission`, with **108 permissions** in `packages/shared/src/enums.ts`. A command is a *name* for
one of those, which is why the catalogue can be generated rather than written (§7).

**Finding 3 — the catalogue is the real dependency, and PLAN-026 does not have it yet.** PLAN-026 §5
defines a descriptor per mutating route (`name`, `permission`, `tier`, `description`, `params`, `preview`,
`inverse`) generated by a script and tiered by hand, and PLAN-026 Phase 1 is the phase that builds it —
**unbuilt**. Until it exists, this plan's catalogue would be a second list, maintained by hand, that
disagrees with the manifest the moment anybody adds a route. So: the *grammar* and the *read* commands
can be built now; the *write* commands wait for the manifest, and §7 says why that ordering is not
negotiable.

**Finding 4 — PLAN-026 already uses the word "Console" for something else, and this plan should
surrender the word or take it.** PLAN-026 §11 proposes renaming the assistant page to "Console" ("Assistant
→ Console"). That is a different surface: a prompt box, model output and action cards. Two things called
Console in one application is a certainty of confusion, and the operator's usage here is the more literal
one. **Decision D11: "Console" means the command line. The assistant page stays "Assistant".** PLAN-026 §11
gets a one-line correction when this lands.

---

## 3. The one thing that already exists: the command palette

`Ctrl/⌘ K` opens `components/CommandPalette.tsx`, which searches **pages** and **actions that navigate**.
It is the closest thing in the product to what this plan builds, and the relationship should be
deliberate rather than accidental:

|            | Command palette (exists)                          | Console (this plan)                                 |
| ---------- | ------------------------------------------------- | --------------------------------------------------- |
| Input      | Fuzzy search over a fixed list                    | `noun verb subject --flags`                         |
| Result     | Navigate, or open a screen with a form pre-filled | **Perform** the operation, or explain why it cannot |
| Catalogue  | Hand-kept list in `Layout.tsx`                    | Generated from the action manifest (§7)             |
| Extent     | ~30 entries                                       | Every permitted action (§12)                        |
| Reversible | Nothing happens to data                           | Writes are real, and audited                        |

**The rule between them:** the palette *goes somewhere*; the console *does something*. Where a palette
entry would create a record, it should eventually offer "run this in the console" (`ticket create --client
…`) so the two are two ends of one thing — the palette for people who do not know the words yet, the
console for people who do.

---

## 4. One grammar, three front ends

```
                     packages/shared/src/console/
                     ├── grammar.ts     parse a line → { noun, verb, subject, flags }
                     ├── catalogue.ts   CommandDescriptor types, lookup, prefix resolution
                     ├── render.ts      a descriptor + args → the command line (the inverse of parse)
                     └── errors.ts      typed failures: unknown, ambiguous, denied, needs-confirm
                                │
        ┌───────────────────────┼────────────────────────┐
        │                       │                        │
  apps/web console        apps/cli (c7ntax)        (later) PLAN-025 MCP
  session cookie          API key                  the same descriptors
  overlay + /console      terminal, scripts         as tool names
```

**Why shared and not per front end.** The failure mode of every CLI is drift: the shell learns a verb the
app does not have, or a flag the route renamed a year ago. One parser, one catalogue and one set of
errors means the CLI's `help`, the app's `help`, the MCP tool list and the assistant's "equivalent
command" line are **the same data**. It also means the grammar is unit-testable in one place (~200 parser
cases, no HTTP, no database — verification §16).

**`render.ts` is deliberate and small.** Given a descriptor and arguments it produces the command line —
which is what lets an assistant proposal, an audit row, or a support conversation print *"what was run"*
in the operator's own language:

> Approved action `ticket.create` → *"this is the same as `ticket create --client northwind --contact
> "David Chen" --board msp --subject "Laptop will not boot""*

---

## 5. The grammar

Kept small on purpose: **one shape, learned in a minute, that covers 250 operations.**

```
<noun> <verb> [subject] [--flag value] [--flag]
```

| Part        | Rule                                                                                                                                                                                | Examples                                                                                                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Noun**    | One per module, matching the API's own grouping                                                                                                                                     | `ticket`, `client`, `contact`, `board`, `asset`, `invoice`, `quote`, `expense`, `report`, `user`, `role`, `connection`, `kumo password`, `kumo asset`, `service alert`, `api key` |
| **Verb**    | Small closed set: `list show create update delete archive restore assign status note comment time attach contact run send approve reject sync test enable disable link reveal help` | `ticket list`, `ticket status 1001 closed`                                                                                                                                        |
| **Subject** | Optional; anything that resolves to one record — and **resolution is the interesting part**                                                                                         | `ticket show 1001`, `ticket show MSP-1001-1009`, `client show northwind`, `client show "Northwind Traders"`, `user show sam@…`, `me`                                              |
| **Flags**   | Generated from the descriptor's `params` (the route's own validator where one exists), plus the universal ones in §9                                                                | `ticket list --status open --assignee me --limit 50`                                                                                                                              |

**Resolution rules** (the difference between a console that is pleasant and one that guesses):

- Numbers, ticket numbers, slugs and ids all work for the same record: `1001`, `MSP-1001-1009`,
  `northwind-traders`.
- Names are matched the way PLAN-026 Phase 0's `find_people` already does it — **every word must appear**,
  so `"David Chen"` works across separate first/last columns.
- **Ambiguous is an error, never a choice.** Two clients matching `acme` produces a list with enough
  context to disambiguate, exit code 3, and the instruction to be specific — the same rule the assistant
  was given. A console that silently picks the first match is a console that writes to the wrong client.
- **Not found suggests.** `client show northwi` → *"No client matches `northwi`. Closest: Northwind
  Traders, Northwind Logistics — `client list --search northwi`."*
- **A record you may not see is "not found", not "forbidden".** Existence is not leaked
  (PLAN-026 §2.1's scoping rules; `ticket:view_all` is what widens it).

**Quoting, comments, aliases:**

| Feature                    | Behaviour                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Double quotes              | Preserve spaces and empty values: `--subject "Laptop won't boot (again)"`                                                                               |
| Single quotes              | Same, no interpolation — there is no interpolation, and there is no `$VAR`                                                                              |
| `#` at the start of a line | A comment; ignored (so a command file can be documented)                                                                                                |
| Blank line                 | Ignored                                                                                                                                                 |
| `;`                        | Separator for two commands on one line, executed in order, **stopping at the first failure**                                                            |
| `alias`                    | Per-user shorthands for a noun-verb: `alias t=ticket`, then `t list`. Saved locally, never server-side (D9)                                             |
| Unambiguous prefix         | `tick list` works if `tick` is unambiguous; ambiguous prefixes are refused with the candidates                                                          |
| `help`                     | `help` alone lists nouns; `help ticket` lists the noun's verbs with permissions; `help ticket create` shows the descriptor, flags and a preview example |
| `?`                        | Shorthand for `help`                                                                                                                                    |

**Grammar that is deliberately not there:** no pipes, no `>`, no `&&`, no variables, no arithmetic, no
subcommands of subcommands, no positional blocks that mean different things per verb. Anything that needs
a language is a script in the operator's own shell calling `c7ntax` (§11), where they already have one.

### 5.1 Autocomplete — the PowerShell behaviours, specified

**The requirement, stated as a reference point:** the console completes the way **PowerShell** does —
not the way a browser autocomplete box does. That means four distinct behaviours working together, all
driven by the same catalogue: **cycling completion** (`Tab`), a **menu with descriptions**
(`Ctrl+Space`), **inline prediction from your own history** (ghost text, accepted with `→`), and
**value completion that asks the application what exists** (`--client <Tab>` lists real clients, not a
guess). PowerShell gets this from per-parameter argument completers and PSReadLine; the equivalent here is
the descriptor (§7), so completion is *generated*, never hand-maintained per command.

#### The four completion modes

| Mode           | Key                                                                | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Complete**   | `Tab`                                                              | Completes the word under the cursor **in place**, replacing the partial word, extended to the **longest common prefix** first and then cycling **forward** through candidates on each further `Tab`. `Shift+Tab` cycles backward. Wraps at the ends. This is exactly `TabExpansion2`'s cycle: `tick<Tab>` → `ticket`, `ticket c<Tab>` → `ticket contact` / `ticket close` / … on repeat                                                                                                                                                                |
| **Menu**       | `Ctrl+Space`                                                       | Opens the candidate list **under the line** — arrow keys (and `↑`/`↓`) move the highlight, `Enter`/`Tab` accept, `Esc` dismisses and restores the original word. **Every entry carries a one-line description**: a verb shows what it does, a flag shows its help and type, a value shows the record (client name + short name, ticket number + subject, connection + provider). This is PSReadLine's `MenuComplete`, including its tooltip on the highlighted parameter — the feature that makes a 250-command surface learnable instead of memorised |
| **Prediction** | `→` accepts, `Ctrl+→` accepts one word, `F2` toggles inline ↔ list | **Inline history prediction**: as you type, the rest of a line **you have run before** appears as dimmed ghost text after the cursor. `→` at end of line accepts it; `Ctrl+→` takes one word at a time. `F2` switches to a list form (PowerShell's inline vs list view). **Only your own history** — never a colleague's, never "popular commands" — and the full list is browsable with `↑` after typing a prefix, exactly as PSReadLine shows it                                                                                                     |
| **Discover**   | `?` or `h`, or `F1`                                                | The full `help` for the highlighted/current candidate **without losing the line**: `help ticket create` for a verb, the flag's schema for a parameter, the descriptor for a command. PowerShell's `Get-Help` without leaving the prompt                                                                                                                                                                                                                                                                                                                |

**`Ctrl+R`** stays what §10 says it is (reverse incremental search over history, match highlighted), and
`↑`/`↓` walk history when no menu is open — PowerShell's `HistorySearchBackward` and the prediction list
share the keys by context, which is why the menu is an explicit mode rather than a hover.

#### What each position completes — and from where

| Position                      | Candidates                                                                                                                                                                                                                                                                                            | Source                                                                                                    | Latency                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1st word                      | **Nouns**, plus the console's own verbs (`help`, `context`, `history`, `alias`, `set`, `clear`, `ask`, `show`, `doctor`, `version`, `script`, `exit`)                                                                                                                                                 | The catalogue, filtered by permission                                                                     | Local, instant                                |
| 2nd word                      | **Verbs** for that noun, each with its description                                                                                                                                                                                                                                                    | The catalogue for the noun                                                                                | Local, instant                                |
| 3rd word (the subject)        | Whatever the verb takes: ticket numbers and subjects, client names, contact names, board keys, user names, report names, asset names                                                                                                                                                                  | **The live API** (`ticket list`, `client list`, …), through a warm cache                                  | Cached                                        |
| `--` prefix                   | **Flags** for that verb, with types and help; `--status <Tab>` completes the **values** the board actually offers, `--priority` the enum, `--assignee` real users, `--client`/`--contact` real records, `--board` real boards, `--connection` configured connections, `--type` real integration types | The descriptor's `params` (enum lists come from the route's own validator), plus the API for record lists | Local for names and enums, cached for records |
| Anywhere after `--flag value` | The next flag, or nothing if the line is complete                                                                                                                                                                                                                                                     | The descriptor                                                                                            | Local, instant                                |
| Filenames                     | **Only for `--file`, `--out` and `--receipt`** — and only in the **CLI**, where a shell and a real path exist (§11)                                                                                                                                                                                   | The file system                                                                                           | Local, instant                                |

**Case-insensitive, and it completes the word under the cursor** — not the last word — preserving
everything to the right of it. Completing into the middle of a line is the common case when a flag was
forgotten (`ticket <Tab>` after typing `ticket 1001` re-opens the verb position, and accepting inserts
without clobbering `1001`), so it is specified rather than left to the implementation.

**Quoting is automatic, in one direction only:** a candidate containing a space or a quote is inserted
quoted and escaped (`client show "Northwind Traders"`), because that is what the grammar requires and
what a person would otherwise have to remember. The reverse never happens — a free-text flag
(`--subject`, `--body`, `--note`) is **never** completed or quoted, since guessing at prose is worse
than leaving it alone.

#### Rules, because a completion engine is where consoles get unpleasant

| Rule                                                                                                                                                                                                                                                                                                                                                                          | Why                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Permission-filtered at the source.** Candidates come from `/api/console/catalog` and the same filtered lists the app uses, so you cannot complete your way to a command you cannot run, and `Tab` after `role ` offers nothing if `role:manage` is not yours                                                                                                                | §8's rule ("no client-side permission checks that decide anything") is not violated by *hiding* candidates — the route still refuses — but showing impossible commands is a lie the console should not tell. `help --all` is the one place that lists them, marked "not available to you" |
| **Never a blocking network call on a keystroke.** Local candidates are answered synchronously (<16 ms); record candidates come from a **warm cache** loaded when the panel opens and refreshed in the background every 5 minutes (and on `context`/`refresh`). A cold cache completes what it has and prints `loading clients…` under the menu rather than freezing the input | A console that stutters while you type is a console nobody types in. Motion on the network path is what makes completion feel broken                                                                                                                                                      |
| **Stale is labelled, never hidden.** If the cache is older than 5 minutes the menu shows `cached 6m ago`, and completing a value that no longer exists still fails cleanly at the route (§9's exit code 3 with the route's words)                                                                                                                                             | A cached `Northwind Traders` that was renamed ten minutes ago should not look like a live answer                                                                                                                                                                                          |
| **No secrets, ever.** Secret-valued flags are never completed from data, never predicted from history, and commands that can return a secret are excluded from prediction entirely (§8)                                                                                                                                                                                       | A completion that reveals a password, or a history prediction that replays one, is the worst possible bug in this feature                                                                                                                                                                 |
| **Deterministic ordering.** Candidates are sorted by the catalogue's `GROUP_ORDER`, then alphabetically within a group; never by frequency, recency or "relevance"                                                                                                                                                                                                            | A list that reorders itself is a list you cannot learn. Frequency ranking is where completion becomes a slot machine                                                                                                                                                                      |
| **Ambiguity is shown, not resolved.** `Tab` on `t` extends to whatever `t`, `ti`, `tic` share (`ticket`, `time`, `theme` share only `t`), and the menu — not a guess — is how you choose                                                                                                                                                                                      | §5's rule, applied to the keyboard: the console never picks                                                                                                                                                                                                                               |
| **`Tab` completes while the console input has focus; `Esc` leaves the console.** The input behaves like a terminal, not like a form: focus does not move out on `Tab`, and the panel says so once (`Tab completes · Esc closes · ? for help`)                                                                                                                                 | This is the one place the console deliberately breaks web convention, because every terminal user's fingers expect it. The hint is what makes it discoverable rather than surprising, and `Ctrl+Tab` is left untouched for anybody who needs it                                           |

#### The CLI completes too, and it is its own completer

`c7ntax completion bash|zsh|pwsh` generates a shell script from the **live catalogue** (§11 — so
completions cannot go stale), and that script calls back into the CLI:

```
c7ntax _complete --line "$COMP_LINE" --point $COMP_POINT      # returns candidates, one per line
```

Three reasons to route it through the CLI rather than baking candidates into the generated script:
the catalogue is **permission-filtered per key**, so completion in a terminal respects that key's scopes;
there is one implementation of "what goes here" for all three shells and for the in-app panel; and a
client can cache the catalogue in `~/.c7ntax/cache` so completion is instant offline (with the same
staleness labelling). PowerShell gets a proper `Register-ArgumentCompleter` script block with
**descriptions** (its `CompletionResult` takes `ToolTip`), so the menu view shows our help text — the one
place the CLI can match the reference behaviour exactly rather than only approximately.

**Latency budget for the CLI:** completion must return within **150 ms** or the shell will feel broken;
the catalogue and record caches are read from disk with a network refresh in the background, and a cold
cache returns what it has (with the same `cached …` note) rather than waiting.

#### What completion deliberately will not do

| Not offered                                                                         | Why                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Path completion in the app (only `--file`/`--out`/`--receipt`, and only in the CLI) | There are no user file paths in a browser console; a path completer there is a fiction                                                                                                |
| Variable, expression or wildcard completion                                         | §5: there are no variables and no globs. Nothing to complete                                                                                                                          |
| Completion of arbitrary JSON/`--file` contents                                      | The file's *schema* is validated by `report designer validate` (§12.11), which is a command, not a completion                                                                         |
| "Smart" completions inferred from what you might mean (model-assisted suggestions)  | The console's value is that it is the **deterministic** surface (§1). `ask` is the place for inference, and mixing the two is how a console becomes a suggestion box you cannot trust |
| Shared or organisation-wide history prediction                                      | Prediction reads **your** history (§5.1's third mode). A console that predicts a colleague's commands is a leak with a friendly face                                                  |

**Build note:** the completion engine is a **pure function of (line, cursor, catalogue, cache)** in
`packages/shared/src/console/complete.ts`, returning `{ candidates, replaceFrom, replaceTo, commonPrefix }`.
That is what makes it unit-testable (~120 cases: each position, quoting, mid-line, ambiguity, permission
filtering, cache staleness, secret exclusion) and reusable by three front ends — and it is why completion
is in Phase 0 rather than bolted on after the console works.

---

## 6. Where a command is executed

**Recommendation: parse where the person is; execute through the real route, as the caller.** No new
execution endpoint, and no second authorization surface.

| Step         | In-app console                                                                | CLI (`c7ntax`)                                                                                               |
| ------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Authenticate | The existing session cookie (and the existing idle timeout)                   | An API key, which already acts as its owner with `ownerPermissions ∩ key.permissions` (`middleware/auth.ts`) |
| Parse        | `packages/shared` in the browser                                              | `packages/shared` in the CLI process                                                                         |
| Check        | **Nothing locally** — the command is a name for a route, and the route checks | Same                                                                                                         |
| Execute      | The route, over the session — the same request the screen makes               | The route, over the key                                                                                      |
| Record       | The route's audit entry, plus the console's own history (§10)                 | Same                                                                                                         |

**What that buys, and what it costs.** It buys: no new permission to keep in sync, no way for a console
bug to reach a write the caller could not perform, and an audit trail that already names the actor. It
costs: one HTTP round trip per command (irrelevant — the screen does the same), and no server-side place
to enforce "this command may not be run in a script" for the CLI (so the **CLI enforces script rules
itself** and the API cannot be *forced* to care — D5's honest framing: policy on scripting is a client
rule, and a determined person with an API key can always call the API directly, which is exactly what
`apiKeys.ts` exists for and what its scopes are for).

**The one new endpoint is a read**, and it exists so the CLI is not a second catalogue:

```
GET /api/console/catalog            → the descriptors this caller may run, filtered by permission
GET /api/console/catalog/:name      → one descriptor, with its flags, tier and preview text
```

Filtered by `req.user.permissions` at call time, so `help` in the app and `c7ntax help` in a terminal both
answer **"what can *I* do"** rather than shipping a binary that claims 250 commands and refuses 200 of
them. Both are additive, read-only, and useless to anybody who is not already signed in.

**A rejected alternative** worth recording: a `POST /api/console` that takes a line and executes it
server-side. It is tidier in theory (one place to audit, pipes become possible) and worse in practice —
it is a general-purpose execute endpoint, which is a class of endpoint that ends up with its own
authorization logic, and it would make the CLI's grammar a server concern to version. D2.

---

## 7. The catalogue, and the guard that keeps it true

The catalogue is **the action manifest of PLAN-026 §5, viewed as commands** — one descriptor, two
renderings:

| Manifest field           | Used by the console as                                                         |
| ------------------------ | ------------------------------------------------------------------------------ |
| `name` (`ticket.create`) | `ticket create` — the noun and verb are the name split on the dot              |
| `permission`             | The permission the command requires, shown by `help` and enforced by the route |
| `tier`                   | Whether the console may run it, must confirm it, or must refuse it (§8)        |
| `params` (JSON Schema)   | The command's flags, their types, and what `help ticket create` prints         |
| `description`            | The one-line help                                                              |
| `preview`                | What `--dry-run` shows before anything happens                                 |
| `inverse`                | Whether `undo` is offered, and what it would run                               |

**So this plan does not write a catalogue.** It writes a *projection* of the manifest into a command
grammar, plus:

- **`scripts/check-console-catalog.mjs` (`guard:console`)**, which fails the build when:
  - a descriptor in the manifest has no command name, or a command's noun/verb does not match its
    descriptor name;
  - a command's permission differs from the permission the manifest (and therefore the route) requires —
    **the check that stops the console becoming a weaker authorization layer**;
  - a command's flags do not cover the descriptor's required params (so a command cannot exist that will
    always fail validation);
  - a `critical` descriptor has no command (i.e. the console offers an action the model may not perform —
    a bug in the other direction, and the reason `critical` is *excluded*, not tiered);
  - two commands claim the same name, or a noun-verb is missing from the catalogue's group table (§12);
  - a command is in a group that does not exist in `GROUP_ORDER` (so the help output cannot silently lose
    a section).
- **The read commands, which exist today without a manifest.** PLAN-026 §5 tiers *writes*; the 187 reads
  have no descriptors because the model does not need them as tools. The console does — `ticket list`,
  `report run`, `alert list` are the most-used commands of all — so **this plan adds read descriptors**
  (`kind: "read"`, permission, params, `tier: "read"`), generated the same way from the same enumeration.
  That is an addition to PLAN-026 §5's descriptor rather than a change to it, and it is the reason
  Phase 0 of this plan is useful before Phase 1 of PLAN-026 is built.

**Ordering, stated once:** reads can land first (they cannot damage anything and they prove the grammar),
writes land **behind the manifest** and are refused with a clear message until then. A console that offers
`ticket create` before the manifest exists would be a hand-written command for a write, which is the one
thing §7 refuses to do. D1.

---

## 8. Confirmation, tiers and scripting

The console reuses PLAN-026 §8's four tiers unchanged — **one vocabulary, not two** — and the tier means
the same thing here as there: *who may skip the click*, never who has authority.

| Tier       | In the in-app console                                                                                                       | In the CLI                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `read`     | Runs                                                                                                                        | Runs                                                               |
| `low`      | Runs, shown in history                                                                                                      | Runs                                                               |
| `medium`   | Runs, with the `preview` line printed first                                                                                 | Runs; `--quiet` hides the preview, `--dry-run` stops after it      |
| `high`     | **Asks, inline**: the preview, then `[y/N]` — every time, no setting to skip it                                             | Runs **only** with `--yes`, and prints the preview then the result |
| `critical` | **Not offered.** *"This command is not available in the console — it changes accounts or destroys records. Open Users → …"* | Same refusal, and it is not in `c7ntax help`                       |

**The three rules that make scripting safe, given that a script has nobody to ask:**

1. **`--yes` never replaces a confirmation the caller could not give interactively.** `high` is refused
   unless `--yes` *and* the command names its subject explicitly (`ticket status 1001 closed --yes`), so
   the dangerous version is typing, not a loop that lost its variable.
2. **Destructive verbs need the subject twice.** `ticket delete 1001 --confirm 1001`; `user deactivate
   sam@x --confirm sam@x`. A flag that takes no value is a flag that misfires on an empty variable. This
   is the cheapest possible defence against the classic *"the loop ran with `$id` empty"* catastrophe.
3. **Every write implements `--dry-run`** — from the descriptor's `preview`, which PLAN-026 §5 already
   requires for the model's confirmation card. Scripts are written with `--dry-run` in the loop, and the
   operator removes it once.

**Secrets are their own tier.** `kumo password reveal` is a read that is more dangerous than most writes
(the permission is `kumo:passwords:reveal`, and it is audited today). Rules, applied to every command that
can return a stored secret:

- **Never in a script.** `c7ntax script` refuses a file containing one, and the CLI refuses it with a
  non-TTY stdin.
- **Never in history** — not in the browser's console history, not in the CLI's, not in the audit row's
  command line (the audit row says `kumo password reveal <id>`, and the API's own access log records the
  reveal, as it does now).
- **Printed once, with the client and the item named above it**, so a paste into a chat window is at least
  visibly wrong.

**And nothing else changes:** no `--as`, no impersonation, no "run as system". Authority is the session's
or the key's, re-read per request (PLAN-026 §2.1), and the console offers no way to become anybody else.
D8.

---

## 9. Output, exit codes, and what a machine sees

| Feature                                              | Rule                                                                                                                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Default output**                                   | A table with real column headings, truncated to the terminal width (or the panel's), with a trailing line: `18 rows (limit 50) — 3 more pages: ticket list --page 2` |
| `--json`                                             | The raw route response. The contract for scripts and for piping to `jq`                                                                                              |
| `--csv`                                              | Flattened, for spreadsheets; where a report already supports CSV, this is the report's own export                                                                    |
| `--quiet`                                            | The identifier only, one per line — what a loop wants (`ticket list --status open --quiet` → ticket numbers)                                                         |
| `--limit`, `--page`, `--since`, `--until`, `--order` | Universal, from the route's params where it has them                                                                                                                 |
| `--verbose`                                          | The HTTP method, path, permission checked, and elapsed time. **The line that teaches the API**                                                                       |
| `--out <path>`                                       | Write the result to a file (the only file system access in the whole feature, and only for output)                                                                   |
| `--dry-run`                                          | Print the `preview` and stop, for any write                                                                                                                          |
| `context`                                            | Instance, tenant, signed-in user, permission count, enabled model connection, and the counts of commands available to you — the console's own header, as a command   |

**Exit codes** (the CLI's contract, and what `;` stops on):

| Code | Meaning                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------- |
| `0`  | Done                                                                                                    |
| `1`  | Unknown command, bad flags, or a usage error — nothing was attempted                                    |
| `2`  | Refused: you do not have the permission                                                                 |
| `3`  | Not found, or ambiguous — nothing was attempted                                                         |
| `4`  | Needs a confirmation that a non-interactive session cannot give (rerun with `--yes` if the tier allows) |
| `5`  | Refused by policy: `critical`, secret-in-a-script, or a forbidden construct                             |
| `6`  | The API ran it and it failed — the route's own message, printed verbatim                                |

`6` matters: it is the same distinction PLAN-026 Phase 0 drew between "could not try" and "tried and the
route refused", and it is why the route's own words are surfaced rather than translated.

---

## 10. The in-app surface

**The header icon is already there** — it was a `Terminal` glyph to the left of Search, inert
(BuildNotes 2026.10.8.029). Phase 1 made it real, and it has since become an unlabelled glyph no longer: it
is a labelled `SquareTerminal` reading **Console**, the same treatment as its neighbours, with the
Basic/Advanced switch and the resize handles beside it. §10's drawer never shipped — the frame is a popup by
the operator's instruction, and the status note at the top of this plan is where each deviation is recorded.

**Two shapes of the same surface, because output can be long:**

| Surface                                | Behaviour                                                                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **The panel** (`Ctrl/⌘ .` or the icon) | A bottom-docked drawer over the current screen: input line, scrollback, current context. Open it, run `ticket show 1001` against the ticket you are looking at, close it. `Esc` closes; the panel remembers the last 50 lines for the session                |
| **The page** (`/console`)              | The same component, full height, deep-linkable, and where a long result (`report run 12`) actually lives. A command can be shared as a URL (`/console?c=ticket+list+--status+open`) — which is how a console command becomes something a colleague can click |

**Keyboard, because this is the whole point of a console:** `Enter` runs, `↑`/`↓` walk history,
`Tab`/`Shift+Tab` cycle completions, `Ctrl+Space` opens the completion menu with descriptions, `→`
accepts a history prediction, `Ctrl+R` searches history, `Ctrl+L` clears, `Ctrl+C` abandons the line, `?`
opens help for what is under the cursor, `Esc` closes. **Completion is specified in full in §5.1** —
including the one place this surface breaks web convention on purpose (`Tab` completes instead of moving
focus while the console input has focus). The panel never steals focus from a form it is floating above,
and it restores the screen behind it on `Esc`.

**Where else the console appears, once it exists** (all additive, all later phases):

- **In the assistant's action card**: "the same as `ticket create --client northwind …`" — the `render.ts`
  line from §4, which is the single most useful thing this plan gives PLAN-026.
- **In AI Actions** (`/ai-actions`): the command behind an applied action, so an audit entry is readable
  by a person.
- **In empty states and Help**: *"you can also run this: `report run 12 --out report.csv`"*.
- **In a failure message**: when a route refuses, the console prints the route's words and the command
  that would have worked ("you may not assign to that board — `chown` requires `ticket:assign`").

**History and privacy.** The panel keeps per-user history (last 200 lines, server-side on the user's
preferences row or client-side — D10), searchable with `Ctrl+R`, clearable with `history clear`. Secret
commands are excluded by pattern before they are stored (§8), and history is the user's own — it is not an
audit trail, and it is not visible to anybody else, including administrators.

---

## 11. The CLI

**`apps/cli`, published as `@c7ntax/cli`, binary `c7ntax`.** Node, no dependencies beyond `commander`-class
argument handling (and `packages/shared` for the grammar), so it installs in two seconds and runs anywhere
Node 20 does.

```
$ c7ntax login --server https://msp.example.com          # stores an API key in ~/.c7ntax/config
$ c7ntax context
Instance  msp.example.com · tenant "Cyber 7" · you are admin@example.com (108 permissions)
Commands  187 available to you (of 250) · 2 model connections · console enabled
$ c7ntax ticket list --status open --assignee me --limit 10
NUMBER         SUBJECT                         CLIENT          PRIORITY  AGE   ASSIGNEE
MSP-1001-1009  Laptop will not boot            Northwind       High      2h    Sam Patel
…
$ c7ntax ticket note 1009 "Collected the machine for repair"          # internal by default
$ c7ntax ticket note 1009 --external "We have your laptop and will update you today."
$ c7ntax ticket status 1009 closed --yes
$ c7ntax report run 12 --client northwind --out nw-qbr.csv --csv
$ c7ntax script onboarding.c7            # a file of commands, comments and blank lines allowed
```

**Details that decide whether it is pleasant:**

| Concern                       | Decision                                                                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Auth**                      | An API key created in the app (`apiKeys.ts` already exists, already scoped, already revocable), stored in `~/.c7ntax/config` with `0600`. `c7ntax login` walks the user through creating one; `c7ntax logout` deletes it locally. **Not** a username/password in a config file, ever |
| **Server**                    | Remembered per profile; `--server` overrides; `C7NTAX_SERVER` and `C7NTAX_KEY` environment variables for CI                                                                                                                                                                          |
| **Shell completion**          | `c7ntax completion bash\|zsh\|pwsh` generates a completion script from the live catalogue (§5.1), and that script calls back into `c7ntax _complete` — so completions are never stale, respect the key's scopes, and show our descriptions in PowerShell's menu view                 |
| **`help`**                    | Generated, grouped §12-style, filtered to your permissions, with `--json` for tooling                                                                                                                                                                                                |
| **Scripts**                   | `c7ntax script <file>` runs a command file; `--dry-run` propagates to every write in it; independent confirmation rules (§8) still apply; the exit code is the first failure's                                                                                                       |
| **Non-interactive detection** | If stdin is not a TTY, `high` without `--yes` refuses with code 4 rather than hanging on a prompt                                                                                                                                                                                    |
| **Updating**                  | `c7ntax version` prints the CLI version *and* the server's, and warns on a major mismatch — the one drift a shared grammar cannot prevent                                                                                                                                            |
| **Distribution**              | `npm i -g @c7ntax/cli` first; a packaged binary later if the demand is real. Deliberately **not** part of the desktop app's installer in v1 (PLAN-005/006 own that surface)                                                                                                          |

---

## 12. The command catalogue

**How to read these tables.** Every row is a command the console will accept. `Tier` uses PLAN-026 §8's
vocabulary (`read` for the ones added here). The route column is omitted — each command maps 1:1 to a
manifest descriptor, which names the route; the mapping is enforced by `guard:console` (§7), not by this
document. Commands that need a subject take one; `--flags` are illustrative, not exhaustive (`help <noun>
<verb>` lists them).

Groups are ordered the way an MSP's day is: **console basics → who am I → tickets → boards → work →
clients → billing → stock → documentation → knowledge → reporting → monitoring → AI → integrations →
administration → diagnostics**.

**401 commands across sixteen groups**, counted from this document: basics 14 · session 10 · tickets 32 ·
boards and work 28 · clients and pipeline 24 · projects and time off 18 · billing 35 · products, assets and
procurement 21 · Kumo 36 · knowledge, chat and surveys 18 · reports and analytics 29 · alerts and
monitoring 18 · AI and actions 17 · integrations 39 · administration 43 · system and data 19. §12.17
lists what is deliberately *not* there.

### 12.1 Console basics

The commands that belong to the shell itself rather than to the application.

| Command                                                           | What it does                                                             | Permission      | Tier            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------- | --------------- |
| `help`                                                            | List the nouns available to you, grouped                                 | —               | read            |
| `help <noun>`                                                     | List that noun's verbs, each with the permission it needs                | —               | read            |
| `help <noun> <verb>`                                              | The descriptor: purpose, flags, tier, and an example                     | —               | read            |
| `commands --all`                                                  | Every command, including the ones you cannot run and why                 | —               | read            |
| `context`                                                         | Instance, tenant, user, permission count, connection, and command counts | —               | read            |
| `whoami`                                                          | The signed-in user, roles, and effective permissions                     | —               | read            |
| `history` / `history clear`                                       | Your console history, searchable; clear it                               | —               | read            |
| `clear`                                                           | Clear the output pane (never the history)                                | —               | read            |
| `alias` / `alias t=ticket` / `unalias t`                          | List, add, or remove your shorthands                                     | —               | read            |
| `set` / `unset` (e.g. `set output json`, `set default.board msp`) | Your console defaults, stored locally                                    | —               | read            |
| `echo "…"`                                                        | Print — for scripts that narrate themselves                              | —               | read            |
| `time <command>`                                                  | Run a command and report how long the API took                           | —               | read            |
| `script <file>` (CLI)                                             | Run a file of commands; stops at the first failure                       | as each command | as each command |
| `exit` / `quit`                                                   | Close the panel                                                          | —               | read            |

### 12.2 Who am I, and how am I signed in

Credential *changes* are deliberately absent: a password, an MFA enrolment and a passkey registration
belong to a screen with a password field, a browser's password manager and a QR code. The console reports
on them and does not perform them (D7).

| Command                                           | What it does                                        | Permission | Tier       |
| ------------------------------------------------- | --------------------------------------------------- | ---------- | ---------- |
| `session show`                                    | Session state, sign-in method, expiry, MFA status   | —          | read       |
| `session extend`                                  | Extend the idle timeout                             | —          | low        |
| `permission list`                                 | Every permission you hold, grouped by category      | —          | read       |
| `permission explain ticket:assign`                | What a permission unlocks, and which roles grant it | —          | read       |
| `passkey list`                                    | Your registered passkeys with last-used dates       | —          | read       |
| `mfa status`                                      | Whether MFA is enrolled and enforced for you        | —          | read       |
| `preference get` / `preference set <key> <value>` | Your UI preferences (theme, landing page, density)  | —          | read / low |
| `theme dark`                                      | Shortcut for the one preference people change often | —          | read       |
| `landing set /c7nc`                               | Where you land after signing in                     | —          | read       |
| `notification list` / `notification dismiss <id>` | Your notifications and toasts                       | —          | read       |

### 12.3 Tickets — the service desk

The group that will be typed most, and the one whose flags matter most.

| Command                                                           | What it does                                                                                                         | Permission      | Tier                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------- | ---------------------- |
| `ticket list`                                                     | Tickets, filtered by `--status --board --client --assignee --priority --tag --since --until --search --limit --page` | `ticket:view`   | read                   |
| `ticket list --mine`                                              | Your open tickets (shorthand for `--assignee me --status open`)                                                      | `ticket:view`   | read                   |
| `ticket list --unassigned`                                        | The triage queue                                                                                                     | `ticket:view`   | read                   |
| `ticket list --breached`                                          | SLA-breached tickets, worst first                                                                                    | `ticket:view`   | read                   |
| `ticket show <id>`                                                | Status, priority, board, client, contacts, assignee, SLA clocks, counts of notes/time/attachments                    | `ticket:view`   | read                   |
| `ticket show <id> --timeline`                                     | The whole history in order: status moves, notes, time, emails                                                        | `ticket:view`   | read                   |
| `ticket create --client <c> --subject "…"`                        | Create a ticket; `--board --contact --priority --status --assignee --due --body`                                     | `ticket:create` | medium                 |
| `ticket update <id> --priority high`                              | Edit fields other than status (`--subject --client --due --tag`)                                                     | `ticket:edit`   | medium                 |
| `ticket assign <id> <user>`                                       | Assign (or `--to me`, `--unassign`)                                                                                  | `ticket:assign` | low                    |
| `ticket status <id> <status>`                                     | Move status — **emails the customer** for customer-visible transitions                                               | `ticket:edit`   | high                   |
| `ticket close <id> --resolution "…"`                              | Close with a resolution; notifies                                                                                    | `ticket:close`  | high                   |
| `ticket reopen <id>`                                              | Reopen, with a reason                                                                                                | `ticket:edit`   | medium                 |
| `ticket note <id> "…"`                                            | **Internal** note — nobody is emailed. The safe default, matching the assistant                                      | `ticket:edit`   | low                    |
| `ticket note <id> --external "…"`                                 | Customer-visible note; emails the ticket's contacts                                                                  | `ticket:edit`   | high                   |
| `ticket reply <id> --template <t> --body "…"`                     | Email the customer through the ticket                                                                                | `ticket:edit`   | high                   |
| `ticket comment <id> "…"`                                         | Comment on the record (not customer-facing)                                                                          | `ticket:edit`   | low                    |
| `ticket time <id> <minutes> --billable`                           | Add a time entry (`--rate --note --date`, `--no-billable`)                                                           | `ticket:edit`   | medium                 |
| `ticket time list --since 2026-10-01 --mine`                      | Time entries across tickets                                                                                          | `billing:view`  | read                   |
| `ticket attachment <id>`                                          | List attachments                                                                                                     | `ticket:view`   | read                   |
| `ticket attach <id> <file>`                                       | Upload a file (`--internal` to keep it off the portal)                                                               | `ticket:edit`   | medium                 |
| `ticket attachment remove <id> <attachment>`                      | Remove an attachment                                                                                                 | `ticket:edit`   | high                   |
| `ticket contact add <id> <contact>`                               | Attach a contact to the ticket                                                                                       | `ticket:edit`   | low                    |
| `ticket contact remove <id> <contact>`                            | Detach a contact                                                                                                     | `ticket:edit`   | low                    |
| `ticket contact list <id>`                                        | The ticket's contacts, with who gets emailed                                                                         | `ticket:view`   | read                   |
| `ticket expense list <id>`                                        | Expenses recorded against the ticket                                                                                 | `ticket:view`   | read                   |
| `ticket expense add <id> --amount 42.50 --vendor x`               | Record an expense                                                                                                    | `ticket:edit`   | medium                 |
| `ticket batch --ids 1001,1002,1007 --set priority=high`           | Bulk update; prints the preview and asks                                                                             | `ticket:edit`   | high                   |
| `ticket batch --search "…" --set assignee=sam`                    | Bulk update by query, with a count printed before it runs                                                            | `ticket:edit`   | high                   |
| `ticket delete <id> --confirm <id>`                               | Delete a ticket                                                                                                      | `ticket:delete` | critical → **refused** |
| `ticket dashboard`                                                | Queue health: open, unassigned, breached, average first response                                                     | `ticket:view`   | read                   |
| `ticket export --status closed --since 2026-01-01 --out 2026.csv` | Export the filtered set                                                                                              | `report:export` | read                   |
| `ticket sla <id>`                                                 | The SLA clocks for one ticket, and what has been breached                                                            | `ticket:view`   | read                   |

### 12.4 Boards, checklists and automations

| Command                                                    | What it does                                          | Permission                    | Tier               |
| ---------------------------------------------------------- | ----------------------------------------------------- | ----------------------------- | ------------------ |
| `board list`                                               | Boards, with open counts and their metrics            | `board:view`                  | read               |
| `board show <board>`                                       | Columns, statuses, membership, connected integrations | `board:view`                  | read               |
| `board create --name "Field Services"`                     | Create a board (`--description --parent`)             | `board:manage`                | high               |
| `board update <board> --name "…"`                          | Rename or re-describe                                 | `board:manage`                | high               |
| `board layout <board>` / `board layout reset <board>`      | Read, or reset, the column layout                     | `board:view` / `board:manage` | read / high        |
| `board connector list <board>`                             | Integrations attached to the board                    | `board:view`                  | read               |
| `board connector add <board> <connection>`                 | Attach an integration                                 | `board:manage`                | high               |
| `board connector remove <board> <connection>`              | Detach it                                             | `board:manage`                | high               |
| `checklist list --ticket <id>`                             | Checklists on a ticket                                | `ticket:view`                 | read               |
| `checklist create --ticket <id> --name "New starter"`      | Create one (or `--template`)                          | `ticket:edit`                 | medium             |
| `checklist show <id>`                                      | The checklist and its tasks                           | `ticket:view`                 | read               |
| `checklist task add <checklist> "Order laptop"`            | Add a task (`--assignee --due`)                       | `ticket:edit`                 | low                |
| `checklist task done <checklist> <task>`                   | Tick it off                                           | `ticket:edit`                 | low                |
| `checklist task assign <checklist> <task> <user>`          | Assign it                                             | `ticket:edit`                 | low                |
| `checklist tasks reorder <checklist> --order 3,1,2`        | Reorder                                               | `ticket:edit`                 | low                |
| `checklist duplicate <id> --ticket <other>`                | Copy a checklist to another ticket                    | `ticket:edit`                 | medium             |
| `task mine`                                                | Every open task assigned to you, across checklists    | `ticket:view`                 | read               |
| `task due --next 7`                                        | Tasks due in the next week, grouped by owner          | `ticket:view`                 | read               |
| `checklist delete <id> --confirm <id>`                     | Delete a checklist                                    | `ticket:delete`               | critical → refused |
| `automation list`                                          | Ticket automations and their triggers                 | `workflow:view`               | read               |
| `automation show <id>`                                     | Conditions, actions, last run, run count              | `workflow:view`               | read               |
| `automation create --when "status=closed" --then "note:…"` | Create a rule                                         | `workflow:create`             | high               |
| `automation update <id> --disable`                         | Enable or disable                                     | `workflow:edit`               | high               |
| `automation runs <id> --limit 20`                          | Recent executions, with what they did                 | `workflow:view`               | read               |
| `workflow rule list`                                       | Workflow rules (the general engine)                   | `workflow:view`               | read               |
| `workflow rule create --file rule.json`                    | Create a rule from a definition                       | `workflow:create`             | high               |
| `workflow rule update <id> --file rule.json`               | Update it                                             | `workflow:edit`               | high               |
| `workflow rule runs <id>`                                  | Its executions                                        | `workflow:view`               | read               |

### 12.5 Clients, contacts and the pipeline

| Command                                              | What it does                                                                          | Permission           | Tier               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------- | ------------------ |
| `client list`                                        | Clients, with `--search --active --has-open-tickets --limit`                          | `client:view`        | read               |
| `client show <client>`                               | Profile, contacts, assets, agreements, open tickets, recent activity                  | `client:view`        | read               |
| `client create --name "Contoso"`                     | Create (`--short-name --email --phone --address --parent`)                            | `client:create`      | medium             |
| `client update <client> --phone "…"`                 | Edit fields                                                                           | `client:edit`        | medium             |
| `client archive <client> --confirm <client>`         | Deactivate (the reversible form of delete — PLAN-026 D5)                              | `client:edit`        | high               |
| `client restore <client>`                            | Reactivate                                                                            | `client:edit`        | medium             |
| `client delete <client> --confirm <client>`          | Permanent delete                                                                      | `client:delete`      | critical → refused |
| `client agreements <client>`                         | Service agreements and their coverage                                                 | `agreement:view`     | read               |
| `client kumo <client>`                               | The client's documentation tree: assets, passwords, documents                         | `kumo:view`          | read               |
| `client contacts <client>`                           | Contacts, with portal and notification flags                                          | `contact:view`       | read               |
| `contact list --client <c>`                          | Contacts, filtered                                                                    | `contact:view`       | read               |
| `contact show <contact>`                             | A contact, with the tickets they are on                                               | `contact:view`       | read               |
| `contact create --client <c> --name "…" --email "…"` | Create (`--phone --role --portal-access`)                                             | `contact:create`     | medium             |
| `contact update <contact> --email "…"`               | Edit                                                                                  | `contact:edit`       | medium             |
| `contact archive <contact>`                          | Deactivate                                                                            | `contact:edit`       | medium             |
| `contact merge <keep> <discard>`                     | Merge duplicates, moving tickets and notes                                            | `contact:edit`       | high               |
| `contact lookup --email "…"`                         | Find a contact by address, across clients — the command that answers *"who is this?"* | `contact:view`       | read               |
| `contact portal preview <client>`                    | What the client sees in the portal                                                    | `client:view`        | read               |
| `opp list --stage proposal --owner me`               | The pipeline                                                                          | `opportunity:view`   | read               |
| `opp create --client <c> --name "…" --value 12000`   | Create an opportunity                                                                 | `opportunity:create` | medium             |
| `opp update <opp> --stage won --probability 100`     | Move or edit                                                                          | `opportunity:edit`   | medium             |
| `opp activity add <opp> "Called the CFO"`            | Log an activity                                                                       | `opportunity:edit`   | low                |
| `opp activity list <opp>`                            | Its activities                                                                        | `opportunity:view`   | read               |
| `opp delete <opp> --confirm <opp>`                   | Delete                                                                                | `opportunity:delete` | critical → refused |

### 12.6 Projects, schedule and time off

| Command                                                          | What it does                                    | Permission                 | Tier               |
| ---------------------------------------------------------------- | ----------------------------------------------- | -------------------------- | ------------------ |
| `project list --client <c> --active`                             | Projects                                        | `project:view`             | read               |
| `project show <project>`                                         | Phases, tasks, progress, budget, linked tickets | `project:view`             | read               |
| `project create --client <c> --name "…"`                         | Create (`--start --end --budget --manager`)     | `project:create`           | medium             |
| `project phase add <project> "Discovery"`                        | Add a phase                                     | `project:edit`             | medium             |
| `project task add <project> <phase> "…"`                         | Add a task (`--assignee --due --estimate`)      | `project:edit`             | medium             |
| `project task update <task> --progress 60`                       | Update (`--assignee --due --status`)            | `project:edit`             | medium             |
| `project task dep add <task> --blocks <task>`                    | Dependencies                                    | `project:edit`             | medium             |
| `project delete <project> --confirm <project>`                   | Delete                                          | `project:delete`           | critical → refused |
| `schedule list --week`                                           | The schedule: who is where, this week           | `schedule:view`            | read               |
| `schedule create --tech sam --ticket 1001 --at 2026-10-09T09:00` | Book time                                       | `schedule:manage`          | medium             |
| `schedule update <id> --at …`                                    | Move or reassign a booking                      | `schedule:manage`          | medium             |
| `schedule skill list`                                            | Who has which skills                            | `schedule:view`            | read               |
| `schedule skill add <user> "Firewall"`                           | Record a skill                                  | `user:manage`              | medium             |
| `pto list --team --month`                                        | Time off, filtered                              | `pto:view`                 | read               |
| `pto mine`                                                       | Your own balance and requests                   | `pto:view`                 | read               |
| `pto request --from 2026-11-02 --to 2026-11-06`                  | Request time off                                | `pto:request`              | low                |
| `pto approve <id>` / `pto reject <id>`                           | Decide a request (emails the requester)         | `pto:approve`              | high               |
| `pto holiday list` / `pto holiday add 2026-12-25 "Christmas"`    | Company holidays                                | `pto:view` / `pto:approve` | read / medium      |

### 12.7 Billing, invoices and money

The group where a mistake costs money, so the tiers are strict here and the previews say the amount.

| Command                                                                                            | What it does                                                               | Permission                         | Tier               |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------- | ------------------ |
| `invoice list --client <c> --status unpaid --since 2026-01-01`                                     | Invoices                                                                   | `billing:view`                     | read               |
| `invoice show <id>`                                                                                | Lines, totals, payments, delivery and sync state                           | `billing:view`                     | read               |
| `invoice unbilled <client>`                                                                        | Work ready to bill, with the total — the number to check before generating | `invoice:create`                   | read               |
| `invoice generate --client <c> --since <d>`                                                        | Generate from unbilled work                                                | `invoice:create`                   | high               |
| `invoice generate --from-tickets 1001,1002`                                                        | Generate from specific tickets                                             | `invoice:create`                   | high               |
| `invoice send <id>`                                                                                | Email it to the client                                                     | `invoice:send`                     | high               |
| `invoice pdf <id> --out invoice.pdf`                                                               | Download the PDF                                                           | `billing:view`                     | read               |
| `invoice payment <id> --amount 500 --method bank`                                                  | Record a payment                                                           | `billing:manage`                   | high               |
| `invoice recurring <id> --monthly`                                                                 | Make it recurring                                                          | `invoice:create`                   | high               |
| `invoice delete <id> --confirm <id>`                                                               | Delete a draft invoice                                                     | `billing:manage`                   | critical → refused |
| `batch preview --since 2026-09-01`                                                                 | Show the billing run's contents and total, and write nothing               | `invoice:create`                   | read               |
| `batch create --since 2026-09-01`                                                                  | Create the run                                                             | `invoice:create`                   | high               |
| `batch list --pending` / `batch show <id>`                                                         | Runs awaiting approval, and their contents                                 | `billing:view`                     | read               |
| `batch approve <id>`                                                                               | Approve a run — this is the moment invoices exist                          | `invoice:send`                     | high               |
| `batch reject <id> --reason "…"`                                                                   | Reject it                                                                  | `billing:manage`                   | high               |
| `payment list --since <d>`                                                                         | Payments received                                                          | `payment:view`                     | read               |
| `billing dashboard`                                                                                | Revenue, outstanding, overdue, this month vs last                          | `billing:view`                     | read               |
| `billing revenue --since <d> --group client`                                                       | The revenue report                                                         | `billing:view`                     | read               |
| `quote list --status sent`                                                                         | Quotes                                                                     | `billing:view`                     | read               |
| `quote create --client <c> --from-tickets 1001,1002`                                               | Draft a quote from work already done                                       | `invoice:create`                   | medium             |
| `quote status <id> accepted`                                                                       | Move a quote (`sent`, `accepted`, `declined`, `expired`)                   | `invoice:create`                   | high               |
| `quote convert <id>`                                                                               | Convert an accepted quote into an invoice                                  | `invoice:create`                   | high               |
| `expense list --status pending --mine`                                                             | Expenses awaiting approval                                                 | `billing:view`                     | read               |
| `expense add --ticket <id> --amount 42.50 --vendor "…"`                                            | Record one (`--date --billable --receipt`)                                 | `ticket:edit`                      | medium             |
| `expense update <id> --amount 48`                                                                  | Edit                                                                       | `ticket:edit`                      | medium             |
| `expense approve <id>` / `expense reject <id> --reason "…"`                                        | Decide                                                                     | `billing:manage`                   | high               |
| `expense sync --since <d>`                                                                         | Sync approved expenses to the ledger (FlexPoint)                           | `billing:manage`                   | high               |
| `agreement list --client <c>`                                                                      | Service agreements                                                         | `agreement:view`                   | read               |
| `agreement create --client <c> --name "…" --rate 145`                                              | Create one                                                                 | `agreement:manage`                 | high               |
| `agreement update <agreement> --rate 155`                                                          | Change terms                                                               | `agreement:manage`                 | high               |
| `contract list --client <c>`                                                                       | Contracts                                                                  | `contract:view`                    | read               |
| `contract create --client <c> --name "…"`                                                          | Create (`--value --start --end`)                                           | `billing:manage`                   | high               |
| `contract update <contract> --end 2027-06-30`                                                      | Update                                                                     | `billing:manage`                   | high               |
| `contract milestone list <contract>` / `contract milestone add <contract> "Phase 1" --amount 5000` | Milestones                                                                 | `contract:view` / `billing:manage` | read / high        |
| `contract profitability --client <c>`                                                              | Contract margin — the report MSPs ask for when renewals come round         | `report:view`                      | read               |

### 12.8 Products, assets and procurement

| Command                                                                     | What it does                                              | Permission                        | Tier               |
| --------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------- | ------------------ |
| `product list --search "switch" --supplier <s>`                             | The catalogue                                             | `product:view`                    | read               |
| `product show <sku>`                                                        | Cost, price, margin, stock, history                       | `product:view`                    | read               |
| `product create --sku SW-24 --name "24-port switch" --cost 210 --price 349` | Create                                                    | `product:create`                  | medium             |
| `product update <sku> --price 359`                                          | Edit                                                      | `product:edit`                    | medium             |
| `product price <sku> --cost 220 --price 365`                                | Change cost/price — margin-affecting, so `product:manage` | `product:manage`                  | high               |
| `product stock <sku> --set 12` / `--adjust -1`                              | Stock levels                                              | `product:manage`                  | high               |
| `product duplicate <sku> --sku SW-48`                                       | Copy a product to make a variant                          | `product:create`                  | medium             |
| `product suppliers`                                                         | Supplier list, with SKU counts                            | `product:view`                    | read               |
| `product delete <sku> --confirm <sku>`                                      | Delete                                                    | `product:delete`                  | critical → refused |
| `asset list --client <c> --type laptop --warranty-expiring`                 | Assets                                                    | `asset:view`                      | read               |
| `asset show <asset>`                                                        | Detail, history, warranty, assignment                     | `asset:view`                      | read               |
| `asset create --client <c> --name "…" --type laptop --serial "…"`           | Create (`--purchase-date --warranty --cost`)              | `asset:create`                    | medium             |
| `asset update <asset> --serial "…"`                                         | Edit                                                      | `asset:edit`                      | medium             |
| `asset checkout <asset> --to <user>`                                        | Assign to a person                                        | `asset:edit`                      | medium             |
| `asset checkin <assignment>`                                                | Return it                                                 | `asset:edit`                      | medium             |
| `asset import --file assets.csv --client <c>`                               | Bulk import, with a dry-run by default                    | `asset:create`                    | high               |
| `asset delete <asset> --confirm <asset>`                                    | Delete                                                    | `asset:delete`                    | critical → refused |
| `vendor list` / `vendor create --name "Ingram"`                             | Suppliers                                                 | `billing:view` / `billing:manage` | read / high        |
| `po list --status open`                                                     | Purchase orders                                           | `billing:view`                    | read               |
| `po create --vendor <v> --sku SW-24 --qty 2`                                | Raise a PO                                                | `billing:manage`                  | high               |
| `po update <po> --status received`                                          | Move it                                                   | `billing:manage`                  | high               |

### 12.9 Kumo — IT documentation

The `kumo` noun has sub-nouns because the module has genuinely different objects under one permission
family (assets, passwords, documents, configs, links). That is also why `kumo` is the one place the
grammar allows a **three-word** noun: `kumo password reveal <id>`.

| Command                                                         | What it does                                                         | Permission                   | Tier               |
| --------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------- | ------------------ |
| `kumo org list` / `kumo org show <org>`                         | Organisations, and one in full                                       | `kumo:view`                  | read               |
| `kumo domain list`                                              | Domains, with which client owns them                                 | `kumo:view`                  | read               |
| `kumo asset list --org <o> --type server`                       | Documented assets                                                    | `kumo:asset:view`            | read               |
| `kumo asset show <asset>`                                       | The record, its fields, its documents, its history                   | `kumo:asset:view`            | read               |
| `kumo asset create --org <o> --template server --name "DC01"`   | Create from a template                                               | `kumo:asset:create`          | medium             |
| `kumo asset update <asset> --field "IP address"=10.0.0.5`       | Update a field                                                       | `kumo:asset:edit`            | medium             |
| `kumo asset delete <asset> --confirm <asset>`                   | Delete                                                               | `kumo:asset:delete`          | critical → refused |
| `kumo template list` / `kumo template create --name "Firewall"` | Asset templates and their field definitions                          | `kumo:asset:template:manage` | read / high        |
| `kumo password list --org <o> --stale 180`                      | Credentials, filtered — including *"not rotated in six months"*      | `kumo:passwords:view`        | read               |
| `kumo password show <item>`                                     | The record: username, URL, notes — **not** the secret                | `kumo:passwords:view`        | read               |
| `kumo password create --org <o> --name "…" --username admin`    | Create                                                               | `kumo:passwords:create`      | medium             |
| `kumo password update <item> --url "…"`                         | Edit                                                                 | `kumo:passwords:edit`        | medium             |
| `kumo password reveal <item>`                                   | **The secret itself.** Never scripted, never in history (§8)         | `kumo:passwords:reveal`      | high (special)     |
| `kumo password access <item>`                                   | Who revealed it, and when — the access log                           | `kumo:passwords:view`        | read               |
| `kumo password delete <item> --confirm <item>`                  | Delete                                                               | `kumo:passwords:delete`      | critical → refused |
| `kumo password totp <item>`                                     | The current TOTP code, for a credential with 2FA stored              | `kumo:passwords:view`        | high (special)     |
| `kumo password totp setup <item> --secret "…"`                  | Enrol TOTP                                                           | `kumo:passwords:edit`        | high               |
| `kumo password totp verify <item> --code 123456`                | Verify enrolment                                                     | `kumo:passwords:edit`        | high               |
| `kumo password totp remove <item> --confirm <item>`             | Remove it                                                            | `kumo:passwords:edit`        | high               |
| `kumo document list --folder "Runbooks"`                        | Documents and folders                                                | `kumo:doc:view`              | read               |
| `kumo document show <doc>`                                      | A document's content                                                 | `kumo:doc:view`              | read               |
| `kumo document create --org <o> --title "…" --folder "…"`       | Create                                                               | `kumo:doc:create`            | medium             |
| `kumo document update <doc> --file runbook.md`                  | Update from a file — how a runbook actually gets maintained          | `kumo:doc:edit`              | medium             |
| `kumo document publish <doc>`                                   | Publish to the client-facing view                                    | `kumo:doc:publish`           | high               |
| `kumo document folder create --name "Runbooks"`                 | Create a folder                                                      | `kumo:doc:create`            | medium             |
| `kumo config list --type server`                                | Configuration records (servers, roles, etc.)                         | `kumo:config:view`           | read               |
| `kumo config create --type server --name "…"`                   | Create                                                               | `kumo:config:create`         | medium             |
| `kumo link list --org <o>`                                      | Documentation links to external systems                              | `kumo:link:view`             | read               |
| `kumo link create --org <o> --name "…" --url "…"`               | Add one                                                              | `kumo:link:manage`           | medium             |
| `kumo link delete <link> --confirm <link>`                      | Remove                                                               | `kumo:link:manage`           | high               |
| `kumo file upload <org> <file> --name "…"`                      | Attach a file                                                        | `kumo:asset:create`          | medium             |
| `kumo file delete <file> --confirm <file>`                      | Remove it                                                            | `kumo:asset:delete`          | high               |
| `kumo audit <type> <id>`                                        | The audit trail for one item — who changed what                      | `kumo:view`                  | read               |
| `kumo dashboard`                                                | Coverage and gaps: assets without a password, orgs without documents | `kumo:view`                  | read               |
| `kumo recent`                                                   | What you looked at recently                                          | `kumo:view`                  | read               |
| `kumo password coverage --client <c>`                           | The report MSPs actually want: documented vs undocumented            | `kumo:passwords:view`        | read               |

### 12.10 Knowledge base, chat and surveys

| Command                                              | What it does                                                                           | Permission              | Tier               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------- | ------------------ |
| `kb list --category "Networking" --published`        | Articles                                                                               | `kb:view`               | read               |
| `kb show <slug>`                                     | An article                                                                             | `kb:view`               | read               |
| `kb search "vpn certificate"`                        | Search titles and bodies, with the best match first                                    | `kb:view`               | read               |
| `kb create --title "…" --category "…"`               | Create a draft                                                                         | `kb:create`             | medium             |
| `kb update <id> --file article.md`                   | Update from a file                                                                     | `kb:edit`               | medium             |
| `kb publish <id>`                                    | Publish (visible to staff, and to clients where shared)                                | `kb:edit`               | high               |
| `kb autogen --ticket 1001`                           | Draft an article from a resolved ticket — the fastest path from a fix to documentation | `kb:create`             | medium             |
| `kb category list` / `kb category create --name "…"` | Categories                                                                             | `kb:view` / `kb:create` | read / medium      |
| `kb drafts`                                          | Articles drafted but never published, with ages                                        | `kb:view`               | read               |
| `kb delete <id> --confirm <id>`                      | Delete                                                                                 | `kb:edit`               | critical → refused |
| `chat session list` / `chat session show <id>`       | Internal chat threads                                                                  | `chat:view`             | read               |
| `chat create --with sam --topic "…"`                 | Start a thread                                                                         | `chat:view`             | low                |
| `chat message <id> "…"`                              | Post to it                                                                             | `chat:view`             | low                |
| `survey list --ticket <id>` / `survey show <id>`     | Satisfaction surveys                                                                   | `survey:view`           | read               |
| `survey create --client <c> --name "Q3 CSAT"`        | Create                                                                                 | `survey:create`         | medium             |
| `survey question add <id> --text "…"`                | Add a question                                                                         | `survey:manage`         | medium             |
| `survey responses <id>`                              | Responses and scores                                                                   | `survey:view`           | read               |
| `csat --since <d> --client <c>`                      | The satisfaction report everyone asks for and nobody wants to compute                  | `report:view`           | read               |

### 12.11 Reports and analytics

| Command                                                | What it does                                                              | Permission      | Tier               |
| ------------------------------------------------------ | ------------------------------------------------------------------------- | --------------- | ------------------ |
| `report list --scheduled`                              | Saved reports                                                             | `report:view`   | read               |
| `report show <id>`                                     | Definition, fields, filters, schedule, last run                           | `report:view`   | read               |
| `report run <id> --client <c> --out qbr.pdf --pdf`     | **Run and export** — `--csv --xlsx --pdf --json`                          | `report:view`   | read               |
| `report create --name "…" --file definition.json`      | Create from a designer definition                                         | `report:create` | medium             |
| `report update <id> --file definition.json`            | Update                                                                    | `report:create` | medium             |
| `report duplicate <id> --name "…"`                     | Copy                                                                      | `report:create` | medium             |
| `report schedule add <id> --cron "0 7 * * 1" --to "…"` | Schedule a delivery                                                       | `report:create` | high               |
| `report schedule run <schedule>`                       | Run a scheduled delivery now                                              | `report:create` | high               |
| `report schedule remove <schedule>`                    | Remove                                                                    | `report:create` | high               |
| `report delete <id> --confirm <id>`                    | Delete                                                                    | `report:create` | critical → refused |
| `report designer catalog`                              | The fields, tables and functions the designer offers                      | `report:view`   | read               |
| `report designer starter --topic tickets`              | A starter definition                                                      | `report:view`   | read               |
| `report designer validate --file definition.json`      | Validate before saving — the check that stops a broken report being saved | `report:create` | read               |
| `report designer preview --file definition.json`       | Preview the result                                                        | `report:view`   | read               |
| `data ticket-volume --since <d> --group day`           | Ticket volume                                                             | `report:view`   | read               |
| `data sla-compliance --client <c> --month`             | SLA compliance                                                            | `report:view`   | read               |
| `data tech-utilization --week`                         | Technician utilisation                                                    | `report:view`   | read               |
| `data ticket-aging --bucket 7`                         | Ticket ageing                                                             | `report:view`   | read               |
| `data revenue --since <d> --group client`              | Revenue summary                                                           | `report:view`   | read               |
| `data time-tracking --user sam --week`                 | Time tracking                                                             | `report:view`   | read               |
| `data csat --since <d>`                                | Satisfaction                                                              | `report:view`   | read               |
| `data client-value --top 20`                           | Which clients are worth keeping                                           | `report:view`   | read               |
| `data contract-profitability --contract <id>`          | Margin per contract                                                       | `report:view`   | read               |
| `data m365-inactive --client <c> --days 90`            | Inactive Microsoft 365 accounts, per client or estate-wide                | `report:view`   | read               |
| `review quarterly --client <c> --quarter 2026Q3`       | The QBR pack, assembled                                                   | `report:view`   | read               |
| `review monthly --month 2026-09`                       | Monthly business review                                                   | `report:view`   | read               |
| `review weekly`                                        | Weekly review                                                             | `report:view`   | read               |
| `dashboard show` / `dashboard reset`                   | Your dashboard layout                                                     | —               | read               |
| `dashboard layout save --file layout.json`             | Save a layout                                                             | —               | read               |

### 12.12 Service alerts and monitoring

| Command                                                      | What it does                                                            | Permission            | Tier   |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- | --------------------- | ------ |
| `alert list --open --severity high`                          | Active service alerts                                                   | `servicealert:view`   | read   |
| `alert show <id>`                                            | Detail, affected clients, timeline, advisory link                       | `servicealert:view`   | read   |
| `alert check`                                                | Force a feed check now                                                  | `servicealert:manage` | low    |
| `alert dismiss <id>`                                         | Dismiss                                                                 | `servicealert:view`   | low    |
| `alert resolve <id> --note "…"`                              | Resolve, with a closing note                                            | `servicealert:manage` | medium |
| `alert create --service "<svc>" --title "…" --severity high` | Raise one by hand — *"M365 is down and our feed has not noticed"*       | `servicealert:manage` | high   |
| `alert status`                                               | Feed health: last check, providers, error counts                        | `servicealert:view`   | read   |
| `alert service list`                                         | Watched services and their providers                                    | `servicealert:view`   | read   |
| `alert service add --name "…" --provider statuspage`         | Watch a service                                                         | `servicealert:manage` | medium |
| `alert service update <id> --enable` / `--disable`           | Enable or disable                                                       | `servicealert:manage` | medium |
| `alert service delete <id> --confirm <id>`                   | Stop watching                                                           | `servicealert:manage` | high   |
| `alert monitor`                                              | Monitor-check status: which checks ran, which failed                    | `servicealert:manage` | read   |
| `alert webhook list`                                         | Alert webhooks                                                          | `system:config`       | read   |
| `alert webhook create --url "…" --events resolved`           | Create one                                                              | `system:config`       | high   |
| `alert webhook update <id> --disable`                        | Update                                                                  | `system:config`       | high   |
| `alert webhook test <id>`                                    | Send a test delivery                                                    | `system:config`       | high   |
| `alert webhook deliveries <id>`                              | Recent deliveries and their responses — the only way to debug a webhook | `system:config`       | read   |
| `alert webhook delete <id> --confirm <id>`                   | Delete                                                                  | `system:config`       | high   |

### 12.13 AI, inference and actions

This group is what makes the console and the assistant one feature in two modes (§4). `ask` hands a line
to the model; `actions` reviews what came back; `render` shows the equivalent command for any proposal.

| Command                                                     | What it does                                                                    | Permission                            | Tier                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------- | -------------------- |
| `ask "how many tickets did Northwind raise last month?"`    | Send a prompt to the enabled model and print the answer with its function trace | `inference:view`                      | read                 |
| `ask --ticket 1001 "summarise this ticket"`                 | Contextual prompt against a record                                              | `inference:view`                      | read                 |
| `suggest --ticket 1001`                                     | Inference suggestions for a ticket (category, priority, next step)              | `inference:view`                      | read                 |
| `pattern list` / `pattern refresh`                          | Learned patterns from history; refresh them                                     | `inference:view` / `inference:manage` | read / medium        |
| `model list`                                                | Connected model providers, with active state and health                         | `inference:view`                      | read                 |
| `model show <provider>`                                     | Provider detail: models available, mode (`read only`/`ask`/`act`), caps         | `inference:view`                      | read                 |
| `model test <provider>`                                     | Test the connection                                                             | `inference:manage`                    | low                  |
| `model activate <provider>` / `model deactivate <provider>` | Make it the active model, or stop using it                                      | `inference:manage`                    | high                 |
| `model models <provider>`                                   | The models that provider offers                                                 | `inference:view`                      | read                 |
| `inference status`                                          | Whether inference is configured and reachable                                   | `inference:view`                      | read                 |
| `inference tools`                                           | The functions the model can call, **filtered to what you may do**               | `inference:view`                      | read                 |
| `action list --status pending --mine`                       | Proposed AI actions awaiting a decision                                         | ——                                    | read                 |
| `action show <id>`                                          | One proposal: what it would do, the tier, the payload, the equivalent command   | ——                                    | read                 |
| `action approve <id>`                                       | **Carry it out** — through the route, as you (PLAN-026 Phase 0)                 | ——                                    | as the action's tier |
| `action reject <id> --reason "…"`                           | Refuse it                                                                       | ——                                    | low                  |
| `action render <id>`                                        | Print the command this proposal is equivalent to                                | ——                                    | read                 |
| `connection health`                                         | Every connector's health in one table — the morning check                       | `integration:view`                    | read                 |

### 12.14 Integrations — C7NC, FlexPoint and the rest

C7NC is the merged CloudConnect section (PLAN-027); the noun for a configured integration is
`connection`, and the module-specific nouns (`flexpoint`, `m365`, `email`, `oauth`) are the operations
that only make sense for one of them.

| Command                                                            | What it does                                                                     | Permission           | Tier               |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- | -------------------- | ------------------ |
| `connection list --active`                                         | Configured connections, with status                                              | `integration:view`   | read               |
| `connection show <id>`                                             | Configuration (secrets masked), scopes, last sync, error state                   | `integration:view`   | read               |
| `connection types`                                                 | What can be connected at all                                                     | `integration:view`   | read               |
| `connection create --type flexpoint --name "…"`                    | Add one (`--config key=value …` or `--file config.json`)                         | `integration:manage` | high               |
| `connection update <id> --config region=us`                        | Change configuration                                                             | `integration:manage` | high               |
| `connection test <id>`                                             | Test it — and print what the provider said, verbatim                             | `integration:view`   | low                |
| `connection sync <id> --full`                                      | Sync now (incremental by default)                                                | `integration:view`   | medium             |
| `connection status`                                                | Every connection's health summary                                                | `integration:view`   | read               |
| `connection logs <id> --tail 50`                                   | Sync logs                                                                        | `integration:view`   | read               |
| `connection entities <id>`                                         | What has been synced from it, and what types it offers                           | `integration:view`   | read               |
| `connection disable <id>` / `connection enable <id>`               | Pause or resume                                                                  | `integration:manage` | medium             |
| `connection delete <id> --confirm <id>`                            | Remove a connection                                                              | `integration:manage` | critical → refused |
| `flexpoint options` / `flexpoint options set --file options.json`  | The FlexPoint configuration subsection's options                                 | `integration:manage` | read / high        |
| `flexpoint sync --since <d>`                                       | Sync ledger and invoices                                                         | `integration:view`   | medium             |
| `flexpoint link --client <c> --customer <id>`                      | Link a C7NTAX client to a FlexPoint customer                                     | `integration:manage` | high               |
| `flexpoint client <client>`                                        | A client's FlexPoint view: balance, invoices, recent payments                    | `integration:view`   | read               |
| `flexpoint invoice list --unpaid`                                  | FlexPoint invoices, with the client they belong to                               | `integration:view`   | read               |
| `flexpoint invoice push <invoiceId>`                               | Push an invoice to the ledger                                                    | `integration:manage` | high               |
| `m365 inactive --client <c> --days 90`                             | Inactive accounts across connected tenants                                       | `integration:view`   | read               |
| `m365 users <connection>`                                          | The tenant's users and their state                                               | `integration:view`   | read               |
| `m365 subscriptions <connection>`                                  | Licences and counts                                                              | `integration:view`   | read               |
| `m365 offboard <user>`                                             | Offboard a departing user (disables, converts mailbox, reports what it did)      | `integration:manage` | high               |
| `email list`                                                       | Mail connectors                                                                  | `integration:view`   | read               |
| `email create --mailbox support@… --board msp`                     | Create one                                                                       | `integration:manage` | high               |
| `email oauth start <id>`                                           | Begin the OAuth handshake (prints the URL)                                       | `integration:manage` | low                |
| `email oauth disconnect <id>`                                      | Disconnect                                                                       | `integration:manage` | high               |
| `email test <id>`                                                  | Test the mailbox                                                                 | `integration:manage` | low                |
| `email poll <id> --limit 10`                                       | Poll now — *"why has this not become a ticket?"*                                 | `integration:manage` | medium             |
| `email status <id>`                                                | Last poll, last message, failure state                                           | `integration:view`   | read               |
| `oauth app list`                                                   | Registered OAuth applications                                                    | `integration:manage` | read               |
| `oauth app start --name "…"`                                       | Begin the deploy wizard's work from the console (prints the URL and the session) | `integration:manage` | high               |
| `oauth app status <session>`                                       | Wizard session state                                                             | `integration:manage` | read               |
| `oauth app deploy <session>`                                       | Complete the deployment and populate the connector                               | `integration:manage` | high               |
| `oauth app import --file app.json`                                 | Import an existing app registration                                              | `integration:manage` | high               |
| `api key list`                                                     | API keys, with scopes and last use                                               | `user:manage`        | read               |
| `api key create --name "nightly report" --permissions report:view` | Issue a key — **which is also how the CLI signs in**                             | `user:manage`        | high               |
| `api key rotate <id>`                                              | Rotate it                                                                        | `user:manage`        | high               |
| `api key delete <id> --confirm <id>`                               | Revoke it                                                                        | `user:manage`        | high               |
| `api key permissions`                                              | The permission catalogue a key may be scoped to                                  | `user:manage`        | read               |

### 12.15 Administration

Everything here is `high` or `critical`, and `critical` commands are absent by design — the console
prints why and where the screen is.

| Command                                                             | What it does                                                            | Permission        | Tier               |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------- | ------------------ |
| `user list --role technician --inactive`                            | Users                                                                   | `user:manage`     | read               |
| `user show <user>`                                                  | Profile, roles, permissions, activity                                   | `user:manage`     | read               |
| `user create --name "…" --email "…" --role technician`              | Create (`--send-invite`)                                                | `user:manage`     | high               |
| `user update <user> --role manager`                                 | Update (`--name --email --phone --timezone`)                            | `user:manage`     | high               |
| `user deactivate <user> --confirm <user>`                           | Deactivate — the reversible form                                        | `user:manage`     | high               |
| `user activate <user>`                                              | Reactivate                                                              | `user:manage`     | high               |
| `user lock <user> --confirm <user>`                                 | Lock out (security response)                                            | `user:manage`     | high               |
| `user unlock <user>`                                                | Unlock                                                                  | `user:manage`     | high               |
| `user permission <user>`                                            | Effective permissions, and where each one comes from                    | `user:manage`     | read               |
| `user delete <user> --confirm <user>`                               | Delete                                                                  | `user:manage`     | critical → refused |
| `user password reset <user>`                                        | Send a reset                                                            | `security:manage` | critical → refused |
| `user mfa reset <user> --confirm <user>`                            | Reset MFA                                                               | `security:manage` | critical → refused |
| `role list` / `role show <role>`                                    | Roles, and what one grants                                              | `role:manage`     | read               |
| `role create --name "Dispatcher" --permissions ticket:*,board:view` | Create                                                                  | `role:manage`     | critical → refused |
| `role update <role> --permissions …`                                | Change grants — **the command that decides who can do everything else** | `role:manage`     | critical → refused |
| `role delete <role> --confirm <role>`                               | Delete                                                                  | `role:manage`     | critical → refused |
| `permission catalog`                                                | Every permission in the product, grouped                                | `role:manage`     | read               |
| `sso config list`                                                   | Identity providers                                                      | `security:manage` | read               |
| `sso config create --type oidc --issuer https://…`                  | Add one                                                                 | `security:manage` | critical → refused |
| `sso config update <id> --enable` / `--disable`                     | Enable or disable                                                       | `security:manage` | critical → refused |
| `sso oidc discover --issuer https://…`                              | Verify an issuer's discovery document                                   | `security:manage` | low                |
| `sso oidc test`                                                     | Test the sign-in round trip                                             | `security:manage` | low                |
| `sso config delete <id> --confirm <id>`                             | Remove — can lock everyone out                                          | `security:manage` | critical → refused |
| `tenant list` / `tenant current`                                    | Tenants                                                                 | `system:config`   | read               |
| `tenant create --name "Cyber 7"`                                    | Create one                                                              | `system:config`   | critical → refused |
| `config list --section billing`                                     | The configuration registry (PLAN-021), by section                       | `system:config`   | read               |
| `config get billing.invoiceDueDays`                                 | One setting, its value, allowed options and default                     | `system:config`   | read               |
| `config set billing.invoiceDueDays 30`                              | Change it — **every change is audited with before/after**               | `system:config`   | high               |
| `config reset billing.invoiceDueDays`                               | Restore the default                                                     | `system:config`   | high               |
| `config portal --client <c> --enable`                               | Per-client portal configuration                                         | `system:config`   | high               |
| `locale list`                                                       | Languages                                                               | `system:config`   | read               |
| `locale add --code fr-CA`                                           | Add one                                                                 | `system:config`   | high               |
| `translation show fr-CA --section tickets`                          | Translation strings                                                     | `system:config`   | read               |
| `translation set fr-CA tickets.title "Billets"`                     | Set one                                                                 | `system:config`   | high               |
| `currency list`                                                     | Currencies                                                              | `system:config`   | read               |
| `exchange rate list` / `exchange rate add USD 1.36`                 | Rates                                                                   | `system:config`   | read / high        |
| `retention list` / `retention set tickets --days 2555`              | Retention policies                                                      | `system:config`   | read / high        |
| `field permission list --entity ticket`                             | Field-level permissions: who may see what                               | `system:config`   | read               |
| `field permission set ticket.cost --role technician --deny`         | Change one                                                              | `system:config`   | high               |
| `calendar sync --user sam`                                          | Calendar sync state and last run                                        | `system:config`   | read               |
| `audit list --actor sam --since 2026-10-01 --action ticket.delete`  | **The audit log, queryable** — the command an auditor wants             | `system:config`   | read               |
| `audit show <id>`                                                   | One entry, with the before/after diff                                   | `system:config`   | read               |
| `audit export --since <d> --out audit.csv`                          | Export it                                                               | `system:config`   | read               |

### 12.16 System, data and diagnostics

The console's own service hatch: the commands that answer *"is the product working, and what does it
think it is?"*

| Command                                                                     | What it does                                                                                                                                      | Permission      | Tier        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------- |
| `context`                                                                   | Instance, tenant, user, connection — §9's header command, listed here for completeness                                                            | —               | read        |
| `show routes --filter /api/tickets`                                         | The route table, with methods and permissions. **The line that teaches the API**                                                                  | `system:config` | read        |
| `show commands --module billing`                                            | The console's own catalogue, filtered (§12.1)                                                                                                     | —               | read        |
| `show manifest --module kumo`                                               | The action manifest's descriptors, as generated                                                                                                   | `system:config` | read        |
| `show schema --model Ticket`                                                | The data model's fields and relations                                                                                                             | `system:config` | read        |
| `show permissions --unused`                                                 | Permissions no role grants, and roles with no users                                                                                               | `role:manage`   | read        |
| `doctor`                                                                    | A health pass: database reachable, migrations applied, pollers alive, connectors configured, mail flowing, storage writable — each with a verdict | `system:config` | read        |
| `version`                                                                   | App version, BuildNotes version, API version, schema version, CLI version                                                                         | —               | read        |
| `changelog --limit 10`                                                      | What's new, in the product's own words                                                                                                            | —               | read        |
| `config system get <key>` / `config system set <key> <value>`               | Runtime configuration keys                                                                                                                        | `system:config` | read / high |
| `deployment`                                                                | Deployment facts: environment, region, build, feature flags                                                                                       | `system:config` | read        |
| `failover status` / `failover reset`                                        | Failover state                                                                                                                                    | `system:config` | read / high |
| `poller status` / `poller reset`                                            | Background pollers                                                                                                                                | `system:config` | read / high |
| `snapshot status` / `snapshot force` / `snapshot pause` / `snapshot resume` | The snapshot poller                                                                                                                               | `system:config` | read / high |
| `bulk show <job>`                                                           | A bulk job's progress and errors                                                                                                                  | `ticket:view`   | read        |
| `bulk webhook list` / `bulk webhook create --url … --events ticket.created` | Bulk/ticket webhooks                                                                                                                              | `system:config` | read / high |
| `event list --since <d>`                                                    | The event stream (what integrations subscribe to)                                                                                                 | `ticket:view`   | read        |
| `nav favorites` / `nav favorite add /tickets`                               | Your navigation favourites                                                                                                                        | —               | read        |
| `logs --since 10m --level error`                                            | Application logs, filtered — with the caveat that only an administrator sees these, and only where the deployment exposes them                    | `system:config` | read        |

### 12.17 What the catalogue deliberately does not contain

| Absent                                                                                                                                                | Why                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Sign-in, password change, MFA enrolment, passkey registration** (`auth.ts`, `webauthn.ts`)                                                          | Credential handling belongs to a screen with a password manager and a QR code, and a console that can change its own credentials is a console whose history is a credential store. `ssoExchange.ts` likewise |
| **Everything customer-facing** (`portal.ts`)                                                                                                          | The client portal is a Contact's session, not a staff one. It has no staff permissions to check and no place in a staff console                                                                              |
| **Device push subscriptions** (`push.ts`)                                                                                                             | Per-device, meaningless outside the device                                                                                                                                                                   |
| **`critical` actions** — deletes, role and permission edits, API-key issuance from within a script, tenant settings, secret fields, SSO configuration | PLAN-026 §8: proposal-only for the model, and **refused** here. The console names the screen instead of the flag                                                                                             |
| **`user password reset` / `user mfa reset`**                                                                                                          | They are `critical` in a way that deserves its own sentence: a support console that can reset a *different* person's MFA is an account-takeover tool with a nice prompt                                      |
| **Pipes, redirection, variables, `eval`, SQL**                                                                                                        | §5. The console runs commands; the operator's own shell runs programs                                                                                                                                        |
| **Impersonation of any kind**                                                                                                                         | PLAN-026 §2.1. Authority is theirs or it is nobody's                                                                                                                                                         |

---

## 13. Deliberately absent, in one place

Restating the exclusions because they are the plan's safety property rather than its omissions: **no new
authorization model** (§6), **no execution endpoint** (§6), **no client-side permission checks** (§8), **no
impersonation** (§8), **no shell language** (§5), **no secrets in history or scripts** (§8), **no
`critical` commands** (§8), and **no hand-written write catalogue** (§7). Each one of those is a thing a
console normally grows, and each one is a thing this one may not.

---

## 14. Decisions to freeze

| #       | Decision                                | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | If taken the other way                                                                                                                                                                                     |
| ------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1**  | When the console is built               | **Reads first, writes behind PLAN-026's manifest.** The grammar, the 187 read commands and the surface can land now; `ticket create` waits for the manifest rather than being hand-written                                                                                                                                                                                                                                                                                                                                                | Hand-writing write commands ships faster and guarantees that the console and the model disagree about permissions — the exact drift §7 exists to prevent                                                   |
| **D2**  | Where a command executes                | **Client-side parse, route re-entry as the caller, no POST /api/console** (§6)                                                                                                                                                                                                                                                                                                                                                                                                                                                            | A server-side execute endpoint is tidier and becomes a general-purpose execution surface with its own authorization logic                                                                                  |
| **D3**  | Grammar shape                           | **`noun verb subject --flags`** — noun-first, because the app is noun-heavy and `help ticket` is then the natural entry point                                                                                                                                                                                                                                                                                                                                                                                                             | Verb-first (`git`-style) reads well for a small surface and makes `help` a much longer list here                                                                                                           |
| **D4**  | Does the console get a permission?      | **Amended 2026.10.8.043: yes — `console:use`.** The original answer was no, on the argument that every command is already authorized by the route's own permission, which `guard:console` enforces. The operator's requirement — *"the console icon shouldn't even be displayed, if they don't have permissions to it"* — is not a question a per-command permission can answer: it would have to be answered command by command, after the surface was on screen. So the surface has a permission, and each command keeps its own on top | A `console:use` permission is a second thing to keep true, and the console's commands are already gated — the cost accepted, because the alternative is offering a console that answers "no" to everything |
| **D5**  | Scripting rules                         | **Client-side**: `high` needs `--yes` *and* an explicit subject; destructive verbs need `--confirm <subject>`; secrets are refused in scripts; non-TTY fails with code 4 (§8)                                                                                                                                                                                                                                                                                                                                                             | Server-side enforcement would mean the API knowing what a "script" is — and an API key can call the API directly anyway, which is what its scopes are for                                                  |
| **D6**  | Tiers                                   | **Reuse PLAN-026 §8 unchanged** — one vocabulary, one table                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | A second tier scale for the console means two documents to keep in step and two meanings of "high"                                                                                                         |
| **D7**  | Credential commands                     | **Absent** (§12.17) — reported, never performed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Including them makes the console a credential-management tool, with a history file to match                                                                                                                |
| **D8**  | Impersonation                           | **Absent.** No `--as`, no "run as system", ever                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | It is the single fastest way to make every audit row a lie                                                                                                                                                 |
| **D9**  | Where console settings live             | **Locally** (browser storage + `~/.c7ntax/config`): aliases, defaults, history. Nothing server-side, no schema change                                                                                                                                                                                                                                                                                                                                                                                                                     | Server-side means per-device settings roam, at the cost of a migration and a privacy question about history                                                                                                |
| **D10** | History retention                       | **200 lines per user, your own, deletable, never an audit trail** — and secret commands are excluded before storage                                                                                                                                                                                                                                                                                                                                                                                                                       | Longer and server-side starts to look like a log of everything everyone typed                                                                                                                              |
| **D11** | The word "Console"                      | **Means the command line.** The assistant page keeps the name "Assistant"; PLAN-026 §11's rename is dropped and corrected there                                                                                                                                                                                                                                                                                                                                                                                                           | Two surfaces called Console is a support-ticket generator                                                                                                                                                  |
| **D12** | The CLI's home                          | **A new `apps/cli`** published as `@c7ntax/cli`, not a mode of the desktop app                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Bundling it with the desktop installer puts it behind a 400 MB download for people who want a 200 KB tool                                                                                                  |
| **D13** | Completion model                        | **PowerShell's four behaviours** (§5.1): `Tab` cycles, `Ctrl+Space` opens a described menu, `→` accepts inline history prediction, values complete from the API through a warm cache                                                                                                                                                                                                                                                                                                                                                      | A plain "list of strings" dropdown is what a browser does, and it is the difference between a console an engineer keeps open and one they close                                                            |
| **D14** | `Tab` while the console input has focus | **Completes** — it does not move focus. `Esc` leaves the console; the panel states the rules once on first open                                                                                                                                                                                                                                                                                                                                                                                                                           | Following web convention here makes `Tab` useless in the one surface where hands expect it, and the hint is what stops it being a trap                                                                     |
| **D15** | Where completion candidates come from   | The **catalogue + live API**, permission-filtered, **never** model-inferred, never frequency-ranked, never shared history (§5.1)                                                                                                                                                                                                                                                                                                                                                                                                          | Suggestions that guess are suggestions you cannot trust, and a shared history is a privacy question wearing a productivity hat                                                                             |

---

## 15. Phases

| Phase | What lands                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Needs                                       | Size     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------- |
| **0** | **The header icon** (built — BuildNotes 2026.10.8.029 as a placeholder, wired in 2026.10.8.038) plus `packages/shared/src/console/`: the grammar, the parser, the rank/prefix resolution, typed errors, **the completion engine** (grammar/parse/completion, §5.1) and the probe's cases for the two together. **Built**: the read descriptors live in `catalogue.ts` (85 commands, 15 groups) and `guard:console` carries all four of its checks                                                                                                                                                                                                             | Nothing                                     | 2 days   |
| **1** | **A read-only console that really works**: the panel and `/console`, `help`, `context`, `history`, `alias`, the table renderer, `--json`, and the full `ticket`/`client`/`alert`/`report` read commands. **Completion is wired in the same phase** — `Tab`/`Shift+Tab`, the `Ctrl+Space` menu with descriptions, warm value caches, and inline history prediction — because a console shipped without it teaches people the wrong habits and then changes under them. **Writes are refused with a message that names the phase they arrive in**                                                                                                               | Phase 0                                     | 3 days   |
| **2** | **Writes**, through PLAN-026 §6's executor: the confirmation card, `preview`/`--dry-run`, `--yes`/`--confirm`, the audit link, and the tier table in the UI so nobody has to guess what `high` means                                                                                                                                                                                                                                                                                                                                                                                                                                                          | PLAN-026 Phase 1 (manifest) and Phase 2     | 2–3 days |
| **3** | **The CLI**: `apps/cli`, API-key login, `c7ntax _complete` + generated `completion bash\|zsh\|pwsh` scripts, exit codes, `--quiet`/`--csv`/`--out`, `script`, non-TTY rules, and `GET /api/console/catalog`. **Built for reads** (2026.10.8.041): `login`/`logout` with a key verified against `GET /users/me`, `context`, `help [noun [verb]]`, `version`, `_complete`, and every read command the catalogue contains, with exit codes 0/1/2/3/5/6 proven in `probe-cli`. **Not built:** `--csv`/`--out`, `script`, the non-TTY confirmation rules (all of which are about *writes*), and packaging — it runs from source with `tsx` exactly as the API does | Phase 1 (and Phase 2 for writes)            | 3 days   |
| **4** | **The cross-links**: `render.ts` in the assistant's action cards, the command behind an applied action on `/ai-actions`, the `--verbose` route line, and empty-state hints. **Plus the capability line** ("141 commands available to you")                                                                                                                                                                                                                                                                                                                                                                                                                    | Phase 2, PLAN-026 Phase 5                   | 1 day    |
| **5** | **Completeness**: every permitted action has a command and a tier (the tail of PLAN-026 Phase 4), `help --all`, the grouped Help article, and `guard:console` complete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Phase 2                                     | 1–2 days |
| **6** | **Parity with PLAN-025**: the MCP tool list becomes the same catalogue, so a command name, a tool name and a descriptor name are one string in one place                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | PLAN-025 phases 0–2, this plan's phases 0–2 | 0.5 day  |

Phases 0–2 are the feature: **~8 days for a console an engineer would actually use**, of which 2–3 are
the manifest PLAN-026 owes anyway. Phase 0's completion engine is a day of that and is the difference
between a console people keep open and a console people close.

---

## 16. How it will be verified

| What                                 | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The grammar**                      | `packages/shared` unit tests, ~200 cases: every noun × verb pair parses; quoting, comments, `;`, prefixes and ambiguity; the errors are the *typed* ones (unknown / ambiguous / denied / needs-confirm) rather than strings                                                                                                                                                                                                                                                                                                                                                   |
| **The completion engine**            | ~120 more unit cases, all pure (no HTTP, no DOM): each line position completes the right kind of word; mid-line completion preserves what follows; the common prefix extends before cycling; quoting and escaping for values with spaces; free-text flags are never completed; ambiguous prefixes return the menu rather than a choice; a permission-less caller is offered nothing for that noun; a stale cache is labelled; secret flags and secret commands are absent from candidates *and* from prediction; candidates are ordered deterministically (§5.1)              |
| **Completion, live**                 | In the browser: `Tab` cycles, `Shift+Tab` reverses, `Ctrl+Space` opens the described menu, `→` accepts a prediction from a line that was actually run, `Tab` does not move focus out of the input, and no keystroke produces a network request (asserted from the network panel — the cache is what makes that true)                                                                                                                                                                                                                                                          |
| **No drift from the API**            | `guard:console` in CI (the `check-route-guards.mjs` technique): every command's permission equals the manifest's; every required param has a flag; no `critical` command; no duplicate names; every group in §12 exists in `GROUP_ORDER`                                                                                                                                                                                                                                                                                                                                      |
| **The console against the real API** | `apps/api/probe-console.mts` (the `probe-ai-apply.mts` pattern): for a sample of ~20 commands across nouns — a read returns the same rows as the equivalent REST call; a write with `--dry-run` changes nothing and prints the preview; the same write without confirmation is refused with code 4; a write the caller lacks the permission for is refused with code 2 **and the route's own words**; a `critical` command is refused with code 5; a secret command is excluded from history; a script containing two commands stops at the first failure with the right code |
| **The CLI**                          | The same probe plus: non-TTY `high` without `--yes` exits 4; `--json` output parses and matches the REST body; `c7ntax _complete` returns the same candidates as the panel for the same line (one engine, two front ends); the generated script completes in bash, zsh and pwsh including the PowerShell menu's descriptions; `script --dry-run` performs nothing                                                                                                                                                                                                             |
| **Permission parity, live**          | Signed in as a technician, `help` must not list a single command they cannot run — asserted against `/api/console/catalog` and cross-checked against the route's own 403                                                                                                                                                                                                                                                                                                                                                                                                      |
| **The surface**                      | Walked in the browser: the icon opens the panel; `Tab` completes; history survives a reload; the panel does not steal focus from a form; `Esc` restores the previous screen; `/console?c=…` deep-links                                                                                                                                                                                                                                                                                                                                                                        |

---

## 17. Relationship to the other plans

| Plan                                               | Relationship                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PLAN-026 — model control**                       | The closest and the load-bearing one. It owns the **manifest** (Phase 1 — unbuilt), the **tiers** (§8) and the **executor** (§6 — built, BuildNotes 2026.10.8.028). This plan adds **read** descriptors to its schema, reuses its tiers verbatim, dispatches through its executor, and gives it `render.ts` so a proposal can be read as a command. Its §11 naming of the assistant as "Console" is corrected (D11) |
| **PLAN-025 — MCP server**                          | The third front end. Once §12 exists, PLAN-025's tool list *is* this catalogue, so "the model can call it" and "you can type it" are the same list. Worth sequencing after Phase 2 here rather than before                                                                                                                                                                                                          |
| **PLAN-027 — C7NC merge**                          | Where the `connection`, `flexpoint`, `m365`, `email` and `oauth` commands live, and the reason §12.14 exists as a group rather than a scattering                                                                                                                                                                                                                                                                    |
| **PLAN-021 — configuration registry**              | Owns `CONSOLE_ENABLED` (the switch that hides the icon and stops serving the catalogue) and is the thing `config get/set` commands operate on                                                                                                                                                                                                                                                                       |
| **PLAN-018 — dependency and security remediation** | `guard:console` is its technique applied to a new surface; the route-guard script is the enumeration this plan's catalogue is generated from                                                                                                                                                                                                                                                                        |
| **PLAN-020 — report designer**                     | `report designer validate --file` is a genuinely useful command for a designer whose definition is JSON, and it is the one place the console and a designer meet                                                                                                                                                                                                                                                    |
| **PLAN-011 / the assistant**                       | `ask` is the assistant in the console, and the console is the assistant with the interpretation removed. Neither replaces the other: `ask "why is Northwind unhappy?"` is a question, `ticket list --client northwind --status open` is an answer you can script                                                                                                                                                    |
| **PLAN-007 — SOC 2**                               | The console's audit story is the routes' audit story, plus §8's secret rules and D10's statement that history is not a log                                                                                                                                                                                                                                                                                          |

---

## 18. What would make this plan wrong

- **If the action manifest never lands.** Then this plan has two choices, and both are worse than
  waiting: hand-write the command catalogue (drift, guaranteed), or ship reads only forever (a console
  that cannot change anything is a query tool with a terminal costume). §7's ordering is the honest
  position: **PLAN-026 Phase 1 is the critical path**, and the console is the second thing to benefit
  from it.
- **If nobody wants a console.** The operator asked for one, so this is unlikely — but the honest test is
  Phase 1: ship the read-only console, watch whether it is used, and only then build the CLI and the
  cross-links. Nothing in phases 2–6 is wasted if it stops at Phase 1, because the parser and the read
  catalogue are what a *future* CLI or MCP server would need anyway.
- **If the CLI cannot be trusted with `high` actions** — that is, if the operator would rather no
  automation could close tickets or send invoices at all. Then D5 flips to "`high` is interactive-only,
  `--yes` is refused", which costs the scripting story its most valuable half and is a legitimate choice.
- **If tab-completion and `help` are seen as optional.** They are not: a console without them is a worse
  API client, and the generation of both from the catalogue is most of the reason the catalogue is
  generated rather than written.
- **If a real shell is what was wanted** — pipes, `jq`, `xargs`, cron, output files. Then the honest
  answer is: **that is the CLI plus the operator's own shell**, which is exactly why §11 ships a
  standalone binary and §5 refuses to grow a language. If the requirement is "write a program against
  C7NTAX", the API and its keys are the answer, not this.
- **If completion is dropped to save a day.** It is §5.1's whole point and the operator asked for it by
  name, but it is also the item most likely to be deferred as "polish". A console without `Tab` is a
  worse API client than the API: it requires memorising 250 command names and their flags, and the two
  things that make that unnecessary — completion and generated `help` — are the same generated data.
- **If the console becomes the place integration scripts live.** A morning checklist in a `.c7` file is
  good. A nightly billing run in a `.c7` file that nobody reviews is a page at 2am; scheduled work should
  be a *workflow* (which has runs, errors and retries) or an API key with narrow scopes, not a console
  script under somebody's desk.

---

## 19. Costs, and what this does not buy

|                          |                                                                                                                                                                                                                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **New code**             | `packages/shared/src/console/` (grammar, completion, catalogue projection, renderer, errors); a web panel + `/console`; `apps/cli` (including `_complete` and the three generated shell scripts); `GET /api/console/catalog`; `scripts/check-console-catalog.mjs`; two probes                       |
| **New schema**           | **None.** No table, no column, no migration — history and aliases are local (D9)                                                                                                                                                                                                                    |
| **New permissions**      | **None** (D4). Two config keys: `CONSOLE_ENABLED`, and the CLI needs nothing it does not already reuse from `apiKeys.ts`                                                                                                                                                                            |
| **New dependencies**     | One small argument parser in the CLI, and `packages/shared` — the web console adds none. **Completion is written, not imported**: no editor/IDE component, no `clipanion`-style completion framework, because the candidates come from our own catalogue and our own API                            |
| **Ongoing cost**         | Every new route needs a descriptor (PLAN-026's own guard work) and a noun-verb name. That is real, and it is the same cost PLAN-026 already accepted — this plan does not add a second one                                                                                                          |
| **What it buys**         | Bulk operations without clicks or one-off scripts; a scriptable, auditable API client; `help` and `Tab` that cannot be stale (both generated from the catalogue); the API taught by a `--verbose` line; a command behind every model proposal; and one vocabulary shared with the assistant and MCP |
| **What it does not buy** | Any new capability. Every command is an existing operation with a shorter name — which is the property that makes it safe to build, and the reason it can be turned off without a migration                                                                                                         |
