import { Check } from "lucide-react";
import { palettesFor, swatchClass, type PaletteMode } from "../lib/palette";

/**
 * The scheme list for one mode. Shared by the header picker and the
 * My Account menu so both stay in sync from a single definition.
 */
export function PaletteSchemeList({
  mode,
  current,
  onSelect,
  className = "",
}: {
  mode: PaletteMode;
  current: string;
  onSelect: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={className} role="group" aria-label={`${mode} colour schemes`}>
      {palettesFor(mode).map(p => (
        <button
          key={p.id}
          type="button"
          role="menuitemradio"
          aria-checked={current === p.id}
          onClick={() => onSelect(p.id)}
          className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left transition-colors ${
            current === p.id ? "bg-surface-lighter text-white" : "text-gray-300 hover:bg-surface-lighter hover:text-white"
          }`}
        >
          <span className={`scheme-swatch ${swatchClass(p.id)} w-6 h-6 rounded shrink-0 border border-surface-border`} />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium">{p.label}</span>
            <span className="block text-[10px] text-gray-500 truncate">{p.blurb}</span>
          </span>
          {current === p.id && <Check size={14} className="shrink-0" />}
        </button>
      ))}
    </div>
  );
}
