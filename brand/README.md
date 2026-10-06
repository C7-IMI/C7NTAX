# C7NTAX brand assets

## `brand/` — slices from the brand asset composite sheet

These are **raster crops taken from the supplied composite sheet** (`BRAND ASSET
COMPOSITE SHEET`, 768×768 PNG) on 2026-10-06. They are kept here as reference /
placeholder art, not as production artwork.

| File | Region on the sheet | Size |
|---|---|---|
| `wordmark-primary.png` | Primary wordmark (as requested) | 330×98 |
| `logo-small-512.png` | Wordmark variation — Logo (Small 512px) | 160×42 |
| `logo-medium-1024.png` | Wordmark variation — Logo (Medium 1024px) | 205×62 |
| `logo-large-2048.png` | Wordmark variation — Logo (Large 2048px) | 275×78 |
| `mark-7-core.png` | Standalone icon — Core "7" icon | 82×140 |
| `mark-7-small.png` | Standalone icon — small "7" | 58×58 |
| `app-icon-grid.png` | App icon grid (64/128/256/512) | 272×102 |
| `shield-outline.png` | Icon variation — outlined shield (on checkerboard) | 70×80 |
| `shield-dark.png` | Icon variation — shield on black tile | 74×74 |
| `shield-light.png` | Icon variation — shield on white tile | 73×74 |
| `shield-glyph.png` | The shield + "7" glyph, cropped inside the black tile | 60×60 |
| `colour-palette-and-typeface.png` | Colour palette + C7NTAX SANS specimen | 330×150 |
| `wordmark-on-dark.png` | Wordmark rendered for dark surfaces — white letters, crimson 7 | 654×156 |
| `wordmark-on-light.png` | Wordmark rendered for light surfaces — near-black letters, crimson 7 | 654×156 |

### Quality caveats — please read before using these in product

The composite is a **rendered marketing mockup**, not a sliceable asset pack:

1. **The transparency checkerboard is baked into the pixels.** There is no real
   alpha channel, so anything cropped from an unplated area carries the
   checkerboard with it.
2. **A red glow is composited over the panels.** It washes the narrow strip
   *above* each plated icon (the black shield tile sits at x 545–618,
   y 429–502; the glow band is y 406–428) and tints the whole wordmark panel
   pink, so the wordmark crops are not usable on a clean background.
3. **Resolution is low.** The sheet is 768×768, so the largest icon is ~74px and
   the primary wordmark ~330px wide. Anything larger than that is an upscale.
4. Section headings, watermark text and the "download" affordances sit between
   the assets, so crops include neighbouring UI.

### Corrected icon crops (2026-10-06)

The icon-variation crops were first taken ~23px too high, which pulled in the
glow strip above the black tile and sliced the bottom off the shield — in the
favicon that showed up as a pink checkerboard bar along the top with a clipped
"7". The tiles actually sit at:

| Tile | Bounds on the sheet | Size |
|---|---|---|
| Black tile (shield + "7") | x 545–618, y 429–502 | 74×74 |
| White tile | x 642–714, y 429–502 | 73×74 |
| Outlined shield | x 443–512, y 425–504 | 70×80 |

Inside the black tile the shield's strict bounding box is x 559–604, y 439–488
(46×50) — margins L=14, R=14, T=10, B=14. The tile is uniformly black
(`#000000`–`#050102`) right out to its edges, so any crop taken **inside** it
carries no checkerboard and no glow. `shield-glyph.png` is that interior crop
(60×60, centred on the shield), and is the source for the app icons.

### Wordmark, keyed to transparency (2026-10-06)

The wordmark variations are all the same logotype — **C 7 N T A X** — rendered at
several sizes down the sheet's left column. When they were first sliced they were
cut short at the bottom, so the geometry below was re-measured. On the sheet the
logotype is:

| Element | Sheet bounds |
|---|---|
| Full logotype (incl. the 7's tail) | x 51–377, y 449–526 (327×78) |
| Letters `C N T A X` (cap height) | y 449–498 |
| The `7` — crimson, with a descending tail | x 101–155, y 449–~525 |

Two things make this awkward to key out:

1. **The letters are pure white** (`#FFFFFF`) on a mid-tone plate (luma ≈ 100–160),
   so they separate cleanly on luminance.
2. **The 7 is crimson — and so is the plate behind it**, because the mockup's red
   glow washes that whole area pink. The 7's *hue* overlaps the wash; only its
   **saturation** separates them (the stroke sits at `G/R ≈ 0.15`, the wash at
   `0.4–0.9`). Keying the 7 therefore uses a saturation threshold, not luminance.

The 7's tail runs ~25px below the letters' baseline. That is not a slicing
error — the standalone `mark-7-core.png` is 82×140, i.e. taller than it is wide,
so a long-tailed 7 is the brand's own treatment.

**App assets** live in `apps/web/public/brand/` and are used as CSS masks rather
than as pictures, which is what removes the plate: `wordmark-mask.png` (letters)
paints with the inherited text colour, and `wordmark-7-mask.png` (the 7) paints
with `--brand-crimson`. One pair of files therefore works on every surface — no
plate, and no separate light/dark copies. The flat `wordmark-on-dark.png` /
`wordmark-on-light.png` in this folder are for places that cannot use CSS masks
(email templates, docs).

**Recommended path:** supply the original vector (SVG/AI) or the high-resolution
source referenced on the sheet ("High Res Source: <IMAGE 0>"). With that, the
web icons, sidebar mark, login wordmark and email header can all be regenerated
crisply at any size.

## What the application actually uses

The app does **not** hot-link the mockup crops. It uses:

- `apps/web/public/favicon.png` (32), `apple-touch-icon.png` (180),
  `icon-192.png`, `icon-512.png` — built from `brand/shield-glyph.png` on a flat
  black plate with a rounded mask (radius ≈ 17% of the side) and the shield drawn
  at 88% of the plate, so the glyph is centred with an even margin and the plate
  edges stay crisp. When changing these, verify the art clears the plate edge —
  a clipped "7" is the failure mode to watch for.
- The **wordmark logotype** via a reusable `<Wordmark>` component
  (`apps/web/src/components/Wordmark.tsx`, styled by `.c7-wordmark` in
  `index.css`) — the sheet's own letterforms through the two masks above, so it
  has no plate behind it and follows the active scheme. It is used by the My
  Account menu, the initial loading screen and the login page.
  `apps/web/public/brand/wordmark-on-dark.png` is a served copy of the flat
  artwork: the pre-JS splash in `index.html` uses it, because the splash cannot
  rely on the bundle's CSS. The sidebar still renders the wordform as **text**
  (`C` + a brand-crimson `7` + `NTAX`), which stays crisp at any size.
- The **shield mark** via `<BrandMark>` (`apps/web/src/components/BrandMark.tsx`)
  — `icon-192.png`, the shield on its black tile. Used by the loading screen,
  both login screens and the sidebar.
- The **brand palette** (`#C00000` / `#EE5483` / `#662428` / `#801550`) across
  the eight colour schemes — see `UI-PALETTE-ROLLBACK.md`.

At 32–40px the mockup artifacts are not visible, which is why the extracted icon
is fine for the favicon and the sidebar mark but not for large placements.
