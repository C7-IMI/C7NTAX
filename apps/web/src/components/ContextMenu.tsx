import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useContextMenusEnabled } from "../hooks/useContextMenusEnabled";

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect?: () => void;
  /** Right-aligned shortcut or hint text. */
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Shows a tick — used for the value that is already set. */
  checked?: boolean;
  items?: MenuEntry[];
}

export interface MenuHeading {
  heading: string;
}

export type MenuEntry = MenuItem | "separator" | MenuHeading;

export interface MenuState {
  x: number;
  y: number;
  entries: MenuEntry[];
  title?: string;
  subtitle?: string;
}

const isHeading = (e: MenuEntry | undefined): e is MenuHeading => typeof e === "object" && e !== null && "heading" in e && !("label" in e);
const isItem = (e: MenuEntry | undefined): e is MenuItem => typeof e === "object" && e !== null && "label" in e;
const isSelectable = (e: MenuEntry | undefined): e is MenuItem => isItem(e) && !e.disabled;

const PANEL = "py-1 bg-navy-800 border border-surface-border rounded-lg shadow-xl";
const ROW = "w-full flex items-center gap-2.5 px-3 py-[7px] text-sm text-left select-none rounded-[4px]";

/** Text fields keep the browser's own menu, so cut/copy/paste and spell-check still work there. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable ||
    !!target.closest("input, textarea, [contenteditable='true']");
}

/**
 * Application-style right-click menu. Any screen can call `open` from its own
 * `onContextMenu`; nothing is registered globally, so sections that do not opt
 * in keep the browser's menu.
 */
export function useContextMenu() {
  const [menuState, setMenuState] = useState<MenuState | null>(null);
  const enabled = useContextMenusEnabled();

  const open = useCallback(
    (event: React.MouseEvent, entries: MenuEntry[], header?: { title?: string; subtitle?: string }, options?: { allowInTextEntry?: boolean }) => {
      if (!enabled) return;
      // Plain fields keep the browser menu (cut/copy/paste, spell-check). A purpose-built editor
      // can opt back in, since it supplies its own clipboard and formatting entries.
      if (!options?.allowInTextEntry && isTextEntryTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      setMenuState({ x: event.clientX, y: event.clientY, entries, ...header });
    },
    [enabled]
  );

  /** Opens under an element — for the keyboard route (Shift+F10 / Menu key). */
  const openForElement = useCallback(
    (element: HTMLElement | null, entries: MenuEntry[], header?: { title?: string; subtitle?: string }) => {
      if (!enabled || !element) return;
      const rect = element.getBoundingClientRect();
      setMenuState({ x: Math.min(rect.left + 12, window.innerWidth - 24), y: rect.bottom - 4, entries, ...header });
    },
    [enabled]
  );

  const close = useCallback(() => setMenuState(null), []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent, element: HTMLElement | null, entries: MenuEntry[], header?: { title?: string; subtitle?: string }) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        openForElement(element, entries, header);
      }
    },
    [openForElement]
  );

  return { menuState, open, openForElement, close, onKeyDown };
}

export function ContextMenu({ state, onClose }: { state: MenuState | null; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const enabled = useContextMenusEnabled();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [active, setActive] = useState(-1);
  const [submenu, setSubmenu] = useState<number | null>(null);
  const [flipSubmenu, setFlipSubmenu] = useState(false);
  /** Whether the open submenu should take focus (true only for the keyboard route). */
  const submenuByKeyboard = useRef(false);

  const selectableIndices = useMemo(
    () => state?.entries.map((e, i) => (isSelectable(e) ? i : -1)).filter((i) => i >= 0) ?? [],
    [state]
  );

  // Keep the panel on screen, flipping rather than overflowing.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el || !state) { setPos(null); return; }
    const rect = el.getBoundingClientRect();
    const left = state.x + rect.width > window.innerWidth - 8
      ? Math.max(8, window.innerWidth - rect.width - 8)
      : Math.max(8, state.x);
    const top = state.y + rect.height > window.innerHeight - 8
      ? Math.max(8, window.innerHeight - rect.height - 8)
      : Math.max(8, state.y);
    setPos({ left, top });
    setFlipSubmenu(state.x > window.innerWidth / 2);
  }, [state]);

  useEffect(() => { setActive(-1); setSubmenu(null); }, [state]);

  // The panel takes focus once it is actually on screen (it stays hidden until it
  // has been positioned), otherwise arrow keys scroll the page behind the menu —
  // which closes it. Focus returns to whatever was focused before on close.
  useEffect(() => {
    if (!pos) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [pos]);

  // Close on scroll, resize, Escape and any stray interaction outside.
  useEffect(() => {
    if (!state) return;
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [state, onClose]);

  if (!state || !enabled) return null;

  const move = (delta: number) => {
    const indices = selectableIndices;
    if (indices.length === 0) return;
    const current = indices.indexOf(active);
    const next = current === -1
      ? (delta > 0 ? 0 : indices.length - 1)
      : (current + delta + indices.length) % indices.length;
    const entry = state.entries[indices[next] ?? -1];
    const opensSubmenu = isItem(entry) && !!entry.items?.length;
    if (opensSubmenu) submenuByKeyboard.current = true;
    setActive(indices[next] ?? -1);
    setSubmenu(opensSubmenu ? (indices[next] ?? null) : null);
  };

  const activate = (index: number) => {
    const entry = state.entries[index];
    if (!isItem(entry) || entry.disabled) return;
    if (entry.items?.length) { submenuByKeyboard.current = true; setSubmenu(index); return; }
    entry.onSelect?.();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Home") { e.preventDefault(); setActive(selectableIndices[0] ?? -1); }
    else if (e.key === "End") { e.preventDefault(); setActive(selectableIndices[selectableIndices.length - 1] ?? -1); }
    else if (e.key === "ArrowRight") {
      const entry = state.entries[active];
      if (isItem(entry) && entry.items?.length) { e.preventDefault(); setSubmenu(active); }
    } else if (e.key === "ArrowLeft") {
      if (submenu !== null) { e.preventDefault(); setSubmenu(null); }
    } else if (e.key === "Enter" || e.key === " ") {
      if (active >= 0) { e.preventDefault(); activate(active); }
    } else if (e.key === "Tab") {
      onClose();
    }
  };

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[60]"
        onPointerDown={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        ref={panelRef}
        role="menu"
        aria-label="Context menu"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        style={{ left: pos?.left ?? state.x, top: pos?.top ?? state.y, visibility: pos ? "visible" : "hidden" }}
        className={`fixed z-[61] min-w-[15rem] max-w-[22rem] ${PANEL} animate-fade-in`}
      >
        {(state.title || state.subtitle) && (
          <div className="px-3 py-2 mb-1 border-b border-surface-border">
            {state.title && <p className="text-xs text-white truncate">{state.title}</p>}
            {state.subtitle && <p className="text-[10px] text-gray-500 truncate mt-0.5">{state.subtitle}</p>}
          </div>
        )}
        {state.entries.map((entry, i) => {
          if (entry === "separator") return <div key={`sep-${i}`} className="border-t border-surface-border my-1" />;
          if (isHeading(entry)) {
            return (
              <div key={`h-${i}`} className="px-3 pt-1.5 pb-0.5 text-[10px] text-gray-600 uppercase font-semibold tracking-wider">
                {entry.heading}
              </div>
            );
          }
          const Icon = entry.icon;
          const hasSubmenu = !!entry.items?.length;
          return (
            <div key={entry.label + i} className="relative px-1">
              <button
                type="button"
                role="menuitem"
                aria-haspopup={hasSubmenu ? "menu" : undefined}
                aria-expanded={hasSubmenu ? submenu === i : undefined}
                disabled={entry.disabled}
                onPointerEnter={() => { setActive(i); submenuByKeyboard.current = false; setSubmenu(hasSubmenu ? i : null); }}
                onClick={() => activate(i)}
                className={`${ROW} ${
                  entry.disabled
                    ? "text-gray-600 cursor-not-allowed"
                    : entry.danger
                      ? `text-red-400 ${active === i ? "bg-red-500/10" : ""}`
                      : `text-gray-300 ${active === i ? "bg-surface-lighter text-white" : ""}`
                }`}
              >
                {Icon ? <Icon size={14} className={entry.disabled ? "text-gray-600" : "text-gray-500"} /> : <span className="w-3.5" />}
                <span className="flex-1 truncate">{entry.label}</span>
                {entry.checked && <Check size={13} className="text-cyber-400" />}
                {entry.hint && <span className="text-[10px] text-gray-600">{entry.hint}</span>}
                {hasSubmenu && <ChevronRight size={13} className="text-gray-600" />}
              </button>
              {hasSubmenu && submenu === i && (
                <SubMenu
                  entries={entry.items!}
                  flip={flipSubmenu}
                  autoFocus={submenuByKeyboard.current}
                  onBack={() => { setSubmenu(null); panelRef.current?.focus(); }}
                  onSelectEntry={(item) => { item.onSelect?.(); onClose(); }}
                />
              )}
            </div>
          );
        })}
      </div>
    </>,
    document.body
  );
}

function SubMenu({
  entries, flip, autoFocus, onBack, onSelectEntry,
}: {
  entries: MenuEntry[];
  flip: boolean;
  autoFocus: boolean;
  onBack: () => void;
  onSelectEntry: (item: MenuItem) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(-1);
  const indices = useMemo(() => entries.map((e, i) => (isSelectable(e) ? i : -1)).filter((i) => i >= 0), [entries]);

  useEffect(() => {
    // Only when the submenu was opened from the keyboard, so a hover does not
    // yank focus (or scroll) into it.
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const activate = (index: number) => {
    const entry = entries[index];
    if (isItem(entry) && !entry.disabled) onSelectEntry(entry);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      if (indices.length === 0) return;
      const current = indices.indexOf(active);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next = current === -1 ? (delta > 0 ? 0 : indices.length - 1) : (current + delta + indices.length) % indices.length;
      setActive(indices[next] ?? -1);
    } else if (e.key === "ArrowLeft" || e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onBack();
    } else if (e.key === "Enter" || e.key === " ") {
      if (active >= 0) { e.preventDefault(); e.stopPropagation(); activate(active); }
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={`absolute top-[-6px] z-[62] min-w-[12rem] max-h-[70vh] overflow-y-auto ${PANEL} ${flip ? "right-full mr-1" : "left-full ml-1"}`}
    >
      {entries.map((entry, i) => {
        if (entry === "separator") return <div key={`s-${i}`} className="border-t border-surface-border my-1" />;
        if (isHeading(entry)) {
          return (
            <div key={`sh-${i}`} className="px-3 pt-1.5 pb-0.5 text-[10px] text-gray-600 uppercase font-semibold tracking-wider">
              {entry.heading}
            </div>
          );
        }
        const Icon = entry.icon;
        return (
          <div key={entry.label + i} className="px-1">
            <button
              type="button"
              role="menuitem"
              disabled={entry.disabled}
              onPointerEnter={() => setActive(i)}
              onClick={() => activate(i)}
              className={`${ROW} ${
                entry.disabled
                  ? "text-gray-600 cursor-not-allowed"
                  : entry.danger
                    ? `text-red-400 ${active === i ? "bg-red-500/10" : ""}`
                    : `text-gray-300 ${active === i ? "bg-surface-lighter text-white" : ""}`
              }`}
            >
              {Icon ? <Icon size={14} className="text-gray-500" /> : <span className="w-3.5" />}
              <span className="flex-1 truncate">{entry.label}</span>
              {entry.checked && <Check size={13} className="text-cyber-400" />}
              {entry.hint && <span className="text-[10px] text-gray-600">{entry.hint}</span>}
            </button>
          </div>
        );
      })}
    </div>
  );
}
