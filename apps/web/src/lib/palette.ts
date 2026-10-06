/**
 * Colour schemes (palettes) — see UI-PALETTE-ROLLBACK.md.
 *
 * A scheme only sets CSS custom properties, applied through the
 * data-palette-dark / data-palette-light attributes on <html>; the definitions
 * live in the "Colour schemes" block at the end of apps/web/src/index.css.
 * "classic" means "no attribute", i.e. the built-in theme, which is never
 * modified by this feature.
 *
 * Instant rollback — browser console, then reload:
 *   c7Palette.reset()                                  // back to Classic
 *   localStorage.removeItem("c7_palette_dark")         // dark only
 *   localStorage.removeItem("c7_palette_light")        // light only
 */
export type PaletteMode = "dark" | "light";

export type PaletteDef = {
  id: string;
  label: string;
  mode: PaletteMode;
  blurb: string;
};

export const CLASSIC = "classic";

export const PALETTES: PaletteDef[] = [
  { id: "midnight", label: "Midnight Slate", mode: "dark", blurb: "Neutral graphite, keeps the brand cyan" },
  { id: "violet", label: "Deep Violet", mode: "dark", blurb: "Near-black surfaces with a violet accent" },
  { id: "carbon", label: "Warm Carbon", mode: "dark", blurb: "Warm graphite with an amber accent" },
  { id: "oled", label: "True Black (OLED)", mode: "dark", blurb: "Pure black, easiest on OLED displays" },
  { id: "ocean", label: "Ocean Teal", mode: "dark", blurb: "Deep teal surfaces with an aqua accent" },
  { id: "paper", label: "Cool Paper", mode: "light", blurb: "Faintly cool white, AA-clean accents" },
  { id: "stone", label: "Warm Stone", mode: "light", blurb: "Warm paper tones with a teal accent" },
  { id: "contrast", label: "High Contrast", mode: "light", blurb: "AAA-leaning text, crisp borders" },
];

const STORAGE_KEY: Record<PaletteMode, string> = {
  dark: "c7_palette_dark",
  light: "c7_palette_light",
};

const ATTRIBUTE: Record<PaletteMode, string> = {
  dark: "data-palette-dark",
  light: "data-palette-light",
};

export function palettesFor(mode: PaletteMode): PaletteDef[] {
  return PALETTES.filter(p => p.mode === mode);
}

export function paletteById(id: string): PaletteDef | undefined {
  return PALETTES.find(p => p.id === id);
}

/** Swatch class for the picker preview (colours live in CSS, not in .tsx). */
export function swatchClass(id: string, mode: PaletteMode): string {
  if (id === CLASSIC) return mode === "light" ? "scheme-swatch--classic-light" : "scheme-swatch--classic";
  return `scheme-swatch--${id}`;
}

export function getPalette(mode: PaletteMode): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY[mode]);
    if (saved && paletteById(saved)?.mode === mode) return saved;
  } catch {
    /* localStorage unavailable — fall back to Classic */
  }
  return CLASSIC;
}

function applyOne(mode: PaletteMode, id: string): void {
  const root = document.documentElement;
  if (id === CLASSIC) root.removeAttribute(ATTRIBUTE[mode]);
  else root.setAttribute(ATTRIBUTE[mode], id);
}

/** Applies both stored selections — called before first paint in main.tsx. */
export function applyPalettes(): void {
  applyOne("dark", getPalette("dark"));
  applyOne("light", getPalette("light"));
}

/** Stores and applies a scheme for one mode. Returns the id that took effect. */
export function setPalette(mode: PaletteMode, id: string): string {
  const valid = id === CLASSIC || paletteById(id)?.mode === mode;
  const next = valid ? id : CLASSIC;
  try {
    if (next === CLASSIC) localStorage.removeItem(STORAGE_KEY[mode]);
    else localStorage.setItem(STORAGE_KEY[mode], next);
  } catch {
    /* ignore */
  }
  applyOne(mode, next);
  return next;
}

/** Back to the built-in theme for both modes. */
export function resetPalettes(): void {
  setPalette("dark", CLASSIC);
  setPalette("light", CLASSIC);
}
