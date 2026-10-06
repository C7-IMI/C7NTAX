import { useEffect, useRef, useState } from "react";
import { Palette } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { getPalette, paletteById, setPalette, type PaletteMode } from "../lib/palette";
import { PaletteSchemeList } from "./PaletteSchemeList";

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

  const active = paletteById(current);

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
          <PaletteSchemeList mode={mode} current={current} onSelect={choose} />
        </div>
      )}
    </div>
  );
}
