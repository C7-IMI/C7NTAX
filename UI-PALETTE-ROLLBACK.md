# Colour schemes — guide & rollback

C7NTAX ships nine selectable schemes: the built-in **Classic** theme plus five
dark and three light alternates. A scheme only sets CSS custom properties
(colours), applied through `data-palette-dark` / `data-palette-light` on
`<html>` — so it cannot affect data, routing or behaviour.

| Mode | id | Name | Character |
|---|---|---|---|
| dark | *(none)* | Classic | The original navy + cyber-blue theme |
| dark | `crimson` | Brand Crimson | Near-black neutral surfaces, brand crimson accent |
| dark | `rose` | Crimson Rose | Noir surfaces with the brand rose accent |
| dark | `maroon` | Deep Maroon | Surfaces tinted from the brand maroon (`#662428`) |
| dark | `plum` | Plum Noir | Surfaces tinted from the brand plum (`#801550`) |
| dark | `oled` | True Black | Pure black surfaces with the brand crimson |
| light | *(none)* | Classic | The original neutral light theme |
| light | `brand` | Brand Light | White surfaces with the brand crimson |
| light | `rosetint` | Rose Tint | Soft rose-tinted whites, crimson accents |
| light | `contrast` | High Contrast | AAA-leaning text with crisp borders |

All schemes are built from the brand palette in the brand asset composite sheet —
**`#C00000`** crimson, **`#EE5483`** rose, **`#662428`** maroon, **`#801550`**
plum, plus black and white.

Dark and light are chosen independently: the scheme that applies is the one
matching the active theme.

## How to use it

- Click the **palette icon** in the header toolbar (next to the density and
  theme controls) and pick a scheme for the current mode.
- Every scheme is audited to **>= 4.5:1 (WCAG AA)** for body text, secondary,
  tertiary and muted text, accent-on-surface and the primary-button label —
  **112/112 checks** pass.
- Why the dark accents are not `#C00000` directly: the brand crimson is only
  **3.0:1** against a near-black surface, so it cannot be used for text there.
  The dark schemes therefore use the lighter crimson tints (`#ff5c5c`) or the
  rose for accent text/icons, and reserve `#C00000` for fills that carry a
  **white label (6.48:1)** — which is exactly how the brand sheet uses it.
- The built-in Classic theme's dark primary button remains white on `#00aae0`
  at **2.68:1**; every brand scheme fixes its own button via `--btn-primary-fg`.

## Rollback

### Level 1 — Instant (browser only, no rebuild)

```js
c7Palette.list();                                  // every available scheme
c7Palette.set("dark", "midnight");                 // try one
c7Palette.reset();                                 // back to Classic (both modes)

localStorage.removeItem("c7_palette_dark");        // dark only
localStorage.removeItem("c7_palette_light");       // light only
```

Changes apply immediately (no reload needed) because the schemes are pure CSS.

### Level 2 — Hide the feature

Add to `apps/web/.env.local` and restart the web server, or set the key in the
browser and reload:

```
VITE_UI_PALETTE=false
```

```js
localStorage.setItem("c7_ui_palette", "0"); location.reload();   // picker hidden
```

Hiding the picker does **not** clear a stored scheme — reset it first (Level 1)
if you want the built-in theme back.

### Level 3 — Remove the code entirely

Files added/changed by the colour schemes:

- `apps/web/src/lib/palette.ts` (catalogue, persistence, `applyPalettes`)
- `apps/web/src/components/PalettePicker.tsx` (header control)
- `apps/web/src/index.css` — the `── Colour schemes ──` block at the end, plus
  `.btn-primary`'s `color: var(--btn-primary-fg, var(--text-primary))` (which is
  identical to the previous `text-white` when nothing overrides the variable)
- `apps/web/src/lib/uiFlags.ts` (`UI_PALETTE`)
- `apps/web/src/main.tsx` (`applyPalettes()` + the `c7Palette` helper)
- `apps/web/src/components/Layout.tsx` (`{UI_PALETTE && <PalettePicker />}`)

Deleting the `── Colour schemes ──` CSS block alone returns every mode to
Classic, even if the picker is still rendered.

## Notes

- **Default is Classic** — nothing changes until a scheme is chosen, and the
  built-in theme blocks are never modified by this feature.
- Schemes are scoped to their theme (`html:not([data-theme="light"])[…]` for
  dark), so a stored light choice can never leak dark tokens.
- The 118 raw hex literals in the nine allowlisted `.tsx` files
  (`Calendar`, `Monitors`, `PTO`, `Quotes`, `Reports`, `Webhooks`, `AiActions`,
  `Layout`, `main`) bypass these variables, so those surfaces keep their original
  colours under any scheme — tracked by `scripts/lint-design-tokens.mjs`.
- Dark schemes with a bright accent use dark button labels (`--btn-primary-fg`);
  schemes with a deep accent use white labels. Both are contrast-checked.
