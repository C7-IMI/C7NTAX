import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlignJustify, HelpCircle, LayoutPanelLeft, ListTree, LogOut, Moon, PanelRight, Rows3, Settings2, Shield, Sparkles, Sun, UserCircle,
} from "lucide-react";
import { useAppVersion } from "../hooks/useAppVersion";
import { useAuth } from "../hooks/useAuth";
import { useClientIp } from "../hooks/useClientIp";
import { setContextPane, setInterfacePreference, setNavigationPreference, useNavigationSettings } from "../hooks/useNavigationStyle";
import { useTheme } from "../hooks/useTheme";
import { UI_NAV_AVAILABLE, UI_P1, UI_PALETTE, UI_REDESIGN_AVAILABLE } from "../lib/uiFlags";
import { getDensity, setDensity, type Density } from "../lib/density";
import { getPalette, setPalette, type PaletteMode } from "../lib/palette";
import { PaletteSchemeList } from "./PaletteSchemeList";
import { Wordmark } from "./Wordmark";

type MenuUser = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string;
  role?: unknown;
  mfaEnabled?: boolean;
};

function displayName(user: MenuUser | null): string {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  return name || user?.email?.split("@")[0] || "My Account";
}

function roleLabel(user: MenuUser | null): string {
  const role = user?.role;
  if (!role) return "";
  if (typeof role === "string") return role.replace(/_/g, " ");
  const system = (role as { systemRole?: string }).systemRole;
  return system ? system.replace(/_/g, " ") : "";
}

function initials(user: MenuUser | null): string {
  const first = user?.firstName?.[0] ?? "";
  const last = user?.lastName?.[0] ?? "";
  const both = `${first}${last}`.trim();
  return (both || user?.email?.[0] || "U").toUpperCase();
}

/**
 * Account menu in the header toolbar: identity, profile/security links, the
 * appearance controls (theme, colour scheme, density) and sign out — the
 * pattern used by ConnectWise Manage, Autotask PSA, Scoro and NinjaOne.
 */
export function MyAccountMenu() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { style: navStyle, interfaceStyle, contextPane } = useNavigationSettings();
  const clientIp = useClientIp();
  const appVersion = useAppVersion();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [scheme, setScheme] = useState(() => getPalette(theme as PaletteMode));
  const [density, setDensityState] = useState<Density>(getDensity);
  const ref = useRef<HTMLDivElement>(null);

  const mode = theme as PaletteMode;

  // The scheme shown belongs to the active theme, so keep it in step when the
  // user flips light/dark from inside (or outside) this menu.
  useEffect(() => {
    setScheme(getPalette(mode));
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

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const pickScheme = (id: string) => setScheme(setPalette(mode, id));

  const pickDensity = (next: Density) => {
    setDensityState(next);
    setDensity(next);
  };

  const label = roleLabel(user as MenuUser | null);
  const rowClass = "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left text-gray-300 hover:bg-surface-lighter hover:text-white transition-colors";
  const chipClass = (active: boolean) =>
    `flex-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
      active ? "bg-cyber-600/20 text-cyber-400" : "text-gray-400 hover:text-white hover:bg-surface-lighter"
    }`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="px-3 py-1.5 text-xs text-cyber-400 hover:text-cyber-300 hover:bg-cyber-600/10 rounded-md transition-colors flex items-center gap-1.5"
        title="My Account"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <UserCircle size={14} />
        <span>My Account</span>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-80 rounded-lg border border-surface-border bg-surface shadow-lg z-50 overflow-hidden">
          {/* Brand — the logo and the build it belongs to */}
          <div className="px-3 pt-3 pb-2.5 border-b border-surface-border text-white flex items-center justify-between gap-2">
            <Wordmark height={26} />
            {appVersion && (
              <span
                className="text-[11px] font-mono text-gray-500 shrink-0"
                title={appVersion.title
                  ? `${appVersion.title}${appVersion.date ? ` · ${appVersion.date}` : ""}`
                  : `C7NTAX ${appVersion.version}`}
              >
                v{appVersion.version}
              </span>
            )}
          </div>

          {/* Identity */}
          <div className="flex items-center gap-3 p-3 border-b border-surface-border">
            <div className="w-9 h-9 rounded-full bg-cyber-600/20 text-cyber-400 flex items-center justify-center text-xs font-semibold shrink-0">
              {initials(user as MenuUser | null)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate">{displayName(user as MenuUser | null)}</p>
              <p className="text-[11px] text-gray-500 truncate">{user?.email}</p>
            </div>
            {label && <span className="badge bg-surface-lighter text-gray-300 text-[10px] capitalize shrink-0">{label}</span>}
          </div>

          {/* The address this connection arrives from: a fact about the connection rather than about the
              person, so it sits on its own line under the identity block. */}
          {clientIp && (
            <p
              className="px-3 py-2 text-[11px] text-gray-500 border-b border-surface-border truncate"
              title="The address this connection is arriving from"
            >
              Connecting from <span className="font-mono text-gray-400">{clientIp}</span>
            </p>
          )}

          {/* Account */}
          <div className="p-1.5">
            <button role="menuitem" className={rowClass} onClick={() => go("/settings#profile")}>
              <UserCircle size={14} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">My Profile</span>
                <span className="block text-[10px] text-gray-500 truncate">Name, email and role</span>
              </span>
            </button>
            <button role="menuitem" className={rowClass} onClick={() => go("/settings#security")}>
              <Shield size={14} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">Security &amp; two-factor</span>
                <span className="block text-[10px] text-gray-500 truncate">
                  {user?.mfaEnabled ? "Two-factor authentication is on" : "Two-factor authentication is off"}
                </span>
              </span>
            </button>
            <button role="menuitem" className={rowClass} onClick={() => go("/settings#landing")}>
              <Settings2 size={14} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">Preferences</span>
                <span className="block text-[10px] text-gray-500 truncate">Default landing page after sign-in</span>
              </span>
            </button>
          </div>

          {/* Appearance */}
          <div className="p-1.5 border-t border-surface-border">
            <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-gray-500">Appearance</p>
            <div className="px-2 pb-1.5">
              <div className="flex items-center gap-1 rounded-md bg-surface-light p-0.5">
                <button className={chipClass(mode === "dark")} onClick={() => setTheme("dark")} aria-pressed={mode === "dark"}>
                  <span className="flex items-center justify-center gap-1.5"><Moon size={12} /> Dark</span>
                </button>
                <button className={chipClass(mode === "light")} onClick={() => setTheme("light")} aria-pressed={mode === "light"}>
                  <span className="flex items-center justify-center gap-1.5"><Sun size={12} /> Light</span>
                </button>
              </div>
            </div>

            {/* The interface: the redesigned screens, or the classic ones. Its own switch rather
                than a name for the navigation pane's, because "which screens" and "which nav" are
                different questions — and this is the one that takes the whole interface back. */}
            {UI_REDESIGN_AVAILABLE && (
              <div className="px-2 pb-1.5">
                <p className="px-0.5 pb-1 text-[10px] text-gray-500">Interface</p>
                <div className="flex items-center gap-1 rounded-md bg-surface-light p-0.5">
                  <button className={chipClass(interfaceStyle === "redesign")} onClick={() => setInterfacePreference("redesign")} aria-pressed={interfaceStyle === "redesign"}>
                    <span className="flex items-center justify-center gap-1.5"><Sparkles size={12} /> Redesign</span>
                  </button>
                  <button className={chipClass(interfaceStyle === "classic")} onClick={() => setInterfacePreference("classic")} aria-pressed={interfaceStyle === "classic"}>
                    <span className="flex items-center justify-center gap-1.5"><ListTree size={12} /> Classic</span>
                  </button>
                </div>
              </div>
            )}

            {/* The navigation pane. The instance's default is modern and an administrator changes
                that for everybody (Administration → Configuration → Workspace); this is the one place
                a person can disagree with it for themselves, without needing one. It re-renders the
                pane in place rather than reloading, and it is the same `c7_ui_nav` flag the rollback
                instructions name, so the two cannot drift apart. */}
            {UI_NAV_AVAILABLE && (
              <div className="px-2 pb-1.5">
                <p className="px-0.5 pb-1 text-[10px] text-gray-500">Navigation</p>
                <div className="flex items-center gap-1 rounded-md bg-surface-light p-0.5">
                  <button className={chipClass(navStyle === "modern")} onClick={() => setNavigationPreference("modern")} aria-pressed={navStyle === "modern"}>
                    <span className="flex items-center justify-center gap-1.5"><LayoutPanelLeft size={12} /> Modern</span>
                  </button>
                  <button className={chipClass(navStyle === "classic")} onClick={() => setNavigationPreference("classic")} aria-pressed={navStyle === "classic"}>
                    <span className="flex items-center justify-center gap-1.5"><ListTree size={12} /> Classic</span>
                  </button>
                </div>
              </div>
            )}

            {UI_REDESIGN_AVAILABLE && (
              <div className="px-2 pb-1.5">
                <p className="px-0.5 pb-1 text-[10px] text-gray-500">Layout</p>
                <div className="flex items-center gap-1 rounded-md bg-surface-light p-0.5">
                  <button className={chipClass(contextPane)} onClick={() => setContextPane(true)} aria-pressed={contextPane}>
                    <span className="flex items-center justify-center gap-1.5"><PanelRight size={12} /> Context pane</span>
                  </button>
                  <button className={chipClass(!contextPane)} onClick={() => setContextPane(false)} aria-pressed={!contextPane}>
                    <span className="flex items-center justify-center gap-1.5"><Rows3 size={12} /> Hide it</span>
                  </button>
                </div>
              </div>
            )}

            {UI_PALETTE && (
              <>
                <p className="px-2 pt-1 pb-1 text-[10px] text-gray-500">Colour scheme — {mode}</p>
                <PaletteSchemeList mode={mode} current={scheme} onSelect={pickScheme} className="max-h-64 overflow-y-auto" />
              </>
            )}

            {UI_P1 && (
              <div className="px-2 pt-2 pb-1">
                <button
                  className="w-full flex items-center gap-2 px-1 py-1 text-[11px] text-gray-400 hover:text-white transition-colors"
                  onClick={() => pickDensity(density === "compact" ? "comfortable" : "compact")}
                >
                  <AlignJustify size={12} />
                  {density === "compact" ? "Use comfortable spacing" : "Use compact spacing"}
                </button>
              </div>
            )}
          </div>

          {/* Support */}
          <div className="p-1.5 border-t border-surface-border">
            <button role="menuitem" className={rowClass} onClick={() => go("/help")}>
              <HelpCircle size={14} className="shrink-0" />
              <span className="text-xs font-medium">Help &amp; Support</span>
            </button>
            <button role="menuitem" className={rowClass} onClick={() => go("/admin/changelog")}>
              <Sparkles size={14} className="shrink-0" />
              <span className="text-xs font-medium">What&apos;s New</span>
            </button>
          </div>

          {/* Sign out */}
          <div className="p-1.5 border-t border-surface-border">
            <button
              role="menuitem"
              onClick={() => { setOpen(false); logout(); }}
              className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left text-red-400 hover:bg-red-600/10 hover:text-red-300 transition-colors"
            >
              <LogOut size={14} className="shrink-0" />
              <span className="text-xs font-medium">Sign out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
