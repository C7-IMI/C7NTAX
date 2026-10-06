import { useEffect, useRef, useState } from "react";
import { Check, Palette } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { CLASSIC, getPalette, palettesFor, setPalette, swatchClass, type PaletteMode } from "../lib/palette";

/**
 * Header control for choosing a colour scheme for the active theme.
 * Purely additive: the stored choice is applied through data-palette-* on
 * <html>, and "Classic" removes the attribute entirely.
 */
export function PalettePicker() {
  const { theme } = useTheme();
  const mode = theme as PaletteMode;
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(() => getPalette(mode));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrent(getPalette(mode));
  }, [mode]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (id: string) => {
    setCurrent(setPalette(mode, id));
    setOpen(false);
  };

  const options = palettesFor(mode);
  const active = options.find(p => p.id === current);

  const rowClass = (id: string) =>
    `w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left transition-colors ${
      current === id ? "bg-surface-lighter text-white" : "text-gray-300 hover:bg-surface-lighter hover:text-white"
    }`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="px-2.5 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-surface-lighter rounded-md transition-colors flex items-center gap-1.5"
        title={active ? `Colour scheme: ${active.label}` : `Colour scheme (${mode})`}
        aria-label="Change colour scheme"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Palette size={14} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 rounded-lg border border-surface-border bg-surface shadow-lg p-1.5 z-50"
        >
          <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-gray-500">
            {mode === "dark" ? "Dark schemes" : "Light schemes"}
          </p>
          <button role="menuitemradio" aria-checked={current === CLASSIC} onClick={() => choose(CLASSIC)} className={rowClass(CLASSIC)}>
            <span className={`scheme-swatch ${swatchClass(CLASSIC, mode)} w-6 h-6 rounded shrink-0 border border-surface-border`} />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium">Classic</span>
              <span className="block text-[10px] text-gray-500 truncate">Built-in {mode} theme</span>
            </span>
            {current === CLASSIC && <Check size={14} className="shrink-0" />}
          </button>

          {options.map(p => (
            <button key={p.id} role="menuitemradio" aria-checked={current === p.id} onClick={() => choose(p.id)} className={rowClass(p.id)}>
              <span className={`scheme-swatch ${swatchClass(p.id, mode)} w-6 h-6 rounded shrink-0 border border-surface-border`} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">{p.label}</span>
                <span className="block text-[10px] text-gray-500 truncate">{p.blurb}</span>
              </span>
              {current === p.id && <Check size={14} className="shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
