import { Link, useLocation, useNavigate } from "react-router-dom";
import { Compass, Home, Search } from "lucide-react";
import { Wordmark } from "../components/Wordmark";
import { useRedesign } from "../hooks/useNavigationStyle";
import { useAuth } from "../hooks/useAuth";
import { filterNavByPermission, NAV_TREE } from "../components/Layout";

/**
 * NotFound — what an address that opens nothing says for itself.
 *
 * The application addresses every screen by path, so a path that is not a screen used to render the
 * shell with an **empty `<main>`**: a blank page that looks like a broken build. That cost three
 * debugging sessions in this project (`/configuration`, `/checklists`, `/products`, each of them a
 * real page under a different address), and it is also what a stale bookmark or a renamed route
 * leaves behind for a user. This is the screen that answers instead.
 *
 * Two arrangements, as the whole application has:
 *
 * - **Modern**: a card that leads with the address that failed, the sentence that explains it, the
 *   one control worth offering (search), and a row of places to start taken from the navigation tree
 *   itself — so these suggestions are the real destinations, in the order the rail shows them, and
 *   they cannot drift from it.
 * - **Classic**: a heading, the paragraph, the address set out as a definition line, and the same
 *   destinations as a plain list. A form of the same page, not a restyle of it.
 */
export function NotFoundPage() {
  const redesign = useRedesign();
  const location = useLocation();
  const navigate = useNavigate();
  const { permissions } = useAuth();

  /**
   * Where to send somebody instead. The navigation tree is the only honest source, and it is filtered
   * the way the rail filters it, so this never offers a section whose API calls would come back 403.
   */
  const destinations = filterNavByPermission(NAV_TREE, permissions)
    .filter(node => node.to)
    .slice(0, 5)
    .map(node => ({
      label: node.label,
      to: node.to as string,
      icon: node.icon,
    }));

  /** ⌘K is how this application is searched, and the palette owns that key — so press it for the user. */
  const openSearch = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, metaKey: true, bubbles: true }));
  };

  const address = location.pathname + location.search;

  if (redesign) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center animate-fade-in">
        <div className="surface-card w-full max-w-xl p-6">
          <Wordmark height={18} className="text-gray-400" />
          <h2 className="mt-4 text-base font-semibold tracking-tight text-white">
            There is nothing at this address
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            It is not a screen in this application — it may have been renamed, or the link that brought
            you here is older than the page it points at.
          </p>

          <p className="mt-4 rounded-md border border-surface-lighter bg-surface-light/40 px-3 py-2 font-mono text-[11px] text-gray-300 break-all">
            {address}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary text-xs" onClick={openSearch}>
              <Search size={13} className="mr-1.5" />
              Search everything
            </button>
            <button type="button" className="btn-secondary text-xs" onClick={() => navigate("/")}>
              <Home size={13} className="mr-1.5" />
              Today
            </button>
            <span className="text-[11px] text-gray-500">
              or press <kbd className="rounded border border-surface-lighter px-1">⌘K</kbd> anywhere
            </span>
          </div>

          <p className="mt-4 border-t border-surface-lighter pt-3 text-[11px] text-gray-500">
            Places to start, from the navigation:
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {destinations.map(({ label, to, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="inline-flex items-center gap-1.5 rounded-full border border-surface-lighter px-2.5 py-1 text-[11px] text-gray-300 transition-colors hover:border-cyber-500/40 hover:text-white"
              >
                {Icon ? <Icon size={12} /> : <Compass size={12} />}
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-cyber-600/10 p-2">
          <Compass size={20} className="text-cyber-400" />
        </div>
        <div>
          <h2 className="text-white font-medium">There is nothing at this address</h2>
          <p className="text-xs text-gray-500">
            It is not a screen in this application — it may have been renamed, or the link that brought
            you here is older than the page it points at.
          </p>
        </div>
      </div>

      <dl className="card text-sm">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-surface-border/60 px-4 py-3">
          <dt className="text-gray-400 text-xs w-24 shrink-0">Address</dt>
          <dd className="font-mono text-xs text-gray-300 break-all">{address}</dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
          <dt className="text-gray-400 text-xs w-24 shrink-0">Search</dt>
          <dd className="text-xs text-gray-400">
            <button type="button" className="btn-primary text-xs mr-2" onClick={openSearch}>
              <Search size={12} className="mr-1.5" />
              Search everything
            </button>
            <kbd className="rounded border border-surface-lighter px-1">⌘K</kbd> opens it from anywhere.
          </dd>
        </div>
      </dl>

      <div className="card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Places to start</h3>
        <ul className="mt-3 space-y-1">
          {destinations.map(({ label, to, icon: Icon }) => (
            <li key={to}>
              <Link to={to} className="flex items-center gap-2 py-0.5 text-sm text-gray-300 hover:text-cyber-400">
                {Icon ? <Icon size={14} className="text-gray-500" /> : <Compass size={14} className="text-gray-500" />}
                {label}
              </Link>
            </li>
          ))}
          <li>
            <Link to="/" className="flex items-center gap-2 py-0.5 text-sm text-gray-300 hover:text-cyber-400">
              <Home size={14} className="text-gray-500" />
              Today
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}

export default NotFoundPage;
