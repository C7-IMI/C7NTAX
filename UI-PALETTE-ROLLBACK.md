# Colour schemes — guide & rollback

C7NTAX ships nine selectable schemes: the built-in **Classic** theme plus five
dark and three light alternates. A scheme only sets CSS custom properties
(colours), applied through `data-palette-dark` / `data-palette-light` on
`<html>` — so it cannot affect data, routing or behaviour.

| Mode | id | Name | Character |
|---|---|---|---|
| dark | *(none)* | Classic | The original navy + cyber-blue theme |
| dark | `midnight` | Midnight Slate | Neutral graphite surfaces, keeps the brand cyan |
| dark | `violet` | Deep Violet | Near-black surfaces with a violet accent |
| dark | `carbon` | Warm Carbon | Warm graphite with an amber accent |
| dark | `oled` | True Black | Pure black surfaces, easiest on OLED displays |
| dark | `ocean` | Ocean Teal | Deep teal surfaces with an aqua accent |
| light | *(none)* | Classic | The original neutral light theme |
| light | `paper` | Cool Paper | Faintly cool white, AA-clean accents and status colours |
| light | `stone` | Warm Stone | Warm paper tones with a teal accent |
| light | `contrast` | High Contrast | AAA-leaning text with crisp borders |

Dark and light are chosen independently: the scheme that applies is the one
matching the active theme.

## How to use it

- Click the **palette icon** in the header toolbar (next to the density and
  theme controls) and pick a scheme for the current mode.
- Every alternate scheme is audited to **>= 4.5:1 (WCAG AA)** for body text,
  muted text, accent-on-surface and the primary-button label — 96/96 checks.
  Note the built-in Classic theme's dark primary button is **2.68:1** (white on
  `#00aae0`); the alternates fix this via `--btn-primary-fg`. Say the word if you
  want the Classic palette corrected too.

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
