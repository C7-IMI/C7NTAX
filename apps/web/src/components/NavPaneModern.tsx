import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, Compass, Pin, Rows3 } from "lucide-react";
import type { NavNode } from "./Layout";
import {
  FOLD_THRESHOLD, NAV_STORAGE_KEYS, buildNavPane, orderRows, readNavUsage, recordNavUse,
  type NavDestination, type NavDomain, type RowOrder, type UseRecord,
} from "../lib/navModel";

/**
 * The modern navigation pane: a rail of domains, and the destinations inside one of them.
 *
 * Why two columns rather than one list. The tree this replaces put every section and every nested row
 * into one scrolling region, so opening a section moved everything below it — and with fifteen
 * sections the region is longer than the screen before anything is opened. Splitting it means the
 * rail keeps its position while the column scrolls, and the rail's length is fixed by the number of
 * *domains*, which is a design decision rather than a consequence of the feature list.
 *
 * What is deliberately absent: the rail cannot be reordered. The classic pane lets somebody drag
 * sections into their own order, which is a reasonable way to cope with a tree that is the wrong shape.
 * A stable rail is the point here — the ordering that adapts is *inside* a domain, on the rows, and it
 * adapts by itself.
 *
 * Everything the pane shows comes from `NAV_TREE` (see `lib/navModel.ts`): the same routes, the same
 * permissions, the same icons. Nothing about a page changes when this pane is switched on, which is
 * what makes switching it off safe.
 */
export function NavPaneModern({
  tree,
  favorites,
  alertCount,
  collapsed,
  assistantInRail,
  onExpand,
  onNodeContextMenu,
}: {
  tree: NavNode[];
  favorites: string[];
  alertCount: number;
  collapsed: boolean;
  assistantInRail: boolean;
  /** Called when a domain is chosen while the pane is collapsed, so the column can be shown. */
  onExpand: () => void;
  onNodeContextMenu?: (event: React.MouseEvent, node: NavNode) => void;
}) {
  const { pathname } = useLocation();

  const [domainId, setDomainId] = useState<string>(() => {
    try { return localStorage.getItem(NAV_STORAGE_KEYS.domain) || ""; } catch { return ""; }
  });
  const [peekId, setPeekId] = useState<string | null>(null);
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

  const domains = useMemo(
    () => (other ? [...model.domains, other] : model.domains),
    [model.domains, other],
  );

  const allItems = useMemo(
    () => [...domains, ...model.utilities].flatMap((domain) => domain.items),
    [domains, model.utilities],
  );

  /** Longest matching route wins, so `/billing/dashboard` does not also light up `/billing`. */
  const activeTo = useMemo(() => {
    const matches = allItems.filter((item) =>
      item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(`${item.to}/`));
    return matches.sort((a, b) => b.to.length - a.to.length)[0]?.to ?? null;
  }, [allItems, pathname]);

  const domainForPath = useCallback(
    (path: string): string | null => {
      const matches = allItems.filter((item) =>
        item.to === "/" ? path === "/" : path === item.to || path.startsWith(`${item.to}/`));
      const best = matches.sort((a, b) => b.to.length - a.to.length)[0];
      if (!best) return null;
      return [...domains, ...model.utilities].find((d) => d.items.some((i) => i.id === best.id))?.id ?? null;
    },
    [allItems, domains, model.utilities],
  );

  // The rail says where you are, so it follows the route. A domain clicked by hand stays until
  // something is actually opened, which is what makes browsing the rail harmless.
  useEffect(() => {
    const next = domainForPath(pathname);
    if (next) setDomainId((current) => (current === next ? current : next));
  }, [pathname, domainForPath]);

  // A stored domain can disappear — a permission withdrawn, an instance that only had one domain.
  useEffect(() => {
    if (domains.length && !domains.some((d) => d.id === domainId)) setDomainId(domains[0].id);
  }, [domains, domainId]);

  useEffect(() => {
    try { localStorage.setItem(NAV_STORAGE_KEYS.domain, domainId); } catch { /* ignore */ }
  }, [domainId]);
  useEffect(() => {
    try { localStorage.setItem(NAV_STORAGE_KEYS.order, order); } catch { /* ignore */ }
  }, [order]);
  useEffect(() => {
    try { localStorage.setItem(NAV_STORAGE_KEYS.quietOpen, foldedOpen ? "1" : "0"); } catch { /* ignore */ }
  }, [foldedOpen]);

  const shownId = peekId ?? domainId;
  const activeDomain =
    [...domains, ...model.utilities].find((d) => d.id === shownId) ??
    [...domains, ...model.utilities].find((d) => d.id === domainId) ??
    domains[0] ??
    null;
  const peeking = !!peekId && peekId !== domainId;

  const choose = (id: string) => {
    setDomainId(id);
    setPeekId(null);
    setFilter("");
    // A collapsed pane has no column to show, so choosing a domain is also a request to open it.
    if (collapsed) onExpand();
  };

  const open = (item: NavDestination) => {
    setUsage((current) => recordNavUse(item.id, current));
  };

  /* ── The column's contents ──────────────────────────────────────────────────────────────── */

  const pinned = useMemo(
    () => (activeDomain ? activeDomain.items.filter((item) => favorites.includes(item.id)) : []),
    [activeDomain, favorites],
  );

  const rest = useMemo(() => {
    if (!activeDomain) return { visible: [] as NavDestination[], folded: [] as NavDestination[] };
    const unpinned = activeDomain.items.filter((item) => !favorites.includes(item.id));
    return orderRows(unpinned, usage, order);
  }, [activeDomain, favorites, usage, order]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return null;
    return allItems.filter(
      (item) => item.label.toLowerCase().includes(needle) || item.to.toLowerCase().includes(needle),
    );
  }, [allItems, filter]);

  const badgeFor = (id: string) => (id === "service-alerts" || id === "admin-service-alerts" ? alertCount : 0);

  const row = (item: NavDestination) => {
    const node = nodeById.get(item.id);
    const count = badgeFor(item.id);
    return (
      <Link
        key={item.id}
        to={item.to}
        onClick={() => open(item)}
        onContextMenu={node && onNodeContextMenu ? (e) => onNodeContextMenu(e, node) : undefined}
        title={node ? `${item.label} — ${item.to}` : item.to}
        aria-current={activeTo === item.to ? "page" : undefined}
        className={`nav-item flex items-center gap-2.5 py-2 text-sm transition-colors ${
          item.child ? "pl-8 pr-3" : "px-3"
        } ${
          activeTo === item.to
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
        {favorites.includes(item.id) && activeTo !== item.to && (
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

  /* ── The rail ───────────────────────────────────────────────────────────────────────────── */

  const railItem = (domain: NavDomain) => {
    const selected = domain.id === domainId;
    const badge = domain.items.reduce((n, item) => n + badgeFor(item.id), 0);
    return (
      <button
        key={domain.id}
        type="button"
        onClick={() => choose(domain.id)}
        onMouseEnter={() => setPeekId(domain.id)}
        onFocus={() => setPeekId(domain.id)}
        aria-current={selected ? "true" : undefined}
        title={collapsed ? domain.label : domain.what}
        data-nav-domain={domain.id}
        className={`nav-item w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
          selected
            ? "nav-item--active bg-surface-lighter text-white font-medium"
            : peeking && peekId === domain.id
              ? "bg-surface-lighter/60 text-white"
              : "text-gray-400 hover:text-white hover:bg-surface-lighter"
        }`}
      >
        <domain.icon size={18} className={`shrink-0 ${badge > 0 ? "text-alert-red" : ""}`} />
        {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{domain.label}</span>}
        {!collapsed && badge > 0 && (
          <span
            className="badge-count shrink-0 min-w-[18px] h-[18px] px-1 text-[10px]"
            title={`${badge} active service alert${badge === 1 ? "" : "s"}`}
          >{badge}</span>
        )}
      </button>
    );
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    // Scoped to the pane so it never competes with the application's own shortcuts, which are global.
    if (event.key === "/" && !/^(INPUT|TEXTAREA)$/.test((event.target as HTMLElement).tagName)) {
      event.preventDefault();
      filterRef.current?.focus();
      return;
    }
    if (/^[1-9]$/.test(event.key) && !/^(INPUT|TEXTAREA)$/.test((event.target as HTMLElement).tagName)) {
      const target = domains[Number(event.key) - 1];
      if (target) { event.preventDefault(); choose(target.id); }
      return;
    }
    if (event.key === "Escape") {
      if (filter) { setFilter(""); return; }
      if (peeking) setPeekId(null);
    }
  };

  return (
    <div className="flex-1 flex min-h-0" onKeyDown={onKeyDown} data-nav-pane="modern">
      {/* ── Rail ─────────────────────────────────────────────────────────────────────────── */}
      <div
        className={`flex flex-col shrink-0 overflow-y-auto border-r border-surface-border ${collapsed ? "w-full px-1 py-3" : "w-[196px] px-2 py-3"}`}
        onMouseLeave={() => setPeekId(null)}
        role="navigation"
        aria-label="Sections"
      >
        <div className={collapsed ? "flex flex-col items-center gap-0.5" : "flex flex-col gap-0.5"}>
          {domains.map(railItem)}
        </div>

        <div className={`mt-auto pt-3 ${collapsed ? "flex flex-col items-center gap-0.5" : "flex flex-col gap-0.5"}`}>
          {!collapsed && <div className="px-3 pb-1 text-[10px] uppercase tracking-wider text-gray-700">Utilities</div>}
          {model.utilities.map(railItem)}
        </div>
      </div>

      {/* ── Destinations ─────────────────────────────────────────────────────────────────── */}
      {!collapsed && activeDomain && (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden" data-nav-column={activeDomain.id}>
          <div className="px-3 pt-3 pb-2 border-b border-surface-border shrink-0">
            <div className="flex items-center gap-2">
              <activeDomain.icon size={15} className="shrink-0 text-cyber-400" />
              <h2 className="text-sm font-semibold text-white truncate">{activeDomain.label}</h2>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-gray-500">{activeDomain.what}</p>
            <div className="mt-2 flex items-center gap-1.5">
              <input
                ref={filterRef}
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter…  ( / )"
                aria-label={`Filter ${activeDomain.label}`}
                className="flex-1 min-w-0 bg-surface border border-surface-border rounded-md px-2 py-1 text-xs text-white placeholder:text-gray-600"
              />
              <button
                type="button"
                onClick={() => setOrder(order === "learned" ? "az" : "learned")}
                title={
                  order === "learned"
                    ? "Ordered by what you open. Switch to A–Z to keep this column still."
                    : "Alphabetical. Switch back to order by what you open."
                }
                aria-label="Change how this column is ordered"
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
                  order === "learned" ? "In use" : "All",
                  rest.visible,
                  activeDomain.items.length > FOLD_THRESHOLD && order === "learned" ? (
                    <span className="ml-auto text-[10px] text-gray-700" title="Rows are folded only once you have opened something in this section">
                      ordered by what you open
                    </span>
                  ) : null,
                )}
                {rest.folded.length > 0 && (
                  <div className="mt-1 border-t border-surface-border/60 pt-1">
                    <button
                      type="button"
                      onClick={() => setFoldedOpen((v) => !v)}
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
