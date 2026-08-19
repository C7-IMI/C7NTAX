import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Global hover tooltips for every interactive control.
 *
 * One mounted instance listens (via event delegation on `document`) for
 * pointer/focus events on all buttons, links, inputs, selects and textareas
 * across the app, resolves a label for the control, and shows a single styled
 * tooltip. Individual elements can override the label with a `data-tooltip`
 * attribute (or `data-tooltip="off"` to opt out). Existing `title` attributes
 * are reused but temporarily removed while the custom tooltip is open so the
 * native browser tooltip never double-shows.
 */

const INTERACTIVE =
  'button, a, input, select, textarea, [role="button"], [role="link"]';

const SHOW_DELAY_MS = 450;
const GAP = 8;
const MAX_LABEL = 96;

/** Friendly names for lucide icon classes; falls back to humanized words. */
const ICON_LABELS: Record<string, string> = {
  x: "Close",
  check: "Confirm",
  checkcircle: "Done",
  xcircle: "Error",
  alerttriangle: "Warning",
  chevronup: "Show less",
  chevrondown: "More options",
  chevronleft: "Back",
  chevronright: "Next",
  arrowup: "Up",
  arrowdown: "Down",
  arrowright: "Next",
  arrowleft: "Back",
  arrowupdown: "Sort",
  gripvertical: "Drag to reorder",
  morehorizontal: "More",
  trash2: "Delete",
  edit3: "Edit",
  columns3: "Choose columns",
  square: "Select",
  checksquare: "Deselect",
  refreshcw: "Refresh",
  rotatecw: "Refresh",
  loader2: "Loading",
  settings2: "Settings",
  building2: "Company",
  building: "Company",
  folderkanban: "Boards",
  layoutdashboard: "Dashboard",
  userplus: "Add user",
  userminus: "Remove user",
  users: "Users",
  mapin: "Location",
  bookopen: "Documentation",
  helpcircle: "Help",
  lightbulb: "Hint",
  testtube: "Test",
  trendingup: "Trending",
  clipboardlist: "Checklist",
  listordered: "Ordered list",
  dollar: "Billing",
  dollarsign: "Billing",
  creditcard: "Payment",
  shoppingcart: "Purchase order",
  truck: "Procurement",
  package: "Packages",
  receipt: "Invoice",
  filetext: "File",
  paperclip: "Attach",
  link2: "Link",
  externallink: "Open link",
  eye: "Show",
  eyeoff: "Hide",
  star: "Favorite",
  sun: "Light mode",
  moon: "Dark mode",
  target: "Goals",
  zap: "Quick",
  sparkles: "AI",
  play: "Run",
  power: "Power",
  wifi: "Wi-Fi",
  qrcode: "QR code",
  harddrive: "Hard drive",
  cpu: "CPU",
  thumbsup: "Approve",
  badge: "Badge",
  globe: "Website",
  ticket: "Tickets",
  wrench: "Actions",
};

function humanize(word: string): string {
  const normalized = word
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])(\d+)$/i, "$1 $2")
    .trim()
    .toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function iconLabel(el: Element): string | null {
  const svg = el.querySelector('svg[class*="lucide-"], svg.lucide');
  if (!svg) return null;
  const match = (svg.getAttribute("class") || "").match(/lucide-([a-z0-9-]+)/i);
  if (!match || !match[1]) return null;
  const key = match[1].toLowerCase().replace(/-/g, "");
  return ICON_LABELS[key] ?? humanize(key);
}

function humanizeName(name: string): string {
  return name.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function resolveLabel(el: HTMLElement): string | null {
  const dt = el.getAttribute("data-tooltip");
  if (dt !== null) return dt.trim() ? dt.trim() : null;

  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria;

  const title = el.dataset.kunTitle?.trim() || el.getAttribute("title")?.trim();
  if (title) return title;

  if (el.matches("input, select, textarea")) {
    if (el.matches('input[type="hidden"]')) return null;
    const inLabel = el.closest("label")?.textContent?.trim();
    if (inLabel) return inLabel;
    if (el.id) {
      const lbl = document.querySelector<HTMLLabelElement>(
        `label[for="${CSS.escape(el.id)}"]`
      );
      const lblText = lbl?.textContent?.trim().replace(/[*:]\s*$/, "");
      if (lblText) return lblText;
    }
    const ph = el.getAttribute("placeholder")?.trim();
    if (ph) return ph;
    const name = el.getAttribute("name");
    if (name) return humanizeName(name);
    const type = el.getAttribute("type");
    if (type && type !== "hidden") return humanizeName(type);
    return el.matches("select") ? "Select" : "Input";
  }

  const icon = iconLabel(el);
  if (icon) return icon;

  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (text && text.length <= MAX_LABEL) return text;
  if (text) return `${text.slice(0, MAX_LABEL)}…`;
  return null;
}

interface Tip {
  text: string;
  top: number;
  left: number;
}

export function GlobalTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<{ rect: DOMRect; label: string } | null>(null);
  const timerRef = useRef<number | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const hide = useCallback(() => {
    clearTimer();
    const el = targetRef.current;
    if (el?.isConnected && el.dataset.kunTitle !== undefined) {
      el.setAttribute("title", el.dataset.kunTitle);
      delete el.dataset.kunTitle;
    }
    targetRef.current = null;
    anchorRef.current = null;
    setTip(null);
  }, []);

  const showFor = useCallback((el: HTMLElement, immediate: boolean) => {
    if (el === targetRef.current) return;
    clearTimer();

    if (
      el.hasAttribute("disabled") ||
      el.getAttribute("aria-disabled") === "true" ||
      el.getAttribute("data-tooltip")?.trim() === "off"
    ) {
      return;
    }

    const label = resolveLabel(el);
    if (!label) return;

    // Suppress the native title tooltip while ours is visible.
    if (el.hasAttribute("title") && el.dataset.kunTitle === undefined) {
      el.dataset.kunTitle = el.getAttribute("title") || "";
      el.removeAttribute("title");
    }

    const rect = el.getBoundingClientRect();
    targetRef.current = el;
    anchorRef.current = { rect, label };

    const apply = () => {
      const anchor = anchorRef.current;
      const el = targetRef.current;
      if (!anchor) return;
      const rect = (el?.isConnected && el.getBoundingClientRect()) || anchor.rect;
      setTip({
        text: anchor.label,
        top: Math.max(rect.top - GAP, GAP),
        left: Math.min(
          Math.max(rect.left + rect.width / 2, GAP),
          window.innerWidth - GAP
        ),
      });
    };

    if (immediate) {
      apply();
    } else {
      timerRef.current = window.setTimeout(apply, SHOW_DELAY_MS);
    }
  }, []);

  useEffect(() => {
    const findTarget = (e: Event): HTMLElement | null => {
      const t = e.target as Element | null;
      if (!t || !(t instanceof Element)) return null;
      return (t.closest(INTERACTIVE) as HTMLElement) || null;
    };

    const onPointerOver = (e: PointerEvent) => {
      const el = findTarget(e);
      if (el) showFor(el, false);
    };
    const onPointerOut = (e: PointerEvent) => {
      const el = findTarget(e);
      const rel = e.relatedTarget as Node | null;
      if (el && el === targetRef.current && !(rel && el.contains(rel))) hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = findTarget(e);
      if (el) showFor(el, true);
    };
    const onFocusOut = (e: FocusEvent) => {
      const el = findTarget(e);
      const rel = e.relatedTarget as Node | null;
      if (el && el === targetRef.current && !(rel && el.contains(rel))) hide();
    };
    const onPointerDown = () => hide();
    const onScroll = () => hide();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    const onResize = () => hide();

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    document.addEventListener("keydown", onKey, true);

    return () => {
      clearTimer();
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("keydown", onKey, true);
      const el = targetRef.current;
      if (el?.isConnected && el.dataset.kunTitle !== undefined) {
        el.setAttribute("title", el.dataset.kunTitle);
        delete el.dataset.kunTitle;
      }
    };
  }, [hide, showFor]);

  // Flip below the anchor when there is not enough room above.
  useLayoutEffect(() => {
    if (!tip || !tipRef.current || !anchorRef.current) return;
    const anchor = anchorRef.current;
    const tooltipRect = tipRef.current.getBoundingClientRect();
    let top = anchor.rect.top - tooltipRect.height - GAP;
    if (top < GAP) top = anchor.rect.bottom + GAP;
    let left = anchor.rect.left + anchor.rect.width / 2 - tooltipRect.width / 2;
    left = Math.min(Math.max(left, GAP), window.innerWidth - tooltipRect.width - GAP);
    setTip({ text: tip.text, top, left });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tip?.text, tip?.top, tip?.left]);

  return createPortal(
    <div
      ref={tipRef}
      role="tooltip"
      className={`fixed z-[100] max-w-[320px] rounded-lg border border-surface-border bg-navy-800/95 px-2.5 py-1.5 text-xs font-medium text-white shadow-xl backdrop-blur-sm pointer-events-none transition-opacity duration-150 ${
        tip ? "opacity-100" : "opacity-0"
      }`}
      style={{
        top: tip?.top ?? 0,
        left: tip?.left ?? 0,
        visibility: tip ? "visible" : "hidden",
      }}
    >
      {tip?.text}
    </div>,
    document.body
  );
}

export default GlobalTooltip;
