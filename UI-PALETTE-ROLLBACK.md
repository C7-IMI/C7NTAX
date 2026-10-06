# Colour schemes — guide & rollback

C7NTAX ships eight selectable schemes — five dark and three light — built from
the brand palette. There is **no unstyled option**: the brand defaults
**Brand Crimson** (dark) and **Rose Tint** (light) are always active until
another scheme is chosen. A scheme only sets CSS custom properties (colours),
applied through `data-palette-dark` / `data-palette-light` on `<html>` — so it
cannot affect data, routing or behaviour.

| Mode | id | Name | Character |
|---|---|---|---|
| dark | `crimson` | **Brand Crimson** *(default)* | Near-black neutral surfaces, brand crimson accent |
| dark | `rose` | Crimson Rose | Noir surfaces with the brand rose accent |
| dark | `maroon` | Deep Maroon | Surfaces tinted from the brand maroon (`#662428`) |
| dark | `plum` | Plum Noir | Surfaces tinted from the brand plum (`#801550`) |
| dark | `oled` | True Black | Pure black surfaces with the brand crimson |
| light | `brand` | Brand Light | White surfaces with the brand crimson |
| light | `rosetint` | **Rose Tint** *(default)* | Soft rose-tinted whites, crimson accents |
| light | `contrast` | High Contrast | AAA-leaning text with crisp borders |

All schemes are built from the brand palette in the brand asset composite sheet —
**`#C00000`** crimson, **`#EE5483`** rose, **`#662428`** maroon, **`#801550`**
plum, plus black and white.

Dark and light are chosen independently: the scheme that applies is the one
matching the active theme.

## How to use it

- **My Account → Appearance** (header toolbar, far right) — identity, profile
  and security links, the dark/light switch, the colour scheme list and density.
- **Palette icon** in the header toolbar — the same scheme list in a small
  popover. Kept for now; it becomes redundant once My Account is the primary
  account surface.
- Both surfaces read from one component (`PaletteSchemeList`), so they can't
  drift apart.
- Every scheme is audited to **>= 4.5:1 (WCAG AA)** for body text, secondary,
  tertiary and muted text, accent-on-surface and the primary-button label —
  **80/80 checks** pass.
- Why the dark accents are not `#C00000` directly: the brand crimson is only
  **3.0:1** against a near-black surface, so it cannot be used for text there.
  The dark schemes therefore use the lighter crimson tints (`#ff5c5c`) or the
  rose for accent text/icons, and reserve `#C00000` for fills that carry a
  **white label (6.48:1)** — which is exactly how the brand sheet uses it.

## Rollback

### Level 1 — Instant (browser only, no rebuild)

```js
c7Palette.list();                                  // every scheme (+ [default] marker)
c7Palette.set("dark", "rose");                     // try one
c7Palette.reset();                                 // back to the brand defaults
c7Palette.get("light");                            // current light scheme

localStorage.removeItem("c7_palette_dark");        // dark -> default on reload
localStorage.removeItem("c7_palette_light");       // light -> default on reload
```

Changes apply immediately (no reload needed) because the schemes are pure CSS.
An unknown or retired id (e.g. a scheme removed in a later release) falls back
to the brand default automatically.

### Level 2 — Hide the feature

Add to `apps/web/.env.local` and restart the web server, or set the key in the
browser and reload:

```
VITE_UI_PALETTE=false
```

```js
localStorage.setItem("c7_ui_palette", "0"); location.reload();   // picker hidden
```

Hiding the picker does **not** change a stored scheme — use `c7Palette.reset()`
(Level 1) to return to the brand defaults.

### Level 3 — Remove the code entirely

Files added/changed by the colour schemes:

- `apps/web/src/lib/palette.ts` (catalogue, defaults, persistence, `applyPalettes`)
- `apps/web/src/components/PaletteSchemeList.tsx` (shared scheme list)
- `apps/web/src/components/PalettePicker.tsx` (header popover)
- `apps/web/src/components/MyAccountMenu.tsx` (also renders the scheme list)
- `apps/web/src/index.css` — the `── Colour schemes ──` block at the end, plus
  `.btn-primary`'s `color: var(--btn-primary-fg, var(--text-primary))` (which is
  identical to the previous `text-white` when nothing overrides the variable)
- `apps/web/src/lib/uiFlags.ts` (`UI_PALETTE`)
- `apps/web/src/main.tsx` (`applyPalettes()` + the `c7Palette` helper)
- `apps/web/src/components/Layout.tsx` (`{UI_PALETTE && <PalettePicker />}` and
  `<MyAccountMenu />`)
- `apps/web/src/pages/Settings.tsx` (section anchors for the My Account links)

## Notes

- **Default is Brand Crimson (dark) / Rose Tint (light).** Both attributes are
  always set; there is no unstyled state and no Classic option in the picker.
- Because the brand defaults are CSS overrides, the base theme blocks at the top
  of `index.css` remain as the token foundation — deleting the
  `── Colour schemes ──` block would fall back to navy/cyan rather than to
  another brand scheme, so change the defaults in `palette.ts` instead.
- Schemes are scoped to their theme (`html:not([data-theme="light"])[…]` for
  dark), so a stored light choice can never leak dark tokens.
- The 118 raw hex literals in the nine allowlisted `.tsx` files
  (`Calendar`, `Monitors`, `PTO`, `Quotes`, `Reports`, `Webhooks`, `AiActions`,
  `Layout`, `main`) bypass these variables, so those surfaces keep their original
  colours under any scheme — tracked by `scripts/lint-design-tokens.mjs`.
- Dark schemes with a bright accent use dark button labels (`--btn-primary-fg`);
  schemes with a deep accent use white labels. Both are contrast-checked.
