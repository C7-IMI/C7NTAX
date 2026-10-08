# PLAN-023 — Folding Each Setting's Explanation Behind a "Why" Control

> **Sequence:** not in the active sequence — a UI decision recorded for later, filed after the tab
> work in **2026.10.8.007** (Prompt 251/252). It blocks nothing and is blocked by nothing.
> **Decided:** no. The mockup and the measurements exist; the choice has not been made.
> **Mockup:** [`docs/mockups/portal-settings-why-toggle.html`](../docs/mockups/portal-settings-why-toggle.html)
> — a standalone page, opens in any browser, measures itself.
> **Cost when taken:** one change in one component (`FieldCard` in `apps/web/src/pages/Configuration.tsx`),
> which every settings screen renders through. No API work, no registry change, no migration.

---

## 1. The complaint, measured

The Customer Portal screen is three tabs (2026.10.8.007). The first of them, **Portal settings**, is
still the tallest thing on the screen, and it is tall for one reason: every one of its sixteen fields
carries its reasoning with it.

Each field prints four blocks:

| Block | Source | Example — "Customer portal enabled" |
|---|---|---|
| Label + chips | `label`, `source`, `overridden`, `restartRequired` | `Customer portal enabled` · `Deployment default (PORTAL_ENABLED)` |
| One-line summary | `summary` | "Expose the portal and everything behind it." |
| Explanation | `detail` | "When off, every portal route answers 404 and the sign-in page does not exist — a deployment that has not switched the portal on should not advertise it. Takes effect immediately; no restart." |
| What it changes / what it defaults to | `affects`, `default` | "Changes: /portal · Portal sign-in · Clients → Portal access" / "Default when nothing is saved: `false`" |

Sixteen of those is roughly **2,600 px of scrolling** for a screen whose actual decisions are sixteen
switches and text boxes. Measured in the mockup, drawing the first five fields and scaling to the
sixteen the tab really has:

| State | Five fields drawn | Scaled to sixteen |
|---|---|---|
| **Today** — every explanation printed | 819 px | **2,621 px** |
| **Proposed** — as it opens, one field expanded | 217 px | **695 px** |
| **Proposed** — "Show every explanation" switched on | 553 px | **1,770 px** |

So folding is worth about **75%** of the height, and even a fully-expanded reading is about a third
shorter than today — the `Changes:` and `Default` lines merge behind the fold, so they cost less even
when they are shown.

---

## 2. The proposal

**Keep the three things a decision is actually made from, always visible:** the label (with its
chips), the one-line summary, and the control. **Fold the reasoning behind a `Why` control beside the
label**, which opens it in place.

Three shapes of it are drawn in the mockup:

1. **`Why` as a word**, not an ⓘ icon. An icon is quieter but says nothing until it is hovered;
   "Why" explains itself and reads as part of the label. The icon is the fallback if the chip row
   (up to four chips on a locked field) gets busy.
2. **One "Show every explanation" switch for the whole card**, so an administrator reading the screen
   like documentation gets today's reading back without opening sixteen fields.
3. **The `Changes:` and `Default when nothing is saved` lines fold with the explanation.** This is
   most of the saving: at five fields, keeping them visible costs about two-thirds of the gain.

The opened state is in place, under the field, not a tooltip, a drawer or a modal — the explanation
is long prose and has to wrap.

---

## 3. Where the change lands — one component, every settings screen

`FieldCard` in `apps/web/src/pages/Configuration.tsx` (≈ lines 265–312) draws all four blocks. Every
settings surface renders through it: the Configuration hub, the Portal settings tab, and the
System Settings sections that were folded into the registry. So this is **one** change, not a
per-screen one — which is the reason to do it here or not at all.

The fold wraps exactly three of the blocks:

| Lines (2026-10-08) | Block | Folds? |
|---|---|---|
| 273–278 | `h4` label + chips, `summary` | **No** — always visible |
| 278 | `detail` explanation | **Yes** |
| 279–283 | `Changes: …` (`affects`) | **Yes** |
| 288–295 | `field.source === "environment"` value dump, `overridden` note | **No** — these are state, not reasoning |
| 305–310 | `Default when nothing is saved: …` | **Yes** |
| 305–319 | "Use the deployment's value" reset button, error line | **No** — a button must never hide behind a disclosure |

**⚠ That last row is the trap.** The `Default …` text and the reset button currently share one row
(304–319). The text folds; the button does not. Hiding an action behind a "Why" control would make a
field with a saved override look like a field with none.

---

## 4. Decisions to make before building

| # | Question | Options | Leaning (not decided) |
|---|---|---|---|
| 1 | Word or icon | `Why` · ⓘ with a tooltip | `Why` — the icon needs the word to be understood |
| 2 | Do `Changes:` / `Default` fold too | fold · keep visible | fold: it is 2/3 of the saving |
| 3 | Card-wide switch | one "Show every explanation" · none | one, or the "read it like documentation" case has no answer |
| 4 | Does an opened field stay open | per-field session state · remembered per user · always closed on load | session state first; a per-account store already exists (`UserNavConfig`, Prompt 250) if it is wanted later |
| 5 | One field open at a time, or many | accordion · independent | independent — the reason to open two is to compare them |
| 6 | Does the summary stay if the explanation folds | keep · fold both | keep: the summary is what you scan for |

---

## 5. Guardrails — what the change must not do

- **Nothing may leave the DOM, or become hover-only.** The control is a real `<button>` with
  `aria-expanded` and a text label, not a CSS reveal — the explanation is content, and a screen
  reader must be able to read it.
- **The registry keeps `detail`/`affects`/`default` exactly as they are.** This is a presentation
  change; `packages/shared/src/appConfiguration.ts` is not touched.
- **No value is read, written or validated differently.** Folding must not change what is saved, what
  `overridden` reports, or when a field commits.
- **The status vocabulary stays visible.** `Set by …`, `Overrides …`, `Needs a restart`, `Required`,
  `Configured` are chips, not reasoning, and are how a field is judged at a glance.
- **Contrast on both themes.** Any new pale shade added for the `Why` control has to be added to the
  light-theme remap block in `apps/web/src/index.css`, or it lands pale on the light theme (the
  ~106-place tint trap that already bit this codebase once).

---

## 6. Dependency-ordered items

1. **Measure the current screen.** Read the portal settings tab in a browser and record the rendered
   height per field.
   - `Depends on:` nothing. `Risk if skipped:` a "it feels long" change with no number to check
     afterwards. **Done** — see §1 and the mockup's table.
2. **Add the fold to `FieldCard`** — a `useState` per field, a `Why` button beside the label with
   `aria-expanded`, the three blocks inside the panel.
   - `Depends on:` 1. `Risk if skipped:` n/a. `Risk if done carelessly:` the reset button (§3) disappears
     for overridden fields.
3. **Add the card-wide "Show every explanation" switch** — one piece of state on the section, passed
   into each card.
   - `Depends on:` 2 (it needs the fold to exist). `Risk if skipped:` no way to read the screen as
     documentation; the complaint returns as "why can't I see everything at once".
4. **Re-measure the same screen** and compare against §1's numbers, in both themes and at 390 px wide.
   - `Depends on:` 2, 3. `Risk if skipped:` an unverified "it is shorter".
5. **Decide whether the open state is remembered** (decision 4). Only if the answer is yes does this
   become a store or a column, on the `UserNavConfig` pattern.
   - `Depends on:` 4. `Risk if skipped:` the feature ships with a state that resets on every load,
     which may be exactly what is wanted — record the decision either way.
6. **Update the Help walkthrough** for the portal settings tab if it describes the screen's text.
   - `Depends on:` 2. `Risk if skipped:` `scripts/check-help-links.mjs` catches links, not prose.

---

## 7. How it would be verified

- **The measurement, not the impression:** the same five fields measured before and after, in a
  browser, and the drill repeated at 390 px wide and on the light theme.
- **A11y:** every explanation still reachable with the keyboard, `aria-expanded` toggling, the
  explanation present in the accessibility tree when open and absent from the tab order when closed.
- **Behaviour untouched:** a save still commits, `Overrides …` still appears, "Use the deployment's
  value" still resets — the existing Configuration probes cover the registry, and this changes no
  route.
- **The trap:** a field with a saved override, checked with its explanation folded, still shows the
  reset button.

---

## 8. Cost, and the exit condition

**Cost:** one component, a couple of pieces of state, some CSS for the control. Hours, not days —
roughly the size of the tab work in 2026.10.8.007. The reason it is not already done is that it is a
taste decision, not a technical one: it trades "everything is on the page" for "the page is short".

**Exit condition:** the portal settings tab measures under ~800 px scaled to sixteen fields, the
screen still reads as documentation with one switch, and the Configuration probes are green.

**Filed here rather than built:** the mockup is the proposal. If the answer is "no", this document is
the record of why; if it is "yes", it is the specification.
