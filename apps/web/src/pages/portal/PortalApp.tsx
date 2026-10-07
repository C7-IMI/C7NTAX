import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, Link } from "react-router-dom";
import { Headset, LogOut, Ticket as TicketIcon } from "lucide-react";
import portalApi, { setPortalToken } from "../../portalApi";
import { DEFAULT_ACCENT_COLOUR } from "../../lib/colourTokens";
import { PortalLogin } from "./PortalLogin";
import { PortalTickets } from "./PortalTickets";
import { PortalTicketDetail } from "./PortalTicketDetail";

export interface PortalBranding {
  name: string;
  accentColor: string | null;
  logoUrl: string | null;
}

export interface PortalPolicy {
  welcomeText: string;
  supportEmail: string;
  allowTicketCreation: boolean;
  allowReplies: boolean;
  visibility: "contact" | "company";
}

export interface PortalMe {
  contact: { firstName: string; lastName: string; email: string; phone?: string | null };
  company: PortalBranding;
  openTickets: number;
  portal?: PortalPolicy;
}

interface PortalAuthValue {
  me: PortalMe | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  signedOut: boolean;
  /** The portal's identity before sign-in, so the sign-in page can wear the right colours. */
  branding: PortalBranding | null;
  policy: PortalPolicy | null;
}

const DEFAULT_ACCENT = DEFAULT_ACCENT_COLOUR;

const PortalAuthContext = createContext<PortalAuthValue | null>(null);

export function usePortalAuth(): PortalAuthValue {
  const value = useContext(PortalAuthContext);
  if (!value) throw new Error("usePortalAuth must be used inside the portal");
  return value;
}

/** The client's accent colour when they have one, the configured default when they do not. */
export function portalAccent(branding?: PortalBranding | null): string {
  return branding?.accentColor || DEFAULT_ACCENT;
}

export function PortalApp() {
  const [me, setMe] = useState<PortalMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [branding, setBranding] = useState<PortalBranding | null>(null);
  const [policy, setPolicy] = useState<PortalPolicy | null>(null);

  /**
   * The portal's identity is available before sign-in, so the sign-in page can wear the
   * configured colours and name rather than the product's own.
   */
  const loadBranding = useCallback(async () => {
    try {
      const res = await portalApi.get("/branding");
      setBranding({ name: res.data?.name || "Customer portal", accentColor: res.data?.accentColor ?? null, logoUrl: res.data?.logoUrl ?? null });
      setPolicy({
        welcomeText: res.data?.welcomeText || "",
        supportEmail: res.data?.supportEmail || "",
        allowTicketCreation: res.data?.allowTicketCreation !== false,
        allowReplies: res.data?.allowReplies !== false,
        visibility: res.data?.visibility === "company" ? "company" : "contact",
      });
    } catch {
      // A failure here only costs the branding; the portal itself still works.
      setBranding(null);
    }
  }, []);

  useEffect(() => { void loadBranding(); }, [loadBranding]);

  const refresh = useCallback(async () => {
    try {
      const res = await portalApi.get("/me");
      setMe(res.data);
      if (res.data?.portal) setPolicy(res.data.portal);
      setSignedOut(false);
    } catch {
      // Any failure here means "not signed in": an expired or withdrawn session is not an
      // error the customer should have to interpret.
      setMe(null);
      setSignedOut(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const signOut = useCallback(async () => {
    try { await portalApi.post("/auth/logout"); } catch { /* signing out of a dead session is still signing out */ }
    setPortalToken(null);
    setMe(null);
    setSignedOut(true);
  }, []);

  const value: PortalAuthValue = { me, loading, refresh, signOut, signedOut, branding, policy };

  return (
    <PortalAuthContext.Provider value={value}>
      <div className="min-h-screen bg-navy-900 text-white">
        {loading ? (
          <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Loading your portal…</div>
        ) : !me ? (
          <PortalLogin />
        ) : (
          <PortalShell>
            <Routes>
              <Route path="/" element={<Navigate to="/portal/tickets" replace />} />
              <Route path="/tickets" element={<PortalTickets />} />
              <Route path="/tickets/:id" element={<PortalTicketDetail />} />
              <Route path="*" element={<Navigate to="/portal/tickets" replace />} />
            </Routes>
          </PortalShell>
        )}
      </div>
    </PortalAuthContext.Provider>
  );
}

function PortalShell({ children }: { children: ReactNode }) {
  const { me, signOut, branding, policy } = usePortalAuth();
  const accent = portalAccent(me?.company ?? branding);
  // The client's name is the portal's title inside the portal; the provider's trading name is
  // what a customer sees before they have identified themselves.
  const title = me?.company.name || branding?.name || "Customer portal";

  return (
    <div className="min-h-screen">
      <header className="border-b border-surface-border bg-navy-800/60">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          {me?.company.logoUrl || branding?.logoUrl
            ? <img src={(me?.company.logoUrl || branding?.logoUrl) as string} alt={title} className="h-8 w-8 rounded object-contain bg-navy-900" />
            : <div className="h-8 w-8 rounded flex items-center justify-center" style={{ backgroundColor: `${accent}22` }}><Headset size={16} style={{ color: accent }} /></div>}
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{title}</p>
            <p className="text-xs text-gray-400 truncate">{me?.contact.firstName} {me?.contact.lastName} · {me?.contact.email}</p>
          </div>
          <nav className="ml-auto flex items-center gap-1">
            <Link to="/portal/tickets" className="btn-secondary text-xs flex items-center gap-1.5"><TicketIcon size={14} /> My tickets</Link>
            <button onClick={() => void signOut()} className="btn-secondary text-xs flex items-center gap-1.5" title="Sign out">
              <LogOut size={14} /> Sign out
            </button>
          </nav>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">{children}</main>
      <footer className="max-w-4xl mx-auto px-4 pb-8 text-xs text-gray-600">
        Your provider is notified of everything you write here, and you will be emailed whenever the ticket changes.
        {policy?.supportEmail ? <> Need help signing in? <a href={`mailto:${policy.supportEmail}`} className="text-gray-400 hover:text-gray-300">{policy.supportEmail}</a></> : null}
      </footer>
    </div>
  );
}
