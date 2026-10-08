import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, Compass, Pin, Rows3, Star, type LucideIcon } from "lucide-react";
import type { NavNode } from "./Layout";
import { KumoWordmark } from "./KumoWordmark";
import {
  FAVORITES_NODE_ID, FOLD_THRESHOLD, NAV_STORAGE_KEYS, buildNavPane, orderRows, readNavUsage, recordNavUse,
  type NavDestination, type NavDomain, type RowOrder, type UseRecord,
} from "../lib/navModel";

/**
 * The modern navigation pane: a rail of domains, and the destinations inside one of them.
 *
 * **The rail is permanent; the sections fly out over the content.** An earlier version put the two
 * columns side by side and reserved 432px for them, which on a 1280px window took a third of the
 * screen and squeezed every page in the application — the header's own toolbar is a fixed 644px, so
 * the cost landed on the page title and on the tables below it. Widening is not available (the point
 * of the pane is to hold a growing tree) and redesigning every page to fit a narrower column is a
 * much larger change than this one. So the column overlays instead: the rail is 200px, narrower than
 * the 256px the tree occupied, and the list of destinations appears on top of the content when it is
 * asked for and then goes away.
 *
 * What that buys beyond width: the rail is the whole navigation at rest, so "where am I" is answerable
 * without opening anything, and the list of destinations is a focused thing you are looking at rather
 * than a second column competing with the page.
 *
 * Why it opens on a click and not on hover: a panel that appears whenever the pointer crosses the rail
 * is a panel that flashes open on the way to somewhere else. Switching an open panel on hover was tried
 * and removed as well — it made the *click* that followed ambiguous, because moving onto a row had
 * already opened that row's panel, so the click appeared to close it. One gesture, one meaning: clicking
 * a domain opens it, clicking it again closes it, and Esc, a click outside and the close button do the
 * same.
 *
 * What is deliberately absent: the rail cannot be reordered. The classic pane lets somebody drag
 * sections into their own order, which is a reasonable way to cope with a tree that is the wrong
 * shape. A stable rail is the point here — the ordering that adapts is inside a domain, on the rows,
 * and it adapts by itself.
 *
 * Everything the pane shows comes from `NAV_TREE` (see `lib/navModel.ts`): the same routes, the same
 * permissions, the same icons. Nothing about a page changes when this pane is switched on, which is
 * what makes switching it off safe.
 */
/**
 * The rail domain that carries a brand rather than a label. Kumo is the documentation application
 * inside this one (and may be shipped on its own), so it is drawn with its logotype; see
 * `KumoWordmark`.
 */
const KUMO_DOMAIN_ID = "kumo";

/**
 * The rail row that opens the pins.
 *
 * It is addressed like a domain — a row on the rail that opens a panel over the content — but it is
 * not one, and it is deliberately *not* `FAVORITES_NODE_ID`: that id means "the favourites list" to
 * the context menus, while this one means "the panel is open". Conflating them would make the panel
 * appear whenever a menu asked about the list.
 */
const FAVORITES_RAIL_ID = "__favorites";

/** The node the menus are handed for the favourites header, so they offer the favourites-wide
 *  actions ("Remove all favorites") and nothing section-specific. */
const FAVORITES_SECTION_NODE: NavNode = { id: FAVORITES_NODE_ID, label: "Favorites", icon: Star };

/** One pinned thing, resolved to something the pane can draw. */
interface FavoriteRow {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Where the row goes, or null when it opens a section's panel instead. */
  to: string | null;
  /** Set instead of `to`: the domain whose panel this row opens. */
  openSection: string | null;
  /** The section a pinned destination lives in — the label alone rarely places it. */
  hint: string | null;
  /** The tree node behind the pin, which is what the context menu acts on. */
  node: NavNode;
}

export function NavPaneModern({
  tree,
  favorites,
  alertCount,
  collapsed,
  assistantInRail,
  onNodeContextMenu,
}: {
  tree: NavNode[];
  favorites: string[];
  alertCount: number;
  collapsed: boolean;
  assistantInRail: boolean;
  onNodeContextMenu?: (event: React.MouseEvent, node: NavNode, options?: { favorite?: boolean }) => void;
}) {
  const { pathname } = useLocation();
  const paneRef = useRef<HTMLDivElement>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [usage, setUsage] = useState<Record<string, UseRecord>>(readNavUsage);
  const [order, setOrder] = useState<RowOrder>(() => {
    try { return localStorage.getItem(NAV_STORAGE_KEYS.order) === "az" ? "az" : "learned"; } catch { return "learned"; }
  });
  const [foldedOpen, setFoldedOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(NAV_STORAGE_KEYS.quietOpen) === "1"; } catch { return false; }
  });
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  const model = useMemo(() => buildNavPane(tree, { assistantInRail }), [tree, assistantInRail]);

  const nodeById = useMemo(() => {
    const map = new Map<string, NavNode>();
    const walk = (nodes: NavNode[]) => {
      for (const node of nodes) { map.set(node.id, node); if (node.children) walk(node.children); }
    };
    walk(tree);
    return map;
  }, [tree]);

  /**
   * Destinations the pane was never told where to put. Not hidden, and not silently appended to a
   * domain that would then be lying about its contents: they get their own row while they exist.
   */
  const other: NavDomain | null = model.unsorted.length
    ? {
        id: "other",
        label: "Other",
        icon: Compass,
        what: "Sections this pane has not been told where to put. Seeing a row here means the navigation gained a section and the pane needs updating — it is a prompt, not a resting place.",
        items: model.unsorted,
      }
    : null;

  const railDomains = useMemo(
    () => (other ? [...model.domains, other] : model.domains),
    [model.domains, other],
  );
  const everything = useMemo(
    () => [...railDomains, ...model.utilities],
    [railDomains, model.utilities],
  );
  const allItems = useMemo(() => everything.flatMap((domain) => domain.items), [everything]);

  const domainById = useMemo(
    () => new Map(everything.map((domain) => [domain.id, domain] as const)),
    [everything],
  );

  /**
   * The pins, in the order the reader put them, resolved to rows.
   *
   * Three things can be pinned, so there are three shapes here. A **destination** is a page and gets a
   * link. A **domain** is a rail row and has no page of its own, so its pinned copy opens that
   * domain's panel — or goes straight to the destination, when the domain holds only one (pinning
   * "Console" should not open a list of one). A **hub node** the tree nests under another section
   * carries whatever the tree says. A pin this account can no longer see is dropped rather than drawn
   * as a dead row.
   */
  const favoriteRows = useMemo(() => {
    const itemById = new Map(allItems.map((item) => [item.id, item]));
    const rows: FavoriteRow[] = [];
    for (const id of favorites) {
      const node = nodeById.get(id);
      if (!node) continue;

      const item = itemById.get(id);
      if (item) {
        const owner = everything.find((domain) => domain.items.some((entry) => entry.id === id)) ?? null;
        // The section only earns its place when it says something the label does not: pinning the
        // Assistant would otherwise read "Assistant Assistant".
        const hint = owner && owner.label !== item.label ? owner.label : null;
        rows.push({ id, label: item.label, icon: item.icon, to: item.to, openSection: null, hint, node });
        continue;
      }

      const domain = domainById.get(id);
      if (domain) {
        const only = domain.items.length === 1 ? domain.items[0] : null;
        rows.push({
          id, label: domain.label, icon: domain.icon,
          to: only?.to ?? null,
          openSection: only ? null : domain.id,
          hint: null, node,
        });
        continue;
      }

      if (node.to) rows.push({ id, label: node.label, icon: node.icon, to: node.to, openSection: null, hint: null, node });
    }
    return rows;
  }, [favorites, nodeById, allItems, everything, domainById]);

  /** Longest matching route wins, so `/billing/dashboard` does not also light up `/billing`. */
  const activeItem = useMemo(
    () =>
      allItems
        .filter((item) => (item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(`${item.to}/`)))
        .sort((a, b) => b.to.length - a.to.length)[0] ?? null,
    [allItems, pathname],
  );
  const activeId = useMemo(
    () => everything.find((domain) => domain.items.some((item) => item.id === activeItem?.id))?.id ?? null,
    [everything, activeItem],
  );

  // Navigating anywhere closes the panel: it was opened to choose a destination, and the choice is made.
  useEffect(() => { setOpenId(null); setFilter(""); }, [pathname]);

  // Clicking away, or Escape, closes it. A document listener rather than a click-catching overlay,
  // which would have to sit above the rail and steal the clicks that open the panel in the first place.
  useEffect(() => {
    if (!openId) return;
    const onPointer = (event: MouseEvent) => {
      if (paneRef.current && !paneRef.current.contains(event.target as Node)) setOpenId(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpenId(null); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId]);

  useEffect(() => {
    try { localStorage.setItem(NAV_STORAGE_KEYS.order, order); } catch { /* ignore */ }
  }, [order]);
  useEffect(() => {
    try { localStorage.setItem(NAV_STORAGE_KEYS.quietOpen, foldedOpen ? "1" : "0"); } catch { /* ignore */ }
  }, [foldedOpen]);

  const openDomain = openId ? everything.find((domain) => domain.id === openId) ?? null : null;
  const showFavorites = openId === FAVORITES_RAIL_ID;

  const toggleDomain = useCallback((domain: NavDomain) => {
    setOpenId((current) => (current === domain.id ? null : domain.id));
    setFilter("");
  }, []);

  const openItem = (item: NavDestination) => {
    setUsage((current) => recordNavUse(item.id, current));
    setOpenId(null);
  };

  /* ── The flyout's contents ─────────────────────────────────────────────────────────────── */

  const pinned = useMemo(
    () => (openDomain ? openDomain.items.filter((item) => favorites.includes(item.id)) : []),
    [openDomain, favorites],
  );

  const rest = useMemo(() => {
    if (!openDomain) return { visible: [] as NavDestination[], folded: [] as NavDestination[] };
    const unpinned = openDomain.items.filter((item) => !favorites.includes(item.id));
    return orderRows(unpinned, usage, order);
  }, [openDomain, favorites, usage, order]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return null;
    return allItems.filter(
      (item) => item.label.toLowerCase().includes(needle) || item.to.toLowerCase().includes(needle),
    );
  }, [allItems, filter]);

  /**
   * "In use" is a claim, and with nothing opened yet there is no usage to make it — the rows are then
   * simply the section's contents in their declared order, and saying otherwise would be the pane
   * pretending to know something it has not been told.
   */
  const hasUsage = rest.visible.some((item) => usage[item.id]);

  // The badge belongs to the alert board, not to the page that configures it: the settings row lives
  // under Platform and must not put a count on Platform's rail row.
  const badgeFor = (id: string) => (id === "service-alerts" ? alertCount : 0);

  const row = (item: NavDestination) => {
    const node = nodeById.get(item.id);
    const count = badgeFor(item.id);
    const isActive = activeItem?.id === item.id;
    return (
      <Link
        key={item.id}
        to={item.to}
        onClick={() => openItem(item)}
        onContextMenu={node && onNodeContextMenu ? (e) => onNodeContextMenu(e, node, { favorite: favorites.includes(item.id) }) : undefined}
        title={`${item.label} — ${item.to}`}
        aria-current={isActive ? "page" : undefined}
        className={`nav-item flex items-center gap-2.5 py-2 text-sm transition-colors ${
          item.child ? "pl-8 pr-3" : "px-3"
        } ${
          isActive
            ? "nav-item--active bg-surface-lighter text-white"
            : "text-gray-400 hover:text-white hover:bg-surface-lighter"
        }`}
      >
        <item.icon size={16} className={`shrink-0 ${count > 0 ? "text-alert-red" : ""}`} />
        <span className={`min-w-0 flex-1 truncate ${count > 0 ? "text-alert-red" : ""}`}>{item.label}</span>
        {item.note && <span className="shrink-0 text-[10px] text-gray-600">{item.note}</span>}
        {count > 0 && (
          <span
            className="badge-count shrink-0 min-w-[18px] h-[18px] px-1 text-[10px]"
            title={`${count} active service alert${count === 1 ? "" : "s"}`}
          >{count}</span>
        )}
        {favorites.includes(item.id) && !isActive && (
          <Pin size={11} className="shrink-0 text-amber-400" aria-label="Pinned to Favourites" />
        )}
      </Link>
    );
  };

  const group = (key: string, label: string, items: NavDestination[], extra?: React.ReactNode) =>
    items.length === 0 ? null : (
      <div key={key} className="mb-1" data-nav-group={key}>
        <div className="flex items-center gap-2 px-3 pt-2 pb-1">
          <span className="text-[10px] uppercase tracking-wider text-gray-600">{label}</span>
          <span className="text-[10px] text-gray-700">{items.length}</span>
          {extra}
        </div>
        {items.map(row)}
      </div>
    );

  /* ── The rail ─────────────────────────────────────────────────────────────────────────── */

  const railItem = (domain: NavDomain) => {
    const isActive = domain.id === activeId;
    const isOpen = domain.id === openId;
    const isKumo = domain.id === KUMO_DOMAIN_ID;
    const badge = domain.items.reduce((n, item) => n + badgeFor(item.id), 0);
    const node = nodeById.get(domain.id);
    return (
      <button
        key={domain.id}
        type="button"
        onClick={() => toggleDomain(domain)}
        onContextMenu={node && onNodeContextMenu ? (e) => onNodeContextMenu(e, node, { favorite: favorites.includes(domain.id) }) : undefined}
        aria-expanded={isOpen}
        aria-current={isActive ? "true" : undefined}
        title={`${domain.label} — ${domain.what}`}
        data-nav-domain={domain.id}
        className={`nav-item w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
          isOpen
            ? "bg-surface-lighter text-white"
            : isActive
              ? "nav-item--active text-white"
              : "text-gray-400 hover:text-white hover:bg-surface-lighter"
        }`}
      >
        {isKumo && !collapsed ? (
          /* Kumo is branded rather than labelled — the logotype replaces its icon *and* its
             name, which is the point of branding it. Collapsed, the rail has room for one
             glyph and not for a wordmark, so it keeps the icon like every other row. */
          <KumoWordmark height={21} className="shrink-0" />
        ) : (
          <domain.icon size={18} className={`shrink-0 ${badge > 0 ? "text-alert-red" : ""}`} />
        )}
        {!collapsed && !isKumo && <span className="min-w-0 flex-1 truncate text-left">{domain.label}</span>}
        {!collapsed && badge > 0 && (
          <span
            className="badge-count shrink-0 min-w-[18px] h-[18px] px-1 text-[10px]"
            title={`${badge} active service alert${badge === 1 ? "" : "s"}`}
          >{badge}</span>
        )}
      </button>
    );
  };

  /**
   * The rail row that opens the pins, above the domains.
   *
   * It is a row like the others and it is always there, pinned or not: a section you can only reach
   * once you have pinned something is a section nobody finds, so with nothing pinned it opens onto
   * the one line that says how to pin. It never takes the active tint, because it is not a place you
   * are — the domain that holds the page you are on already has that.
   */
  const favoritesRailItem = () => {
    const isOpen = showFavorites;
    const count = favoriteRows.length;
    return (
      <button
        key={FAVORITES_RAIL_ID}
        type="button"
        onClick={() => { setOpenId(isOpen ? null : FAVORITES_RAIL_ID); setFilter(""); }}
        onContextMenu={(e) => onNodeContextMenu?.(e, FAVORITES_SECTION_NODE)}
        aria-expanded={isOpen}
        data-nav-domain={FAVORITES_RAIL_ID}
        title={count ? "Favorites — right-click a section to pin or unpin it" : "Favorites — right-click a section to pin it here"}
        className={`nav-item w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
          isOpen ? "bg-surface-lighter text-white" : "text-gray-400 hover:text-white hover:bg-surface-lighter"
        }`}
      >
        <Star size={18} className={`shrink-0 ${count ? "text-amber-400" : ""}`} />
        {!collapsed && <span className="min-w-0 flex-1 truncate text-left">Favorites</span>}
        {collapsed
          ? count > 0 && <span className="badge-count shrink-0 min-w-[18px] h-[18px] px-1 text-[10px]">{count}</span>
          : count > 0 && <span className="shrink-0 text-[10px] text-gray-500">{count}</span>}
      </button>
    );
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const tag = (event.target as HTMLElement).tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA";
    // Scoped to the pane, so it never competes with the application's own global shortcuts.
    if (event.key === "/" && !typing && openId) {
      event.preventDefault();
      filterRef.current?.focus();
      return;
    }
    if (/^[1-9]$/.test(event.key) && !typing) {
      // Numbered as the rail reads, so 1 is the row at the top — the pins.
      const index = Number(event.key) - 1;
      if (index === 0) {
        event.preventDefault();
        setOpenId(FAVORITES_RAIL_ID);
        setFilter("");
        return;
      }
      const target = railDomains[index - 1];
      if (target) { event.preventDefault(); setOpenId(target.id); setFilter(""); }
      return;
    }
    if (event.key === "ArrowRight" && !typing) {
      // The domain you are on. The pins are not somewhere you *are*, so this never opens them.
      const current = openId
        ? everything.find((domain) => domain.id === openId)
        : railDomains.find((domain) => domain.id === activeId);
      if (current) { event.preventDefault(); setOpenId(current.id); }
    }
  };

  return (
    <div className="flex-1 flex min-h-0 relative" ref={paneRef} onKeyDown={onKeyDown} data-nav-pane="modern">
      {/* ── Rail ───────────────────────────────────────────────────────────────────────────── */}
      <div
        className={`flex flex-col shrink-0 overflow-y-auto ${collapsed ? "w-full px-1 py-3" : "w-[200px] px-2 py-3"}`}
        role="navigation"
        aria-label="Sections"
      >
        <div className={collapsed ? "flex flex-col items-center gap-0.5" : "flex flex-col gap-0.5"}>
          {favoritesRailItem()}
          {railDomains.map(railItem)}
        </div>

        <div className={`mt-auto pt-3 ${collapsed ? "flex flex-col items-center gap-0.5" : "flex flex-col gap-0.5"}`}>
          {!collapsed && <div className="px-3 pb-1 text-[10px] uppercase tracking-wider text-gray-700">Utilities</div>}
          {model.utilities.map(railItem)}
        </div>
      </div>

      {/* ── The pins, over the content ─────────────────────────────────────────────────────── */}
      {showFavorites && (
        <div
          className="absolute left-full top-0 h-full w-[252px] z-40 flex flex-col bg-surface border-l border-r border-surface-border shadow-2xl"
          data-nav-flyout={FAVORITES_RAIL_ID}
          role="group"
          aria-label="Favorites"
        >
          <div className="px-3 pt-3 pb-2 border-b border-surface-border shrink-0">
            <div className="flex items-start gap-2">
              <Star size={15} className={`mt-0.5 shrink-0 ${favoriteRows.length ? "text-amber-400" : "text-gray-600"}`} />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-white truncate">Favorites</h2>
                <p className="mt-0.5 text-[11px] leading-snug text-gray-500">
                  {favoriteRows.length === 0
                    ? "Nothing pinned yet."
                    : `${favoriteRows.length} pinned, in your own order. Right-click one to unpin it or move it.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                title="Close (Esc)"
                aria-label="Close"
                className="shrink-0 -mt-0.5 p-1 rounded text-gray-600 hover:text-white hover:bg-surface-lighter"
              >
                <ChevronDown size={14} className="rotate-90" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-1.5">
            {favoriteRows.length === 0 ? (
              <p className="px-3 py-1.5 text-xs leading-relaxed text-gray-600">
                Right-click a section on the rail, or a destination inside one, and choose
                “Pin to Favorites”. Pinned sections stay here with the pages you pinned from them.
              </p>
            ) : (
              favoriteRows.map((entry) =>
                entry.to ? (
                  <Link
                    key={entry.id}
                    to={entry.to}
                    onClick={() => setOpenId(null)}
                    onContextMenu={(e) => onNodeContextMenu?.(e, entry.node, { favorite: true })}
                    title={entry.hint ? `${entry.label} — ${entry.hint}` : entry.label}
                    className={`nav-item flex items-center gap-2.5 py-2 text-sm transition-colors px-3 ${
                      activeItem?.id === entry.id
                        ? "nav-item--active bg-surface-lighter text-white"
                        : "text-gray-400 hover:text-white hover:bg-surface-lighter"
                    }`}
                  >
                    <entry.icon size={16} className="shrink-0" />
                    <span className={`min-w-0 flex-1 truncate ${entry.hint ? "" : "font-medium"}`}>{entry.label}</span>
                    {entry.hint && <span className="shrink-0 text-[10px] text-gray-600">{entry.hint}</span>}
                  </Link>
                ) : (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => { setOpenId(entry.openSection); setFilter(""); }}
                    onContextMenu={(e) => onNodeContextMenu?.(e, entry.node, { favorite: true })}
                    title={`${entry.label} — open its destinations`}
                    className="nav-item w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium transition-colors text-gray-400 hover:text-white hover:bg-surface-lighter"
                  >
                    <entry.icon size={16} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-left">{entry.label}</span>
                    <ChevronDown size={13} className="shrink-0 -rotate-90 text-gray-600" />
                  </button>
                ),
              )
            )}
          </div>
        </div>
      )}

      {/* ── Destination list, over the content ─────────────────────────────────────────────── */}
      {openDomain && (
        <div
          className="absolute left-full top-0 h-full w-[252px] z-40 flex flex-col bg-surface border-l border-r border-surface-border shadow-2xl"
          data-nav-flyout={openDomain.id}
          role="group"
          aria-label={`${openDomain.label} destinations`}
        >
          <div className="px-3 pt-3 pb-2 border-b border-surface-border shrink-0">
            <div className="flex items-start gap-2">
              {openDomain.id === KUMO_DOMAIN_ID ? (
                /* The mark carries the name, so the heading holds the image and the line under
                   it still says what Kumo is. */
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-white"><KumoWordmark height={18} /></h2>
                  <p className="mt-1 text-[11px] leading-snug text-gray-500">{openDomain.what}</p>
                </div>
              ) : (
                <>
                  <openDomain.icon size={15} className="mt-0.5 shrink-0 text-cyber-400" />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold text-white truncate">{openDomain.label}</h2>
                    <p className="mt-0.5 text-[11px] leading-snug text-gray-500">{openDomain.what}</p>
                  </div>
                </>
              )}
              <button
                type="button"
                onClick={() => setOpenId(null)}
                title="Close (Esc)"
                aria-label="Close"
                className="shrink-0 -mt-0.5 p-1 rounded text-gray-600 hover:text-white hover:bg-surface-lighter"
              >
                <ChevronDown size={14} className="rotate-90" />
              </button>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <input
                ref={filterRef}
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter…  ( / )"
                aria-label={`Filter ${openDomain.label}`}
                className="flex-1 min-w-0 bg-surface-light border border-surface-border rounded-md px-2 py-1 text-xs text-white placeholder:text-gray-600"
              />
              <button
                type="button"
                onClick={() => setOrder(order === "learned" ? "az" : "learned")}
                title={
                  order === "learned"
                    ? "Ordered by what you open. Switch to A–Z to keep this list still."
                    : "Alphabetical. Switch back to order by what you open."
                }
                aria-label="Change how this list is ordered"
                className="shrink-0 p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-surface-lighter"
              >
                {order === "learned" ? <Rows3 size={14} /> : <Compass size={14} />}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-1 min-h-0">
            {filtered ? (
              filtered.length ? group("matched", "Matching", filtered) : (
                <p className="px-3 py-4 text-xs text-gray-600">
                  Nothing in the application matches “{filter}”.
                </p>
              )
            ) : (
              <>
                {group("pinned", "Pinned", pinned)}
                {group(
                  "rows",
                  hasUsage && order === "learned" ? "In use" : "Sections",
                  rest.visible,
                  hasUsage && openDomain.items.length > FOLD_THRESHOLD && order === "learned" ? (
                    <span className="ml-auto text-[10px] text-gray-700" title="Rows are folded only once you have opened something in this section">
                      ordered by what you open
                    </span>
                  ) : null,
                )}
                {rest.folded.length > 0 && (
                  <div className="mt-1 border-t border-surface-border/60 pt-1">
                    <button
                      type="button"
                      onClick={() => setFoldedOpen((value) => !value)}
                      aria-expanded={foldedOpen}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-gray-600 hover:text-gray-300"
                    >
                      <ChevronDown size={12} className={`transition-transform ${foldedOpen ? "" : "-rotate-90"}`} />
                      <span>Everything else</span>
                      <span className="ml-auto text-[10px]">{rest.folded.length} not opened yet</span>
                    </button>
                    {foldedOpen && rest.folded.map(row)}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
