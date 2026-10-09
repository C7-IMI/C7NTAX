# C7NTAX — Design Language

**Read this before you change any interface.** It is written for AI models and for people, and it exists
because a screen added by a model that has not read it will look like a screen from a different product —
and will be built for one of the two interfaces, one of the two themes, one of the eight colour schemes and
one of the two densities, while users are looking at all of them.

This document is **derived from the code**, not written alongside it. Every token, class and component
named here exists in this repository; the files that are the source of truth are listed in §11, and §12
says what to do when they disagree with this page.

## 0. The rule, in one paragraph

The application has **two interfaces** (modern and classic), **two themes** (dark and light), **eight
colour schemes** and **two densities**. A change is not finished until it is *designed* for each interface
separately and *verified* against the rest. Use the tokens and the shared components; never write a colour
literal; never let the modern arrangement be a restyle of the classic one. Then run the guards in §9.

## 1. The four axes every change must survive

| Axis | Values | Where it is set | How to switch while testing |
|---|---|---|---|
| **Interface** | modern (`redesign`), classic | `useRedesign()` from `hooks/useNavigationStyle`, backed by the instance's `appearance.interfaceStyle`, the `c7_ui_redesign` flag and `VITE_UI_REDESIGN` | `localStorage.setItem("c7_ui_redesign", "0")` → classic; `"1"` → modern; `removeItem` → the instance default |
| **Theme** | dark (default), light | `data-theme="light"` on `<html>`; the variables live in `index.css` | My Account → the theme toggle |
| **Colour scheme** | dark: `crimson` (default), `rose`, `maroon`, `plum`, `oled` · light: `rosetint` (default), `brand`, `contrast` | `data-palette-dark` / `data-palette-light` on `<html>`, defined in `lib/palette.ts` and the "Colour schemes" block at the end of `index.css` | `c7Palette.set("dark", "plum")` in the console, or My Account |
| **Density** | comfortable (default), `compact` | `data-density="compact"` on `<html>` (`lib/density.ts`) | My Account → Density |

There is also **navigation style** (rail vs tree, `c7_ui_nav`) — a fifth axis that changes the pane, not
your page, so a page must never depend on it. And the P1/P2 flags in `lib/uiFlags.ts`, which govern whether
specific modernization layers are on.

**A change that only looks right on one combination of those four is not done.** The cheapest check is the
console: set a *different* colour scheme from the default (one light, and `plum` or `rose` — those catch a
hard-coded colour), flip the density, and look at both interfaces.

## 2. Tokens — and why a literal colour is a bug

Colours are **CSS custom properties**, and Tailwind's colour classes are that variable wrapped in
`color-mix` (`tailwind.config.js`): the wrapper exists so an opacity modifier works (`bg-cyber-600/20`), and
the variable exists so the theme and the eight schemes can move the colour.

```js
// apps/web/tailwind.config.js — why `bg-cyber-600/20` is not `var(--cyber-600)` with an alpha
const themed = (variable) => `color-mix(in srgb, var(${variable}) calc(<alpha-value> * 100%), transparent)`;
```

So a hex literal does not merely bypass a preference: it is the one colour on the screen the theme cannot
reach. **Use the token.**

| Purpose | Classes | Notes |
|---|---|---|
| Page and panel surfaces | `bg-navy-950`, `bg-surface`, `bg-surface-light`, `bg-surface-lighter`, `border-surface-border` | `surface` is the panel, `surface-light` the hover, `surface-lighter` the selected |
| Primary accent | `text-cyber-400` / `bg-cyber-600` / `border-cyber-500` | The accent ramp is **crimson** in the shipped schemes, so never say "blue" in a comment |
| Text | `text-white` (primary), `text-gray-300` (secondary), `text-gray-400` (tertiary), `text-gray-500` (muted), `text-gray-600` (muted alt) | These are *themed text tokens*: `text-white` is `--text-primary`, which is near-black on the light theme. Use them for text, never as a "white" fill |
| Alert states | `text-alert-red` / `text-alert-amber` / `text-alert-green` | Red is destructive/overdue, amber waiting/warning, green success |
| Ticket statuses | `.badge-status` plus `.badge-status-<status>` | See §6 |
| The marks | `--brand-crimson` (`#c00000`), `--kumo-red` (`#e3222b`) | Brand constants. `--brand-crimson` is used by the logo and **never by a colour scheme**; `--kumo-red` belongs to Kumo |

**Two places legitimately need literal colours**, and `scripts/lint-design-tokens.mjs` keeps a list with the
reason written beside each entry: (a) anything rendered where CSS does not exist — the print document and
the PDF (`reportKit.tsx`, `PageRenderer.tsx`, `.print-letterhead`, `.ticket-print-only`), because a printed
report must not follow the user's dark theme; and (b) a colour the *user* owns, such as a client's portal
accent. If your change needs a literal, it belongs on that list with a written reason — not silently.

### Type, spacing, radius, elevation, motion

- **Type**: Inter (`font-sans`); JetBrains Mono (`font-mono`) for identifiers, invoice numbers and money in
  a column. The modern theme runs one step down with tighter tracking (see "The modern theme" in
  `index.css`), so write semantic sizes (`text-sm`, `text-xs`) rather than fixed pixel values and both
  interfaces get their own scale.
- **Spacing**: a 4px base — `1 2 3 4 5 6 8 12 16` in Tailwind units, plus `18`/`88`/`100` where a layout
  needs them. Compose with `flex`/`gap` (`gap-2`, `gap-4`) rather than margins between siblings.
- **Radius**: `rounded-lg` (10px) for controls, `rounded-xl` (12px) for cards, `rounded-full` for badges and
  count pills. Those are the `.card`, `.input-field` and `.btn-*` defaults — do not re-specify them.
- **Elevation**: flat by default; `--card-hover-border` and the elevation rules give an interactive card a
  gentle lift on hover. Do not add your own shadow — the four axes move it.
- **Motion**: 150–250ms, `ease-out`, no bounce. Only the three keyframes in the config
  (`animate-fade-in`, `animate-slide-up`, `animate-slide-in-right`). `prefers-reduced-motion` must disable
  all of it; note the arrival ring, which keeps a static ring when its pulse is neutralised.

## 3. The two interfaces

Two **designs** of the same screen, not one screen with a class toggled.

- **Modern** (`redesign === true`) is built from the redesign's own furniture: rails, chips you press,
  sheets, segmented controls, a status track you step along, sentences beside the control that acts, and a
  countable footer.
- **Classic** is a **form**: labelled fields in a grid, a dialog with a heading and Save/Cancel, a table
  where the modern screen has cards, a select where the modern screen has a segmented control.

The shared part is **the state, the API call and the words** — never the layout.

```tsx
// The pattern: one component, one set of handlers, two returns, and the reason at the top of the file.
import { useRedesign } from "../hooks/useNavigationStyle";

export function Example({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const redesign = useRedesign();
  const save = () => { /* one handler, both arrangements */ };

  if (redesign) {
    return (
      <div className="card">
        <span className="chip chip--on">Resolve<span className="chip__n">{ticket.count}</span></span>
        <p className="mt-3 text-xs text-gray-500">Resolving tells the contact their ticket is done.</p>
        <button className="btn-primary mt-3" onClick={save}>Resolve</button>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <h2 className="text-sm font-semibold text-white">Resolve ticket</h2>
      <label className="mt-3 block text-xs text-gray-400">Resolution
        <textarea className="input-field mt-1" />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn-primary">Save</button>
      </div>
    </form>
  );
}
```

- **75 files** already branch on `useRedesign()`. `components/CloseTicketDialog.tsx` and
  `components/PurchaseOrderDialog.tsx` are the canonical examples, and their top-of-file comments explain
  why each arrangement differs.
- If the two arrangements would come out identical, the thing is probably a shared component
  (`components/ui/*`) and belongs there — **say so in a comment** rather than leaving the reader to guess.
- **A modern branch that is a restyle of the classic one is a defect.** If you cannot say what the modern
  arrangement does *differently*, you have not designed it yet.
- Anything one interface keeps and the other deliberately drops is a difference the user will notice: it
  belongs in that feature's Help walkthrough.

**Verify both, every time**: `localStorage.setItem("c7_ui_redesign", "0")` for classic, `removeItem` to
return the browser to the instance's default. Screenshot both. Do not call a UI change done on the strength
of one.

## 4. The component vocabulary — use these, do not re-invent them

`apps/web/src/components/ui` — the shared kit. Read a component's file before using it; two of them already
handle both interfaces for you.

| Component | Props | Use it for |
|---|---|---|
| `PageHeader` | `title`, `subtitle?`, `actions?`, `children?`, `className?`, `variant?: "page" \| "section"`, `icon?` | The header of every page and of every section inside one. **It branches on the interface itself**: one compact row with a sentence beside it in the modern interface, the title + description markup the classic page always had. `variant="section"` is the `h2` + `p` a page used to hand-roll |
| `Section` | `title?`, `actions?`, `children`, `className?` | A titled block of a page |
| `StatCard` | `label`, `value`, `icon?`, `tone?`, `foot?` | One figure with its label; `foot` is the line beneath it |
| `EmptyState` | `icon?`, `title`, `description?`, `action?`, `className?` | Nothing to show — with a way to fix that |
| `Tabs` | `items: TabItem[]` | A tab strip |
| `ListViews` | `views: ListViewOption[]`, `value`, `onChange`, `label` | The "which slice of this am I looking at" strip above a list |
| `ListFooter` | `from`, `to`, `total`, `page`, `pages`, `onPage`, `note?` | The countable footer under a list |
| `Skeleton`, `TableSkeleton`, `PageSkeleton`, `CardSkeleton`, `ReportsSkeleton` | `rows`/`blocks`/`kpis`/`groups`, `className?` | Loading states that respect reduced motion |

CSS component classes, defined once in `index.css` — a change to one is a change to every screen:

| Class | What it is | The rule behind it |
|---|---|---|
| `.card` | `bg-surface border border-surface-border rounded-xl p-5` | The default container. Do not write those four utilities again |
| `.btn-primary`, `.btn-secondary`, `.btn-danger` | The three buttons | `.btn-primary` takes its label colour from `--btn-primary-fg`, because a scheme may need dark text on its accent to stay ≥ 4.5:1 |
| `.input-field` | A form control | Carries `px-3`; a `pl-*` for a leading icon is a deliberate override — see the comment about the nineteen fields that depend on it |
| `.chip`, `.chip--on`, `.chip__n` | A filter or view you press, with the count of what it would show | The chosen one takes the accent: a strip where none of them look chosen is a strip you have to read to interpret |
| `.chip--good`, `.chip--warn`, `.chip--bad` | A chip that reports a state rather than a filter | The label colour is re-shaded for the light theme and the tint follows `currentColor` |
| `.badge`, `.badge-count`, `.badge-status` (+ `-new`, `-open`, `-in_progress`, `-waiting_on_client`, `-waiting_on_vendor`, `-resolved`, `-closed`, `-customer_reopened`) | Counts and statuses | Status colours are tokens, not palette shades, because the light theme fixes the same names to darker values |
| `.nav-item`, `.nav-item--active` | A navigation row, in both panes | The active row's accent is `--nav-accent`, which is per scheme |
| `.tab-active` | The chosen tab of a segmented control | It takes the primary button's fill: on a near-black surface an accent *tint* is not distinguishable from the group it sits in |
| `.print-letterhead`, `.ticket-print-only`, `.ticket-print-activity` | Documents and printing | §8 |
| `.scheme-swatch--<id>` | The palette picker's preview swatch | Literal colours **by definition** — it is a picture of the scheme |

## 5. Page anatomy

A page owns its content; the shell (`components/Layout.tsx`) owns the frame — the header, the navigation,
the command palette, the session warning and the service-alert banner. Do not draw your own top-level
chrome.

```
<PageHeader title="…" subtitle="…" actions={…} />      // the page's name, and what it is for
<Section title="…">…</Section>                          // each block of it
<div className="card">…</div>                           // and a card is the unit inside a section
```

- The `subtitle` is one sentence saying what the page is *for*, and it is the same sentence in both
  interfaces: `Layout.tsx`'s `SECTION_DESCRIPTIONS` map is what the classic header reads, so when a page
  passes its own `subtitle`, **keep the two identical**.
- **Content width** is capped on ultra-wide displays by the P2 content-width rule: do not add your own
  `max-w-*` to a page.
- **Tables**: the modern theme gives them a sticky header, hairline rules and a one-step-smaller type
  scale. Write a plain `<table>` with `<thead>`/`<tbody>` and let the theme do it.
- **Mobile**: the layout is responsive from `lg` down and the sidebar becomes a drawer. Test the narrow
  width for anything that is a row of controls, and prefer `flex-wrap` + `gap` over fixed widths.
- **Adding a destination** is not a special case: declare it in `NAV_TREE` (`components/Layout.tsx`) with
  its permission, and place it in a domain in `lib/navModel.ts`. Both panes read that tree, and anything it
  does not claim appears under "Other" rather than disappearing.

## 6. Status, tone and the meaning of colour

- **Ticket status** uses `.badge-status-<status>`, with the status keys of the shared enums (`new`, `open`,
  `in_progress`, `waiting_on_client`, `waiting_on_vendor`, `resolved`, `closed`, `customer_reopened`).
  Never map a status to a colour by hand.
- **Tone** is the vocabulary for "is this good news": `good` / `warn` / `bad` / `neutral` / `info`, used by
  `.chip--good/warn/bad`, by `StatCard`'s `tone` and by the report kit's `tone` fields. Use it instead of
  choosing a colour.
- **Red means something is wrong** — an alert, a breach, an overdue invoice, a destructive action — never
  emphasis. The navigation uses it for exactly one ordinary row (Service Alerts) and for the Developer
  section, which is deliberately marked as dangerous.
- **A count is a claim about urgency.** If you add a badge, say what it counts, and keep it in step between
  the collapsed and the expanded navigation.

## 7. Accessibility and contrast

- **4.5:1 minimum** for text. The stylesheet records where this was measured: `--text-muted` was raised
  specifically to reach AA on `--surface`, and the light theme re-shades a set of pale tones
  (`.chip--good/warn/bad`, `.text-*-300/400`) because they measured 1.9:1 or worse on white.
- `--btn-primary-fg` exists so a scheme can choose the label colour on its accent. Never hard-code a label
  colour on a filled control.
- **`.badge-count` keeps white text on both themes** because its fill is red on both — do not "fix" it to a
  theme token; the comment on the rule says why.
- **Keyboard**: every interactive element is reachable, dialogs trap focus and close on Escape. The context
  menus and the command palette have their own keyboard handling — reuse it.
- **Focus** is visible. Do not remove an outline without putting a ring back.
- **`prefers-reduced-motion`** disables animation, so anything that moves must still say what it was saying
  when the motion is gone.
- **A control somebody may not use because of a *permission* is not drawn**, and the API refuses the same
  thing — a hidden control and a refused request are one answer. A control blocked by *state* (a field not
  filled in yet) is the opposite case: disable it, and say why beside it.

## 8. Documents and printing are a third surface

PDFs and the print view are neither interface: there is no CSS there, so they use literal colours and their
own type scale, and they must **not** follow the user's theme. `.print-letterhead` (the shield, the
wordmark, the who/where line), `.ticket-print-only` and `.ticket-print-activity` are the vocabulary, and
`lib/documentBrand.ts` holds the assets. A generated document's brand is part of the change that generates
it — `components/reports/reportKit.tsx` shows how the section-based document is composed.

## 9. Definition of done for any interface change

1. **Designed for both interfaces**, and it is obvious what the modern arrangement does differently.
2. **Verified on both**, with the screenshot of each (`c7_ui_redesign` 0 and 1).
3. **Verified on a non-default colour scheme** (one light, plus `plum` or `rose`) and on `compact` density.
4. **No new colour literals**: `node scripts/lint-design-tokens.mjs` passes. (It is not one of the `guard:*`
   npm scripts; run it directly.)
5. **No route left unguarded or undocumented**: `node scripts/check-route-guards.mjs` and, if the Help
   changed, `node scripts/check-help-links.mjs`.
6. **The Help says what changed** — the walkthrough, the Index rows, the configuration reference if a
   setting or flag moved, and an FAQ entry if a user would plausibly ask.
7. **Both apps type-check**: `npx tsc --noEmit -p tsconfig.json` in `apps/web` (and `apps/api` if you
   touched it) at exit 0.
8. **The records are updated**: a `BuildNotes.md` entry (`node scripts/next-version.mjs`, then
   `node scripts/generate-buildnotes.mjs`) and the prompt logged in `Retrace.md`.

A purely visual change still owes 1–4 and 7–8. A change to a permission, route, default or flag
additionally owes 5–6.

## 10. Anti-patterns, with the real examples

- **A hex literal in a component.** It cannot be reached by the theme or by any of the eight schemes. The
  guard flags it; the legitimate exceptions are listed with reasons in `scripts/lint-design-tokens.mjs`.
- **A modern branch that is the classic one with different classes.** If the two arrangements share their
  layout, the feature is a shared component instead.
- **Hand-rolling a header, a card or a button** instead of `PageHeader`, `.card` and `.btn-*`. Three
  versions of the same header is how a design system dies.
- **Reading a flag for one small detail** and calling that a second design. The flag is for the whole
  arrangement; a detail that is the same in both belongs in the shared component.
- **Using a raw Tailwind palette class** (`text-red-400`, `bg-cyan-500/20`) as a colour. Some are re-mapped
  for the light theme as a *compatibility list* — that list is a debt, not a licence. A palette class that
  is not in it simply fails on one of the two themes.
- **Naming a colour in a comment.** The accent ramp is crimson in the shipped schemes; "the blue border" is
  already wrong.
- **Assuming the default scheme.** The eight schemes exist; an `rgba()` that looks right on `crimson` is
  invisible on `oled` and unreadable on `contrast`.

## 11. Where the truth lives

| Question | File |
|---|---|
| What colour/type/radius may I use? | `apps/web/tailwind.config.js` and `apps/web/src/index.css` (variables, component classes, the modern theme, the schemes) |
| Which colour schemes exist, and how are they switched? | `apps/web/src/lib/palette.ts` · rollback: `UI-PALETTE-ROLLBACK.md` |
| Which interface is this, and what does the redesign change? | `apps/web/src/hooks/useNavigationStyle.ts` · `INTERFACE-ROLLBACK.md` |
| Which flag turns this layer off, and where? | `apps/web/src/lib/uiFlags.ts` (plus `NAV-PANE-ROLLBACK.md`, `UI-P1-ROLLBACK.md`, `CONTEXT-MENUS-ROLLBACK.md`, `KUMO-*-ROLLBACK.md`) |
| What is in the shared kit? | `apps/web/src/components/ui/` |
| What owns the page frame, the nav tree and the palette? | `apps/web/src/components/Layout.tsx` · `apps/web/src/lib/navModel.ts` |
| What is a generated document made of? | `apps/web/src/lib/documentBrand.ts` · `apps/web/src/components/reports/reportKit.tsx` |
| What does this feature look like as a design? | `docs/mockups/*.html` — the approved sketches a screen should match |

## 12. Changing this document

This file is part of the design system, not commentary on it. Change it **in the same commit** as the code
change that makes it true:

- A new token, component class or shared component: add it here with the rule it exists to enforce.
- A new axis, flag or scheme: add it to §1 or §11.
- A guard that changes what is allowed: update §9 and the guard's own comment together.
- A rule you cannot point at in the code: it does not belong here. Either enforce it somewhere, or move it
  to `docs/mockups/` as a proposal.

