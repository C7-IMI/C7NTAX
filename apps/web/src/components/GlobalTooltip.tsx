import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Global hover tooltips for every interactive control.
 *
 * One mounted instance listens (via event delegation on `document`) for pointer/focus events on all
 * buttons, links, inputs, selects and textareas across the app, resolves a label for the control, and
 * shows a single styled tooltip. Individual elements can override the label with a `data-tooltip`
 * attribute (or `data-tooltip="off"` to opt out). Existing `title` attributes are reused but
 * temporarily removed while the custom tooltip is open so the native browser tooltip never double-shows.
 *
 * A label is resolved in this order, and the order is the whole point:
 *
 *   1. `data-tooltip`, `aria-label`, `aria-labelledby`, `title` — somebody said what this is.
 *   2. a form control's own `<label>`, placeholder, name or type.
 *   3. the control's **own text** — a link with the word "Single Sign-On" in it says that.
 *   4. only for a control with no text at all, the icon: its meaning if the icon has one
 *      ("Copy", "Delete", "Show"), otherwise the surrounding context, otherwise nothing.
 *
 * Step 3 used to come after step 4, so a navigation link reading "Single Sign-On" was announced as
 * "Keyround" — the name of the glyph, which is not a label anybody wants. A control that carries no
 * text is labelled from `ICON_ACTIONS`, and an icon whose name says nothing about what the control
 * does (a key, a shield, a gear) is never allowed to answer: a generic name is worse than no tooltip,
 * so the context is tried and then the tooltip is simply not shown.
 */

const INTERACTIVE =
  'button, a, input, select, textarea, [role="button"], [role="link"]';

const SHOW_DELAY_MS = 450;
const GAP = 8;
const MAX_LABEL = 96;
/** Above this, a control's own words are a sentence rather than a name. */
const SHORT_LABEL_MAX = 48;

/**
 * Labels for icons that mean one thing wherever they appear. The value describes what the control
 * *does*, not what the glyph is called — which is the difference between "Add" and "Plus".
 */
const ICON_ACTIONS: Record<string, string> = {
  // ── Editing and file actions ──
  x: "Close",
  check: "Confirm",
  checkcircle: "Done",
  checkcircle2: "Done",
  xcircle: "Error",
  alerttriangle: "Warning",
  circlealert: "Warning",
  info: "Information",
  trash2: "Delete",
  edit3: "Edit",
  pencil: "Edit",
  copy: "Copy",
  download: "Download",
  upload: "Upload",
  save: "Save",
  plus: "Add",
  minus: "Remove",
  search: "Search",
  send: "Send",
  filter: "Filter",
  eraser: "Clear",
  undo2: "Undo",
  redo2: "Redo",
  printer: "Print",
  paperclip: "Attach a file",
  // ── Navigation and layout ──
  menu: "Menu",
  morehorizontal: "More actions",
  gripvertical: "Drag to reorder",
  panelleftclose: "Collapse the sidebar",
  panelleftopen: "Expand the sidebar",
  arrowupdown: "Sort",
  chevronsupdown: "Sort",
  layoutdashboard: "Dashboard",
  home: "Home",
  folderkanban: "Boards",
  ticket: "Tickets",
  users: "Users",
  userplus: "Add a user",
  userminus: "Remove a user",
  building2: "Companies",
  building: "Companies",
  bookopen: "Documentation",
  helpcircle: "Help",
  history: "History",
  // ── Data, state and time ──
  refreshcw: "Refresh",
  rotatecw: "Refresh",
  rotateccw: "Refresh",
  loader2: "Loading",
  clock: "Time",
  timer: "Timer",
  calendar: "Calendar",
  calendardays: "Calendar",
  bell: "Notifications",
  eye: "Show",
  eyeoff: "Hide",
  mail: "Email",
  mailcheck: "Email verified",
  phone: "Phone",
  phonecall: "Call",
  message: "Message",
  messagesquare: "Message",
  qrcode: "QR code",
  // ── Billing and commerce ──
  dollarsign: "Billing",
  dollar: "Billing",
  receipt: "Invoice",
  creditcard: "Payment",
  wallet: "Wallet",
  shoppingcart: "Purchase order",
  truck: "Procurement",
  boxes: "Packages",
  package: "Package",
  // ── Reporting ──
  barchart3: "Reports",
  piechart: "Reports",
  activity: "Activity",
  trendingup: "Trending up",
  trendingdown: "Trending down",
  // ── Infrastructure ──
  server: "Server",
  database: "Database",
  cloud: "Cloud",
  cpu: "CPU",
  harddrive: "Storage",
  memorystick: "Memory",
  network: "Network",
  wifi: "Wi-Fi",
  wifioff: "Wi-Fi off",
  globe: "Website",
  monitor: "Monitor",
  laptop: "Laptop",
  smartphone: "Mobile device",
  smartphone2: "Mobile device",
  camera: "Camera",
  image: "Image",
  video: "Video",
  // ── Editing text (rich-text toolbar) ──
  bold: "Bold",
  italic: "Italic",
  underline: "Underline",
  strikethrough: "Strikethrough",
  quote: "Quote",
  alignjustify: "Justify",
  removeformatting: "Clear formatting",
  list: "Bulleted list",
  listordered: "Numbered list",
  clipboardlist: "Checklist",
  listchecks: "Checklist",
  clipboardcheck: "Checklist",
  clipboardpaste: "Paste",
  link2: "Link",
  unlink: "Remove the link",
  externallink: "Open in a new tab",
  appwindow: "Open in a new window",
  // ── Records and details ──
  filetext: "File",
  filecode2: "Code file",
  folder: "Folder",
  folderopen: "Open the folder",
  foldertree: "Folders",
  mapin: "Location",
  testtube: "Test",
  lightbulb: "Hint",
  stickynote: "Note",
  // ── Favourites ──
  star: "Favourite",
  staroff: "Remove from favourites",
  pin: "Pin",
  pinoff: "Unpin",
};

/**
 * Icons whose own name says nothing about the control: a key, a shield, a gear. They appear with
 * several meanings across the app — a key is Single Sign-On in the navigation, a password collection
 * in Kumo and a licence in the product catalogue — so the glyph is never allowed to answer for them.
 * The tooltip falls back to the surrounding context, and if there is none, to no tooltip at all.
 */
const ICON_IS_AMBIGUOUS = new Set([
  "keyround", "key", "lock", "unlock", "shield", "shieldcheck", "shieldalert", "shieldhalf",
  "settings", "settings2", "slidershorizontal", "wrench", "cog",
  "power", "zap", "sparkles", "wand2", "target", "flag", "tag", "badge",
  "circle", "circledot", "square", "checksquare", "squarecheckbig", "squarecheckbox",
  // A direction glyph means "previous month" in a calendar, "previous page" in a table and "collapse"
  // in a tree. It is labelled by the control that uses it, or by `aria-expanded`, or not at all.
  "chevronleft", "chevronright", "chevronup", "chevrondown",
  "layers", "boxes3", "loader", "play", "pause", "repeat", "shuffle",
  "gitbranch", "gitpullrequestarrow", "plug", "plugzap", "cable", "radio", "radiotower",
  "router", "scanline", "projector", "presentation", "bot", "workflow", "login", "logintab",
]);

/** Where a link or button has no text of its own, the nearest of these usually names it. */
const CONTEXT_SELECTORS = [
  "[data-tooltip-context]",
  "th",
  "h1", "h2", "h3", "h4",
  "legend",
  "figcaption",
  "nav",
  "section",
  "form",
  "li",
  "tr",
  "[role='row']",
  "header",
  "article",
  "aside",
];

function humanize(word: string): string {
  const normalized = word
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])(\d+)$/i, "$1 $2")
    .trim()
    .toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/** The icon on a control, as its lucide name — `keyround`, `trash2`, … */
function iconKey(el: Element): string | null {
  const svg = el.querySelector('svg[class*="lucide-"], svg.lucide');
  if (!svg) return null;
  const match = (svg.getAttribute("class") || "").match(/lucide-([a-z0-9-]+)/i);
  if (!match || !match[1]) return null;
  return match[1].toLowerCase().replace(/-/g, "");
}

/**
 * The text of the nearest enclosing thing that names what this control belongs to, for a control that
 * has no text of its own. Only a short, single-run label is used — a whole table row is context, not
 * a name, and announcing it would be worse than saying nothing.
 */
function contextLabel(el: Element): string | null {
  for (const selector of CONTEXT_SELECTORS) {
    const container = el.closest(selector);
    if (!container) continue;
    const heading = container.querySelector("h1, h2, h3, h4, legend, [role='heading']");
    const text = (heading?.textContent || container.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    // Two or three words is a name ("Single Sign-On", "Kumo passwords"); a sentence is not.
    if (text.length <= 48 && text.split(" ").length <= 5) return text;
  }
  return null;
}

/** An icon whose meaning is the same everywhere: the label describes the action it performs. */
function iconActionLabel(el: HTMLElement): string | null {
  const key = iconKey(el);
  if (!key) return null;

  // A chevron or a plus/minus on something that opens and closes says so, in the direction it will go.
  const expanded = el.getAttribute("aria-expanded");
  if (expanded !== null && /chevron|caret|plu|minu|triangle/.test(key)) {
    return expanded === "true" ? "Collapse" : "Expand";
  }

  if (ICON_IS_AMBIGUOUS.has(key)) return null;
  if (ICON_ACTIONS[key]) return ICON_ACTIONS[key];

  // Not in the table and not known to be ambiguous: the icon's own words, if they read as a label.
  // A glyph name describing the drawing ("chevrons down up", "columns 3") is not a label, so those
  // are refused rather than shown — no tooltip beats a wrong one.
  if (/\d/.test(key)) return null;
  const words = humanize(key);
  if (words.length > 24 || words.split(" ").length > 2) return null;
  return words;
}

/** A composed label for a control with no text: its icon's action, or what it sits next to. */
function iconLabel(el: HTMLElement): string | null {
  return iconActionLabel(el) ?? inheritedLabel(el) ?? contextLabel(el);
}

/**
 * A name belonging to something wrapping this control. Icon-only buttons are frequently tucked inside
 * a wrapper that already names them (`title` on a collapsed rail row, an `aria-label` on a toolbar
 * group), and inheriting that is far better than describing the glyph.
 */
function inheritedLabel(el: HTMLElement): string | null {
  let parent = el.parentElement;
  for (let depth = 0; parent && depth < 3; depth++, parent = parent.parentElement) {
    const label = parent.getAttribute("aria-label")?.trim() || parent.getAttribute("title")?.trim();
    if (label && label.length <= MAX_LABEL) return label;
  }
  return null;
}

function humanizeName(name: string): string {
  return name.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function resolveLabel(el: HTMLElement): string | null {
  const dt = el.getAttribute("data-tooltip");
  if (dt !== null) return dt.trim() ? dt.trim() : null;

  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria;

  // A control may name itself through another element instead of duplicating the words into an
  // attribute — the sprite/`aria-labelledby` pattern, which is what the icon-only rail uses.
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map(id => document.getElementById(id)?.textContent?.trim() || "")
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
  }

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
    // A tick box or a radio button means whatever it sits beside — "Checkbox" is not a label, so an
    // unlabelled one is left alone rather than announced as its control type.
    if (el.matches('input[type="checkbox"], input[type="radio"]')) return name ? humanizeName(name) : null;
    if (name) return humanizeName(name);
    const type = el.getAttribute("type");
    if (type && type !== "hidden") return humanizeName(type);
    return el.matches("select") ? "Select" : "Input";
  }

  // The control's own words. A link that reads "Single Sign-On" is labelled "Single Sign-On" — this
  // used to be asked *after* the icon, which is how a key glyph came to announce itself as "Keyround".
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (text) {
    if (text.length <= SHORT_LABEL_MAX) return text;
    // Longer than that it is a sentence, and repeating a card's own paragraph back at whoever hovers
    // it is noise. It is worth showing only when the page cuts it off — an ellipsised name is exactly
    // what a tooltip is for.
    if (!isClipped(el)) return null;
    return text.length <= MAX_LABEL ? text : `${text.slice(0, MAX_LABEL)}…`;
  }

  // Nothing to read: an icon-only control is named by what its icon does, or by what it sits beside.
  return iconLabel(el);
}

/** Whether the control's text is wider than the space it has been given. */
function isClipped(el: HTMLElement): boolean {
  if (el.scrollWidth > el.clientWidth + 1) return true;
  return [...el.querySelectorAll("*")].some(child => child.scrollWidth > child.clientWidth + 1);
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
