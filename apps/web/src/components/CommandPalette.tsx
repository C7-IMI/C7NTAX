import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CornerDownLeft, Search } from "lucide-react";

/** A single runnable entry shown in the command palette. */
export type PaletteItem = {
  id: string;
  label: string;
  group?: string;
  keywords?: string;
  run: () => void;
};

/**
 * ⌘K / Ctrl-K command palette. Purely additive: it renders nothing unless
 * `open` is true, and is mounted only when the P1 flag is enabled.
 */
export function CommandPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: PaletteItem[];
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => `${it.label} ${it.group ?? ""} ${it.keywords ?? ""}`.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = results[index];
        if (item) {
          item.run();
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, results, index, onClose]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4 bg-black/50"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg card !p-0 overflow-hidden shadow-2xl animate-slide-up"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 px-4 border-b border-surface-border">
          <Search size={16} className="text-gray-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages and actions…"
            className="flex-1 bg-transparent border-0 outline-none text-sm text-white placeholder-gray-500 py-3"
            aria-label="Search pages and actions"
          />
          <kbd className="text-[10px] text-gray-500 border border-surface-border rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">No matches</p>
          ) : (
            results.map((it, i) => (
              <button
                key={it.id}
                type="button"
                data-index={i}
                onMouseEnter={() => setIndex(i)}
                onClick={() => {
                  it.run();
                  onClose();
                }}
                className={`w-full flex items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors ${
                  i === index ? "bg-surface-lighter text-white" : "text-gray-300"
                }`}
              >
                <span className="truncate">{it.label}</span>
                {it.group ? <span className="text-[10px] uppercase tracking-wide text-gray-500 shrink-0">{it.group}</span> : null}
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-4 px-4 py-2 border-t border-surface-border text-[10px] text-gray-500">
          <span className="flex items-center gap-1">
            <ArrowUp size={11} />
            <ArrowDown size={11} /> navigate
          </span>
          <span className="flex items-center gap-1">
            <CornerDownLeft size={11} /> open
          </span>
        </div>
      </div>
    </div>
  );
}
