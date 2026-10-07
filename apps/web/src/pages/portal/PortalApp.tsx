import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, Link } from "react-router-dom";
import { Headset, LogOut, Ticket as TicketIcon } from "lucide-react";
import portalApi, { setPortalToken } from "../../portalApi";
import { PortalLogin } from "./PortalLogin";
import { PortalTickets } from "./PortalTickets";
import { PortalTicketDetail } from "./PortalTicketDetail";

export interface PortalBranding {
  name: string;
  accentColor: string | null;
  logoUrl: string | null;
}

export interface PortalMe {
  contact: { firstName: string; lastName: string; email: string; phone?: string | null };
  company: PortalBranding;
  openTickets: number;
}

interface PortalAuthValue {
  me: PortalMe | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  signedOut: boolean;
}

const PortalAuthContext = createContext<PortalAuthValue | null>(null);

export function usePortalAuth(): PortalAuthValue {
  const value = useContext(PortalAuthContext);
  if (!value) throw new Error("usePortalAuth must be used inside the portal");
  return value;
}

/** The client's accent colour when they have one, the product's own when they do not. */
export function portalAccent(branding?: PortalBranding | null): string {
  return branding?.accentColor || "#22d3ee";
}

export function PortalApp() {
  const [me, setMe] = useState<PortalMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await portalApi.get("/me");
      setMe(res.data);
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

  const value: PortalAuthValue = { me, loading, refresh, signOut, signedOut };

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
  const { me, signOut } = usePortalAuth();
  const accent = portalAccent(me?.company);

  return (
    <div className="min-h-screen">
      <header className="border-b border-surface-border bg-navy-800/60">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          {me?.company.logoUrl
            ? <img src={me.company.logoUrl} alt={me.company.name} className="h-8 w-8 rounded object-contain bg-navy-900" />
            : <div className="h-8 w-8 rounded flex items-center justify-center" style={{ backgroundColor: `${accent}22` }}><Headset size={16} style={{ color: accent }} /></div>}
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{me?.company.name}</p>
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
      </footer>
    </div>
  );
}
